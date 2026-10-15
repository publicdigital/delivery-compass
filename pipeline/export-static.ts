/**
 * Export the SQLite corpus as static JSON for the hosted prototype.
 *
 * The deployed site is static files plus short-lived serverless functions — there is
 * no server to query SQLite at request time, so everything the UI needs is computed
 * here and committed to the repo. Refreshing the live corpus is therefore:
 * `compass ingest && compass watch && compass export && git commit && git push`.
 *
 * Everything that does not depend on the user's question is precomputed: confirmed
 * conflicts per source, candidate conflicts per obligation, section text formatting,
 * the map graph, and the change feed. Only retrieval itself happens in the browser.
 *
 * The export refuses to run on a corpus below its floors. That check used to live in
 * the Docker build and in /healthz; with no server and no build step, this is the
 * last point at which a half-ingested corpus can be caught before it is committed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { openDb } from "./db.ts";
import { findAllConflictEvidence } from "./conflicts.ts";
import { buildGraph, loadRelations, type Relation } from "./graph.ts";
import { loadConcepts } from "./concepts-registry.ts";
import { loadRegistry } from "./registry.ts";
import { citationUrl } from "./search.ts";
import { checkCorpus } from "./verify.ts";
import { recentPublishedChanges } from "./watch.ts";

const OUT_DIR = fileURLToPath(new URL("../assets/data/", import.meta.url));

/** Matches the server's old cap: generous enough that a typical section is never cut. */
const SECTION_TEXT_CAP = 3000;

function formatSectionText(raw: string): { text: string; truncated: boolean } {
  const paragraphs = raw.split(/\n+/).map((p) => p.trim().replace(/\s+/g, " ")).filter(Boolean);
  const full = paragraphs.join("\n");
  const truncated = full.length > SECTION_TEXT_CAP;
  return { text: truncated ? full.slice(0, SECTION_TEXT_CAP) : full, truncated };
}

function write(name: string, data: unknown): number {
  mkdirSync(dirname(join(OUT_DIR, name)), { recursive: true });
  const json = JSON.stringify(data);
  writeFileSync(join(OUT_DIR, name), json);
  return gzipSync(json).length;
}

const kb = (n: number) => `${(n / 1024).toFixed(0)}KB`;

