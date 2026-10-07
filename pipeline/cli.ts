import { openDb, rebuildFts } from "./db.ts";
import { expandCollection } from "./fetchers/govuk.ts";
import { explicitlyClaimedPaths, ingestSource } from "./ingest.ts";
import { caveatsFor, loadRelations } from "./graph.ts";
import { citationUrl, obligationsForSections, searchSections } from "./search.ts";
import { poll, recentPublishedChanges } from "./watch.ts";
import { buildGraph } from "./graph.ts";
import { findConflictCandidates } from "./conflicts.ts";
import { loadRegistry } from "./registry.ts";
import { checkCorpus } from "./verify.ts";
import { feedbackSummary, listFeedback, queryReport, toCsv } from "./feedback.ts";
import { importCsv } from "./import-feedback.ts";

const BOLD = "\x1b[1m", DIM = "\x1b[2m", RESET = "\x1b[0m";
const RED = "\x1b[31m", YELLOW = "\x1b[33m", GREEN = "\x1b[32m", CYAN = "\x1b[36m";

async function cmdIngest(only?: string): Promise<void> {
  const db = openDb();
  const registry = loadRegistry().filter((s) => (only ? s.id === only || s.spine === only : true));
  if (registry.length === 0) { console.error(`nothing matches "${only}"`); process.exit(1); }

  console.log(`${BOLD}Ingesting ${registry.length} sources${RESET} ${DIM}(HTML-first; PDF-only sources are skipped, not guessed at)${RESET}\n`);
  let totalSections = 0, totalObligations = 0, ingested = 0;

  // Computed from the full registry, not the filtered subset, so a partial
  // re-ingest cannot re-claim a page that belongs to another source.
  const fullRegistry = loadRegistry();
  const claimed = explicitlyClaimedPaths(fullRegistry);
  const byId = new Map(fullRegistry.map((s) => [s.id, s] as const));

  for (const source of registry) {
    const r = await ingestSource(db, source, claimed, byId);
    if (r.skipped) {
      console.log(`  ${DIM}skip${RESET}  ${source.id.padEnd(26)} ${DIM}${r.skipped}${RESET}`);
      continue;
    }
    if (r.metadataOnly) {
      console.log(`  ${YELLOW}meta${RESET}  ${source.id.padEnd(26)} ${DIM}landing-page summary only; substance is PDF or off-platform${RESET}`);
      continue;
    }
    ingested++;
    totalSections += r.sections;
    totalObligations += r.obligations;
    console.log(`  ${GREEN}ok${RESET}    ${source.id.padEnd(26)} ${String(r.sections).padStart(4)} sections  ${String(r.obligations).padStart(4)} obligations  ${DIM}${r.docs} page(s)${RESET}`);
  }

  rebuildFts(db);
  console.log(`\n${BOLD}Indexed${RESET} ${ingested} sources, ${totalSections} sections, ${totalObligations} obligations.`);

  const byStrength = db.prepare("SELECT strength, COUNT(*) n FROM obligations GROUP BY strength ORDER BY n DESC").all() as { strength: string; n: number }[];
  console.log(byStrength.map((r) => `${r.n} ${r.strength}`).join(", "));
  db.close();
}

const STRENGTH_STYLE: Record<string, string> = {
  mandatory: `${RED}MANDATORY${RESET}`,
  recommended: `${YELLOW}RECOMMENDED${RESET}`,
  permitted: `${CYAN}PERMITTED${RESET}`,
  possible: `${DIM}POSSIBLE${RESET}`,
};

async function cmdAsk(question: string): Promise<void> {
  if (!question) { console.error('usage: compass ask "your question"'); process.exit(1); }
  const db = openDb();

  const hits = searchSections(db, question, 6);
  if (hits.length === 0) {
    console.log(`${BOLD}No match in the corpus.${RESET}`);
    console.log(`${DIM}The corpus covers only the registered sources. Rather than guess, this is a gap - log it and widen the registry.${RESET}`);
    db.close();
    return;
  }

  const obligations = obligationsForSections(db, hits.map((h) => h.sectionId));

  console.log(`${BOLD}Q: ${question}${RESET}\n`);

  // Warn before quoting anything. No single GOV.UK page tells you it has been
  // overtaken elsewhere, so this is the one thing the reader cannot find alone.
  const byId = new Map(loadRegistry().map((s) => [s.id, s]));
  const caveats = caveatsFor([...new Set(hits.map((h) => h.sourceId))], loadRelations());
  for (const c of caveats) {
    const stale = byId.get(c.supersededSourceId)?.title ?? c.supersededSourceId;
    const winner = byId.get(c.bySourceId)?.title ?? c.bySourceId;
    const tag = c.severity === "high" ? `${RED}SUPERSEDED${RESET}` : `${YELLOW}CONFLICT${RESET}`;
    console.log(`${tag} ${BOLD}${stale}${RESET} is out of date on ${BOLD}${c.scope ?? "this topic"}${RESET}${c.effective ? ` (since ${c.effective})` : ""}`);
    console.log(`  Current position is in ${BOLD}${winner}${RESET}.`);
    if (c.guidance) console.log(`  ${c.guidance.replace(/\s+/g, " ").trim()}`);
    if (c.evidence) console.log(`  ${DIM}${c.evidence.replace(/\s+/g, " ").trim()}${RESET}`);
    console.log();
  }

  const binding = obligations.filter((o) => o.strength === "mandatory" || o.strength === "recommended");
  if (binding.length > 0) {
    console.log(`${BOLD}What the guidance requires${RESET} ${DIM}(quoted verbatim, never paraphrased)${RESET}\n`);
    for (const o of binding.slice(0, 8)) {
      const caveat = o.conventional ? "" : ` ${DIM}(informal phrasing, not the document's declared convention)${RESET}`;
      console.log(`  ${STRENGTH_STYLE[o.strength]}${caveat}`);
      console.log(`  "${o.sentence}"`);
      console.log(`  ${DIM}${o.sourceTitle} - ${o.body}${RESET}`);
      console.log(`  ${DIM}${o.headingPath}${RESET}`);
      console.log(`  ${CYAN}${citationUrl(o)}${RESET}\n`);
    }
  }

  console.log(`${BOLD}Relevant sections${RESET}\n`);
  for (const h of hits) {
    const authority = h.authority === "mandatory" ? `${RED}mandatory source${RESET}` : `${h.authority} source`;
    console.log(`  ${BOLD}${h.headingPath}${RESET}`);
    console.log(`  ${DIM}${h.sourceTitle} - ${h.body}${RESET} - ${DIM}${authority}${RESET}`);
    const excerpt = h.text.replace(/\s+/g, " ").slice(0, 260);
    console.log(`  ${excerpt}${h.text.length > 260 ? "..." : ""}`);
    console.log(`  ${CYAN}${citationUrl(h)}${RESET}`);
    if (h.publicUpdatedAt && h.indexedAt && h.publicUpdatedAt > h.indexedAt) {
      console.log(`  ${YELLOW}! source changed after indexing - re-run ingest${RESET}`);
    }
    console.log(`  ${DIM}source last updated ${h.publicUpdatedAt?.slice(0, 10) ?? "unknown"}; indexed ${h.indexedAt?.slice(0, 10) ?? "unknown"}${RESET}\n`);
  }

  console.log(`${DIM}Navigation aid, not an authority. Always confirm against the linked source before relying on it.${RESET}`);
  db.close();
}