export function exportStatic(): void {
  const db = openDb();

  const health = checkCorpus(db);
  if (!health.ok) {
    console.error("Refusing to export: the corpus is below its floors.\n");
    for (const f of health.failures) console.error(`  - ${f}`);
    console.error("\nRe-run `npm run compass -- ingest` and look for sources that failed to fetch.");
    console.error("Do not lower the floors in pipeline/verify.ts to get a clean export.");
    process.exit(1);
  }

  const registry = loadRegistry();
  const byId = new Map(registry.map((s) => [s.id, s]));
  const relations = loadRelations();

  // --- sections -------------------------------------------------------------
  // Source metadata is denormalised onto each section so the client needs one
  // lookup, not a join. It costs a few hundred KB before compression and removes
  // a whole class of client-side plumbing.
  const sectionRows = db.prepare(
    `SELECT
       sec.id            AS id,
       sec.source_id     AS sourceId,
       src.title         AS sourceTitle,
       src.body          AS body,
       src.spine         AS spine,
       src.authority     AS authority,
       sec.heading       AS heading,
       sec.heading_path  AS headingPath,
       sec.anchor        AS anchor,
       sec.doc_path      AS docPath,
       sec.text          AS rawText,
       COALESCE(sec.doc_updated_at, src.public_updated_at) AS updatedAt,
       src.indexed_at    AS indexedAt
     FROM sections sec
     JOIN sources src ON src.id = sec.source_id
     WHERE src.content_status = 'full'
     ORDER BY sec.id`,
  ).all() as unknown as {
    id: number; sourceId: string; sourceTitle: string; body: string; spine: string;
    authority: string; heading: string; headingPath: string; anchor: string | null;
    docPath: string; rawText: string; updatedAt: string | null; indexedAt: string | null;
  }[];

  const sections = sectionRows.map((r) => {
    const { text, truncated } = formatSectionText(r.rawText);
    return {
      id: r.id,
      sourceId: r.sourceId,
      sourceTitle: r.sourceTitle,
      body: r.body,
      spine: r.spine,
      authority: r.authority,
      heading: r.heading,
      headingPath: r.headingPath,
      anchor: r.anchor,
      docPath: r.docPath,
      text,
      truncated,
      updatedAt: r.updatedAt,
      indexedAt: r.indexedAt,
      staleIndex: Boolean(r.updatedAt && r.indexedAt && r.updatedAt > r.indexedAt),
      url: citationUrl({ docPath: r.docPath, anchor: r.anchor }),
    };
  });

  // --- confirmed conflicts, keyed by the losing side ------------------------
  // A human has judged these in relations.yaml, so an obligation from that source
  // is flagged wherever it appears, not only when both sides are cited together.
  const confirmedBySource: Record<string, unknown[]> = {};
  for (const r of relations as Relation[]) {
    if (r.type !== "supersedes" && r.type !== "conflicts") continue;
    (confirmedBySource[r.to] ??= []).push({
      type: r.type,
      byTitle: byId.get(r.from)?.title ?? r.from,
      scope: r.scope,
      effective: r.effective,
      guidance: r.guidance,
    });
  }

  // --- candidate conflicts, keyed per obligation ----------------------------
  // Unverified output of the automatic sweep. Capped and pre-sorted here so the
  // client never has to hold the full cross-product.
  const candidates = new Map<string, { sourceTitle: string; sentence: string; url: string; ageGapDays: number; sharedWords: string[] }[]>();
  const key = (sourceId: string, sentence: string) => `${sourceId}::${sentence}`;
  for (const e of findAllConflictEvidence(db)) {
    for (const [self, other] of [[e.a, e.b], [e.b, e.a]] as const) {
      const k = key(self.sourceId, self.sentence);
      const list = candidates.get(k) ?? [];
      list.push({
        sourceTitle: other.sourceTitle,
        sentence: other.sentence,
        url: other.url,
        ageGapDays: Math.round(e.ageGapDays),
        sharedWords: e.sharedWords,
      });
      candidates.set(k, list);
    }
  }
  const candidateByObligation: Record<string, unknown[]> = {};
  for (const [k, list] of candidates) {
    candidateByObligation[k] = list
      .sort((a, b) => b.ageGapDays * b.sharedWords.length - a.ageGapDays * a.sharedWords.length)
      .slice(0, 2);
  }

  // --- obligations ----------------------------------------------------------
  // Context is NOT duplicated here: each obligation points at its section id and
  // the client reads the text from the section it already has. Inlining it
  // multiplied the payload by roughly the number of obligations per section.
  const obligationRows = db.prepare(
    `SELECT
       o.section_id AS sectionId, o.source_id AS sourceId, o.strength, o.modal,
       o.sentence, o.actor, o.conventional,
       src.title AS sourceTitle, src.body AS body,
       sec.heading_path AS headingPath, sec.anchor AS anchor, sec.doc_path AS docPath,
       COALESCE(sec.doc_updated_at, src.public_updated_at) AS updatedAt
     FROM obligations o
     JOIN sections sec ON sec.id = o.section_id
     JOIN sources  src ON src.id = o.source_id
     WHERE src.content_status = 'full'
       AND o.strength IN ('mandatory','recommended')
     ORDER BY o.section_id,
              CASE o.strength WHEN 'mandatory' THEN 0 ELSE 1 END,
              o.conventional DESC`,
  ).all() as unknown as {
    sectionId: number; sourceId: string; strength: string; modal: string; sentence: string;
    actor: string | null; conventional: number; sourceTitle: string; body: string;
    headingPath: string; anchor: string | null; docPath: string; updatedAt: string | null;
  }[];

  const obligations: Record<string, unknown[]> = {};
  for (const o of obligationRows) {
    (obligations[String(o.sectionId)] ??= []).push({
      sourceId: o.sourceId,
      strength: o.strength,
      modal: o.modal,
      sentence: o.sentence,
      actor: o.actor,
      conventional: Boolean(o.conventional),
      sourceTitle: o.sourceTitle,
      body: o.body,
      headingPath: o.headingPath,
      updatedAt: o.updatedAt,
      url: citationUrl({ docPath: o.docPath, anchor: o.anchor }),
      confirmedConflicts: confirmedBySource[o.sourceId] ?? [],
      candidateConflicts: candidateByObligation[key(o.sourceId, o.sentence)] ?? [],
    });
  }

  // --- map ------------------------------------------------------------------
  const { nodes, edges } = buildGraph();
  const counts = db.prepare(
    `SELECT sec.source_id AS sourceId, COUNT(*) AS sections, src.content_status AS status
     FROM sections sec JOIN sources src ON src.id = sec.source_id
     GROUP BY sec.source_id`,
  ).all() as unknown as { sourceId: string; sections: number; status: string }[];
  const stats = new Map(counts.map((c) => [c.sourceId, c]));
  const map = {
    nodes: nodes.map((n) => {
      const st = stats.get(n.id);
      return { ...n, sections: st?.status === "full" ? st.sections : 0, contentStatus: st?.status ?? "not_indexed" };
    }),
    edges,
  };

  // --- sources --------------------------------------------------------------
  // The registry itself, for the MCP server (netlify/functions/mcp). The site gets
  // by with map.json; an assistant asked "who owns this, and is it still current?"
  // needs the canonical URL, the licence and the withdrawal record too. The
  // function cannot read sources/*.yaml: the deploy installs no packages, so there
  // is no YAML parser at runtime.
  const sourceRecords = registry.map((s) => {
    const st = stats.get(s.id);
    return {
      id: s.id,
      title: s.title,
      body: s.body,
      spine: s.spine,
      authority: s.authority,
      licence: s.licence,
      fetcher: s.fetcher,
      url: s.slug ? `https://www.gov.uk${s.slug}` : (s.endpoint ?? null),
      externalAttachment: s.externalAttachment ?? null,
      pdf: s.pdf ?? null,
      parent: s.parent ?? null,
      contentStatus: st?.status ?? "not_indexed",
      sections: st?.status === "full" ? st.sections : 0,
      withdrawnOn: s.withdrawnOn ?? null,
      withdrawnReason: s.withdrawnReason ?? null,
      replacement: s.replacement ?? null,
    };
  });

  // --- watch ----------------------------------------------------------------
  const watch = recentPublishedChanges(db, 730, 60);

  // --- stats ----------------------------------------------------------------
  const row = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM sources WHERE content_status='full') AS sources,
       (SELECT COUNT(*) FROM sections) AS sections,
       (SELECT COUNT(*) FROM obligations) AS obligations,
       (SELECT COUNT(*) FROM obligations WHERE strength='mandatory') AS mandatory,
       (SELECT MAX(indexed_at) FROM sources) AS indexedAt`,
  ).get() as Record<string, unknown>;

  const meta = {
    ...row,
    registered: registry.length,
    relations: relations.length,
    exportedAt: new Date().toISOString(),
    // Carried through so the UI can name the sources whose substance GOV.UK does
    // not publish as HTML, rather than silently omitting them from the map.
    caveatSources: Object.keys(confirmedBySource),
  };

  // --- write ----------------------------------------------------------------
  const sizes = {
    "sections.json": write("sections.json", sections),
    "obligations.json": write("obligations.json", obligations),
    "map.json": write("map.json", map),
    "watch.json": write("watch.json", watch),
    "meta.json": write("meta.json", meta),
    "relations.json": write("relations.json", relations),
    "sources.json": write("sources.json", sourceRecords),
    "concepts.json": write("concepts.json", loadConcepts(registry.map((s) => s.id))),
  };

  console.log(`Exported to assets/data/ (gzipped sizes, which is what the browser downloads):\n`);
  let total = 0;
  for (const [name, size] of Object.entries(sizes)) {
    total += size;
    console.log(`  ${name.padEnd(20)} ${kb(size).padStart(7)}`);
  }
  console.log(`  ${"".padEnd(20)} ${"-------".padStart(7)}`);
  console.log(`  ${"total".padEnd(20)} ${kb(total).padStart(7)}\n`);
  console.log(`${sections.length} sections, ${obligationRows.length} obligations, ${map.edges.length} relationships, ${watch.length} change notes.`);
  db.close();
}

if (import.meta.filename === process.argv[1]) exportStatic();