async function cmdWatch(argDays?: string): Promise<void> {
  const db = openDb();
  const registry = loadRegistry();
  const days = Number(argDays ?? 180);

  process.stderr.write(`${DIM}polling ${registry.length} sources`);
  const events = await poll(db, registry, () => process.stderr.write("."));
  process.stderr.write(`${RESET}\n\n`);

  const moved = events.filter((e) => e.kind !== "first-seen");
  console.log(`${BOLD}Since the last check${RESET}`);
  if (moved.length === 0) {
    console.log(`  ${DIM}nothing moved (${events.length} sources seen for the first time)${RESET}\n`);
  } else {
    for (const e of moved) {
      const tag = e.kind === "withdrawn" || e.kind === "redirected" ? RED : e.kind === "error" ? DIM : YELLOW;
      console.log(`  ${tag}${e.kind}${RESET} ${BOLD}${e.sourceTitle}${RESET} ${DIM}(${e.body})${RESET}`);
      console.log(`    ${e.note.replace(/\s+/g, " ").slice(0, 200)}`);
      if (e.liveUrl) console.log(`    ${CYAN}${e.liveUrl}${RESET}`);
    }
    console.log();
  }

  const recent = recentPublishedChanges(db, days, 25);
  console.log(`${BOLD}Published change notes, last ${days} days${RESET} ${DIM}(the publisher's own words)${RESET}\n`);
  for (const e of recent) {
    console.log(`  ${e.timestamp.slice(0, 10)}  ${BOLD}${e.sourceTitle}${RESET} ${DIM}${e.body} / ${e.spine}${RESET}`);
    console.log(`              ${e.note.replace(/\s+/g, " ").slice(0, 180)}`);
  }
  if (recent.length === 0) console.log(`  ${DIM}none${RESET}`);
  db.close();
}

async function cmdMap(): Promise<void> {
  const { nodes, edges } = buildGraph();

  console.log(`${BOLD}Who owns what${RESET} ${DIM}- the fragmentation, honestly drawn${RESET}\n`);
  const byBody = new Map<string, typeof nodes>();
  for (const n of nodes) byBody.set(n.body, [...(byBody.get(n.body) ?? []), n]);
  for (const [body, ns] of [...byBody].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${BOLD}${body}${RESET} ${DIM}(${ns.length})${RESET}`);
    for (const n of ns) {
      const auth = n.authority === "mandatory" ? `${RED}M${RESET}` : n.authority === "withdrawn" ? `${RED}X${RESET}` : `${DIM}-${RESET}`;
      console.log(`    ${auth} ${n.title}`);
    }
  }

  console.log(`\n${BOLD}How it connects${RESET}\n`);
  const byType = new Map<string, typeof edges>();
  for (const e of edges) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
  for (const [type, es] of [...byType].sort()) {
    console.log(`  ${BOLD}${type}${RESET}`);
    for (const e of es) {
      const flag = e.severity === "high" ? `${RED}!${RESET}` : " ";
      console.log(`   ${flag} ${e.from} -> ${e.to}${e.scope ? ` ${DIM}(${e.scope})${RESET}` : ""}`);
    }
  }
  console.log(`\n${DIM}M = mandatory, X = withdrawn, ! = high-severity supersession${RESET}`);
  console.log(`${nodes.length} sources, ${edges.length} relationships across ${byBody.size} bodies.`);
}

async function cmdList(): Promise<void> {
  const registry = loadRegistry();
  const bySpine = new Map<string, typeof registry>();
  for (const s of registry) bySpine.set(s.spine, [...(bySpine.get(s.spine) ?? []), s]);
  for (const [spine, sources] of [...bySpine].sort()) {
    console.log(`\n${BOLD}${spine}${RESET} ${DIM}(${sources.length})${RESET}`);
    for (const s of sources) {
      const auth = s.authority === "mandatory" ? `${RED}mandatory${RESET}`
        : s.authority === "withdrawn" ? `${RED}WITHDRAWN${RESET}`
        : `${DIM}${s.authority}${RESET}`;
      console.log(`  ${s.id.padEnd(26)} ${auth.padEnd(22)} ${DIM}${s.body}${RESET}`);
      console.log(`  ${" ".repeat(26)} ${s.title}`);
    }
  }
  console.log(`\n${BOLD}${registry.length} sources${RESET}`);
}

async function cmdConflicts(argLimit?: string): Promise<void> {
  const db = openDb();
  const limit = Number(argLimit ?? 20);
  const candidates = findConflictCandidates(db, limit);

  console.log(`${BOLD}Conflict discovery sweep${RESET}`);
  console.log(
    `${DIM}Candidates for human review, not confirmed conflicts. A pair surfaces here when two sources` +
      ` bind the same actor on the same subject from pages years apart. Confirm real conflicts into` +
      ` sources/relations.yaml; this only proposes.${RESET}\n`,
  );

  if (candidates.length === 0) {
    console.log(`${DIM}No candidates above threshold. Either the corpus is well-curated already, or the` +
      ` actor/topic signal is too sparse to say - this sweep is a proposal mechanism, not proof of absence.${RESET}`);
    db.close();
    return;
  }

  candidates.forEach((c, i) => {
    console.log(`${BOLD}${i + 1}. ${c.sourceATitle}${RESET} ${DIM}<->${RESET} ${BOLD}${c.sourceBTitle}${RESET}`);
    console.log(
      `   ${DIM}score ${Math.round(c.score)} · ${c.overlapCount} overlapping obligation(s) · ${c.mandatoryInvolved} mandatory${RESET}`,
    );
    for (const e of c.evidence) {
      const ageYears = (e.ageGapDays / 365.25).toFixed(1);
      console.log(`   ${YELLOW}same actor "${e.actor}", ${ageYears}y apart, shared: ${e.sharedWords.join(", ")}${RESET}`);
      console.log(`     ${STRENGTH_STYLE[e.a.strength]} ${DIM}(${e.a.updatedAt?.slice(0, 10)})${RESET} "${e.a.sentence}"`);
      console.log(`     ${CYAN}${e.a.url}${RESET}`);
      console.log(`     ${STRENGTH_STYLE[e.b.strength]} ${DIM}(${e.b.updatedAt?.slice(0, 10)})${RESET} "${e.b.sentence}"`);
      console.log(`     ${CYAN}${e.b.url}${RESET}`);
    }
    console.log();
  });

  console.log(`${DIM}${candidates.length} candidate pair(s) shown. Not automated judgement - review and curate by hand.${RESET}`);
  db.close();
}

async function cmdExpand(slug?: string): Promise<void> {
  if (!slug) { console.error("usage: compass expand <collection-slug>"); process.exit(1); }
  const docs = await expandCollection(slug);
  console.log(`${docs.length} member documents of ${slug}\n`);
  for (const d of docs) console.log(`  ${d.path}\n    ${DIM}${d.title}${RESET}`);
}


async function cmdVerify(): Promise<void> {
  const db = openDb();
  const h = checkCorpus(db);
  console.log(`${BOLD}Corpus health${RESET}\n`);
  for (const [k, floor] of Object.entries(h.floors)) {
    const got = h.counts[k as keyof typeof h.counts];
    const ok = got >= floor;
    console.log(`  ${ok ? GREEN + "ok" : RED + "LOW"}${RESET}   ${k.padEnd(12)} ${String(got).padStart(6)} ${DIM}(floor ${floor})${RESET}`);
  }
  console.log(`  ${h.ftsWorking ? GREEN + "ok" : RED + "LOW"}${RESET}   ${"fts index".padEnd(12)} ${h.ftsWorking ? "populated" : "EMPTY"}`);
  console.log(`\n${DIM}${h.registered} sources registered; last indexed ${h.indexedAt?.slice(0, 10) ?? "never"}${RESET}`);
  db.close();
  if (!h.ok) {
    console.error(`\n${RED}Corpus below floor:${RESET} ${h.failures.join("; ")}`);
    console.error(`${DIM}A deploy should fail here rather than serve a half-ingested corpus that looks healthy.${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}Corpus is healthy enough to serve.${RESET}`);
}

async function cmdFeedback(arg?: string, file?: string): Promise<void> {
  // The hosted instance writes to Netlify Forms, not to this database. Importing an
  // export is how the two meet, so the reporting below works on hosted data too.
  if (arg === "import") {
    if (!file) {
      console.error("usage: compass feedback import <netlify-export.csv>");
      console.error("Download it from the Netlify dashboard: Forms > compass-feedback / compass-queries > Export CSV.");
      process.exit(1);
    }
    const r = importCsv(file);
    console.log(`Imported ${r.feedback} submission(s) and ${r.queries} question(s)${r.skipped ? `, skipped ${r.skipped} empty or unparseable row(s)` : ""}.`);
    console.log(`${DIM}Re-importing a later export is safe; only new rows are added.${RESET}\n`);
    // Fall through to the summary, which is what you actually wanted to see.
  }
  if (arg === "csv") { process.stdout.write(toCsv(listFeedback(10000) as unknown as Record<string, unknown>[])); return; }
  if (arg === "queries") { process.stdout.write(toCsv(queryReport(10000) as unknown as Record<string, unknown>[])); return; }

  const s = feedbackSummary();
  console.log(`${BOLD}Feedback${RESET} ${DIM}since ${s.since?.slice(0, 10) ?? "no submissions yet"}${RESET}\n`);
  console.log(`  ${s.feedback} submission(s), ${s.rated} rated: ${GREEN}${s.useful} yes${RESET}, ${YELLOW}${s.partly} partly${RESET}, ${RED}${s.notUseful} no${RESET}`);
  console.log(`  ${s.queries} question(s) asked by ${s.people} browser(s); ${s.emptyQueries} returned nothing\n`);

  const comments = listFeedback(20).filter((f) => f.comment);
  if (comments.length) {
    console.log(`${BOLD}Latest comments${RESET}\n`);
    for (const f of comments) {
      console.log(`  ${DIM}${f.created_at.slice(0, 16).replace("T", " ")} · ${f.surface}${f.useful ? ` · ${f.useful}` : ""}${f.role ? ` · ${f.role}` : ""}${RESET}`);
      if (f.question) console.log(`  ${DIM}asked: ${f.question}${RESET}`);
      console.log(`  ${f.comment?.replace(/\s+/g, " ")}`);
      if (f.contact) console.log(`  ${CYAN}${f.contact}${RESET}`);
      console.log();
    }
  }

  // Questions that came back empty are the registry's to-do list, written by users.
  const empty = queryReport(500).filter((q) => q.hits === 0).slice(0, 15);
  if (empty.length) {
    console.log(`${BOLD}Asked, answered with nothing${RESET} ${DIM}(candidate registry gaps)${RESET}\n`);
    for (const q of empty) console.log(`  ${String(q.sessions).padStart(3)} browser(s)  ${q.q}`);
    console.log();
  }
  const served = queryReport(500).filter((q) => q.hits > 0).slice(0, 10);
  if (served.length) {
    console.log(`${BOLD}Most-asked, answered${RESET}\n`);
    for (const q of served) console.log(`  ${String(q.sessions).padStart(3)} browser(s)  ${q.q}`);
  }
  console.log(`\n${DIM}compass feedback csv | compass feedback queries  - full export to stdout${RESET}`);
  console.log(`${DIM}compass feedback import <csv>                    - load a Netlify Forms export${RESET}`);
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "ingest": await cmdIngest(args[0]); break;
  case "ask": await cmdAsk(args.join(" ")); break;
  case "watch": await cmdWatch(args[0]); break;
  case "map": await cmdMap(); break;
  case "list": await cmdList(); break;
  case "conflicts": await cmdConflicts(args[0]); break;
  case "expand": await cmdExpand(args[0]); break;
  case "verify": await cmdVerify(); break;
  case "feedback": await cmdFeedback(args[0], args[1]); break;
  default:
    console.log(`Delivery Compass

  compass ingest [id|spine]  fetch and index guidance content into SQLite
  compass ask "<question>"   cited, extractive answer from the corpus
  compass watch [days]       poll sources and show what changed
  compass map                who owns what, and how it connects
  compass list               show the source registry
  compass conflicts [n]      ranked candidate conflicts for human review
  compass expand <slug>      expand a GOV.UK collection into member documents
  compass verify             assert the corpus is healthy enough to serve (exit 1 if not)
  compass feedback [csv|queries]  what users said, and what they asked that missed
  compass feedback import <csv>   load a Netlify Forms export into the local database
`);
}
