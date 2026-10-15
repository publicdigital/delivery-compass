/**
 * The Gov Delivery Library MCP server (Delivery Compass's corpus): the protocol and the tools, with no transport.
 *
 * MCP is JSON-RPC 2.0. This module takes one parsed message and returns one response
 * object (or null for a notification). mcp.mjs wraps it in HTTP for Netlify, and
 * scripts/serve.ts wraps it the same way for local testing, so both run this code.
 *
 * Hand-written rather than built on the MCP SDK because the deploy installs no
 * packages (`netlify deploy --dir=.` with no build). The subset a stateless,
 * tools-only server needs is small: initialize, ping, tools/list, tools/call.
 *
 * Retrieval is assets/search.js, unchanged. One search implementation, tested as
 * shipped, now serving three surfaces.
 *
 * The rules from the site carry over, adapted for an answer we do not write:
 *   - Text is returned verbatim, never summarised here.
 *   - A supersession or conflict warning travels in the same result as the text it
 *     applies to, so a model cannot take the quote and miss the warning.
 *   - Every result is dated, and old pages say so.
 *   - An empty search says it is a gap in a curated corpus, not an answer.
 *   - Query expansion is declared, as it is on screen.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, citationUrl, explainQuery, matchConcepts, searchSections } from "../../../assets/search.js";

export const SERVER_VERSION = "0.1.0";
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const FILES = ["meta", "sections", "obligations", "relations", "sources", "concepts", "watch"];

/**
 * Where the exported corpus lives at runtime. Locally and in tests it is next to the
 * repo; in a Netlify Function it arrives via `included_files`, and the bundle's own
 * location relative to it depends on the bundler. Try the plausible places, and say
 * which were tried if none works, rather than failing with a bare ENOENT.
 */
function dataDir() {
  const candidates = [
    process.env.COMPASS_DATA_DIR,
    fileURLToPath(new URL("../../../assets/data/", import.meta.url)),
    process.env.LAMBDA_TASK_ROOT && join(process.env.LAMBDA_TASK_ROOT, "assets/data"),
    join(process.cwd(), "assets/data"),
  ].filter(Boolean);
  const found = candidates.find((d) => existsSync(join(d, "sections.json")));
  if (!found) throw new Error(`corpus not found; looked in ${candidates.join(", ")}`);
  return found;
}

/** Load and index the corpus. Done once per cold start, then reused. */
export function loadCorpus(dir = dataDir()) {
  const d = Object.fromEntries(FILES.map((f) => [f, JSON.parse(readFileSync(join(dir, `${f}.json`), "utf8"))]));
  return {
    ...d,
    index: buildIndex(d.sections),
    sectionById: new Map(d.sections.map((s) => [s.id, s])),
    sourceById: new Map(d.sources.map((s) => [s.id, s])),
  };
}

let cached = null;
const corpus = () => (cached ??= loadCorpus());

// --- formatting ----------------------------------------------------------------

const day = (iso) => (iso ? String(iso).slice(0, 10) : "unknown");

/** Same thresholds as the site's age badge. Always stated, because silence is a claim. */
function age(iso, src) {
  // The Teal Book has no publication date we can read (see
  // pipeline/fetchers/projectdelivery.ts). Its date is when this tool last saw the
  // text change, and calling that "page last updated" would claim more than we know.
  if (src?.fetcher === "projectdelivery_pdf") {
    return `text last seen to change ${iso ? day(iso) : "on an unknown date"} (re-read weekly from the publisher's daily PDF)`;
  }
  if (!iso) return "page date unknown, so currency cannot be vouched for";
  const years = (Date.now() - new Date(iso).getTime()) / (365.25 * 86400000);
  if (years >= 3) return `page last updated ${day(iso)}, over three years ago: verify it is still current`;
  if (years >= 1) return `page last updated ${day(iso)}, over a year ago`;
  return `page last updated ${day(iso)}`;
}

const quote = (text) => String(text).split("\n").map((l) => `> ${l}`).join("\n");

/** Curated supersessions and conflicts that make this source's text unsafe to rely on alone. */
function warningsFor(c, sourceId) {
  return c.relations
    .filter((r) => (r.type === "supersedes" || r.type === "conflicts") && r.to === sourceId)
    .map((r) => {
      const by = c.sourceById.get(r.from)?.title ?? r.from;
      const what = r.type === "supersedes" ? "SUPERSEDED" : "CONFLICT";
      // A conflict is two sources disagreeing, not one replacing the other: Gate 4
      // (August 2026) contradicts a change dated April 2026, and "overtaken" would
      // claim the library knows which is right.
      const relation = r.type === "supersedes" ? "this source is overtaken by" : "this source disagrees with";
      return `**WARNING (${what}, curated):** on ${r.scope ?? "this topic"}${r.effective ? `, since ${r.effective}` : ""}, ` +
        `${relation} "${by}" (\`${r.from}\`). ${r.guidance ?? ""}`.trim();
    });
}

const RANK = { mandatory: 0, recommended: 1, permitted: 2, possible: 3 };

/**
 * The short form to put in a sentence, right after the point it supports. Models copy
 * the shape they are given: a bare "Cite: <url>" line per result got gathered into a
 * list at the end of answers, which testers disliked. A ready-made inline link does not.
 */
function inlineCitation(h) {
  const heading = String(h.heading || "").trim();
  const label = heading && heading !== h.sourceTitle ? `${h.sourceTitle}: ${heading}` : h.sourceTitle;
  return `([${label}](${citationUrl(h)}))`;
}

/** Repeated in every result with sections, because not every client passes on server instructions. */
const CITE_RULE =
  "How to cite: put the \"Cite inline as\" link in your sentence, straight after the point it supports. " +
  "Do not add a sources or references list at the end.";

function footer(c) {
  return `\n---\nCorpus last refreshed ${day(c.meta.indexedAt)}. Unofficial: the Gov Delivery Library is not a government service. ` +
    `Text is quoted from GOV.UK and projectdelivery.gov.uk under the Open Government Licence v3.0; follow the links for the authoritative version.`;
}

// --- tools ---------------------------------------------------------------------

function searchGuidance(c, { question, source_id, limit = 6 }) {
  if (!question || !String(question).trim()) throw new ToolError("question is required");
  const n = Math.min(Math.max(Number(limit) || 6, 1), 10);
  // Restricted to one source, every passage comes from it by design: no per-document cap.
  let hits = searchSections(c.index, c.sectionById, question, source_id ? 80 : n, c.concepts, source_id ? Infinity : undefined);
  if (source_id) {
    if (!c.sourceById.has(source_id)) throw new ToolError(`unknown source_id "${source_id}". Call coverage for the list.`);
    hits = hits.filter((h) => h.sourceId === source_id);
  }
  hits = hits.slice(0, n);

  const out = [];
  const terms = explainQuery(c.index, question);
  const rare = Math.max(5, Math.round(c.sections.length * 0.004));
  if (terms.length) {
    out.push(`Searched for: ${terms.map((t) => (!t.matched ? `${t.raw} (no matches in corpus)` : t.docs <= rare ? `${t.raw} (rare: ${t.docs} sections, weighs heavily)` : t.raw)).join(", ")}`);
  }
  const bridge = matchConcepts(c.concepts, question);
  if (bridge.concepts.length) {
    out.push(`Also searched for: ${[...new Set(bridge.terms)].join(", ")} (because the question looks like it is about ${bridge.concepts.map((x) => x.id).join(", ")})`);
  }
  if (source_id) out.push(`Restricted to source: ${source_id}`);
  if (hits.length) out.push(CITE_RULE);
  out.push("");

  if (hits.length === 0) {
    out.push("**No match in the corpus.** This is a gap in a curated set of sources, not evidence that no rule exists. " +
      "Do not fill it from general knowledge as if it were current guidance. Call `coverage` to see what is and is not in scope, " +
      "or try the question in the words the guidance itself would use.");
    return out.join("\n") + footer(c);
  }

  hits.forEach((h, i) => {
    const src = c.sourceById.get(h.sourceId);
    out.push(`## ${i + 1}. ${h.headingPath || h.heading}`);
    out.push(`Source: ${h.sourceTitle} (\`${h.sourceId}\`), ${h.body}. Authority: ${src ? authorityLabel(src) : h.authority}. ${age(h.updatedAt, src)}.`);
    out.push(`Cite inline as: ${inlineCitation(h)}`);
    for (const w of warningsFor(c, h.sourceId)) out.push(w);

    const obs = (c.obligations[String(h.id)] ?? []).slice().sort((a, b) => (RANK[a.strength] ?? 9) - (RANK[b.strength] ?? 9));
    if (obs.length) {
      out.push("", "Obligations in this section (verbatim, strength from the modal verb):");
      for (const o of obs) {
        const informal = o.conventional ? "" : " (informal phrasing, not the document's declared convention)";
        out.push(`- [${o.strength.toUpperCase()}] "${o.sentence}"${informal}`);
        for (const cc of o.candidateConflicts ?? []) {
          out.push(`  - Possible conflict (machine-suggested, NOT verified): similar wording in "${cc.sourceTitle}", pages about ` +
            `${Math.round((cc.ageGapDays / 365) * 10) / 10} years apart: "${cc.sentence}" ${cc.url}`);
        }
      }
    }
    out.push("", "Section text (verbatim):", quote(h.text));
    if (h.truncated) out.push(`(Section continues at ${citationUrl(h)})`);
    out.push("");
  });
  return out.join("\n") + footer(c);
}

const STATUS = {
  full: "indexed: its text is searchable here",
  metadata_only: "not indexed: GOV.UK publishes only a landing page, and the substance is a PDF or on another site",
  not_indexed: "not indexed",
};

/** "mandatory", or "mandatory (comply or explain)" where the registry qualifies it. */
const authorityLabel = (s) => (s?.authorityNote ? `${s.authority} (${s.authorityNote})` : s?.authority);

function notIndexedReason(s) {
  // A curated reason (sources/*.yaml `not_indexed_reason`) beats the generic one.
  if (s.notIndexedReason && s.fetcher !== "withdrawn") return s.notIndexedReason;
  if (s.fetcher === "withdrawn") return `withdrawn${s.withdrawnOn ? ` on ${s.withdrawnOn}` : ""}${s.withdrawnReason ? `: ${s.withdrawnReason}` : ""}`;
  if (s.fetcher === "nao_wp") return "NAO content is not under the Open Government Licence, so it is linked, never reproduced";
  if (s.fetcher === "local_only") return "held only as a local copy, not published online";
  if (s.fetcher === "off_platform") return "published off GOV.UK with no ingestible edition";
  return STATUS[s.contentStatus] ?? s.contentStatus;
}

function getSource(c, { source_id }) {
  let s = c.sourceById.get(source_id);
  if (!s && source_id) {
    const q = String(source_id).toLowerCase();
    const like = c.sources.filter((x) => x.title.toLowerCase().includes(q) || x.id.includes(q));
    if (like.length === 1) s = like[0];
    else throw new ToolError(`no source with id "${source_id}".${like.length ? ` Did you mean: ${like.map((x) => x.id).join(", ")}?` : " Call coverage for the list."}`);
  }
  if (!s) throw new ToolError("source_id is required");

  const out = [`# ${s.title}`, "", `- id: \`${s.id}\``, `- Owner: ${s.body}`, `- Spine: ${s.spine}`, `- Authority: ${authorityLabel(s)}`,
    `- Licence: ${s.licence}`, `- Canonical URL: ${s.url ?? "none"}`];
  if (s.externalAttachment) out.push(`- Substantive file: ${s.externalAttachment}`);
  if (s.fetcher === "govuk_pdf") {
    out.push("- How it is read: GOV.UK publishes this only as a PDF. The PDF attached to the publication page is re-read weekly, so a new version replaces the old one. " +
      "Citations link to the PDF at the page where the section starts.");
  }
  if (s.fetcher === "projectdelivery_pdf") {
    out.push(`- How it is read: the publisher's own PDF of the whole book, regenerated nightly from the website (${s.pdf}), re-read weekly. ` +
      "Citations link to the matching chapter on the website. The website itself cannot be read automatically.");
  }
  if (s.parent) out.push(`- Part of: \`${s.parent}\``);
  out.push(`- Status: ${s.contentStatus === "full" ? `${STATUS.full} (${s.sections} sections)` : notIndexedReason(s)}`);
  if (s.replacement) out.push(`- Replacement: ${s.replacement}`);

  const warnings = warningsFor(c, s.id);
  if (warnings.length) out.push("", ...warnings);

  const rel = c.relations.filter((r) => r.from === s.id || r.to === s.id);
  out.push("", "## Curated relationships");
  if (rel.length === 0) {
    out.push("None curated. That is a gap in our curation, not evidence that this source stands alone.");
  } else {
    for (const r of rel) {
      const from = c.sourceById.get(r.from)?.title ?? r.from;
      const to = c.sourceById.get(r.to)?.title ?? r.to;
      out.push(`- "${from}" **${r.type.replace("_", " ")}** "${to}"${r.scope ? ` on ${r.scope}` : ""}${r.effective ? ` (since ${r.effective})` : ""}.${r.guidance ? ` ${r.guidance}` : ""}`);
    }
  }

  const notes = c.watch.filter((w) => w.sourceId === s.id);
  if (notes.length) {
    out.push("", s.fetcher === "projectdelivery_pdf"
      ? "## Recent changes (detected by this tool comparing weekly text, not the publisher's words)"
      : "## Recent change notes (the publisher's own words)");
    for (const w of notes) out.push(`- ${day(w.timestamp)}: ${w.note}`);
  }

  if (s.contentStatus === "full") {
    const seen = new Set();
    const heads = [];
    for (const sec of c.sections) {
      if (sec.sourceId !== s.id || seen.has(sec.headingPath)) continue;
      seen.add(sec.headingPath);
      heads.push(`- ${sec.headingPath} (${citationUrl(sec)})`);
    }
    out.push("", `## Contents (${heads.length} headings${heads.length > 40 ? ", first 40 shown" : ""})`, ...heads.slice(0, 40));
  }
  return out.join("\n") + footer(c);
}

function coverage(c) {
  const m = c.meta;
  const out = [
    "# What the Gov Delivery Library covers",
    "",
    `${m.sources} of ${m.registered} registered sources are indexed: ${m.sections} sections and ${m.obligations} extracted obligations, ${m.mandatory} of them mandatory. ` +
      `${m.relations} curated relationships between sources. Corpus last refreshed ${day(m.indexedAt)}; refreshed weekly from GOV.UK and the Government Project Delivery website (the Teal Book).`,
    "",
    "The registry is curated by hand. Anything outside it is out of scope, so silence from this server is not assurance that no rule applies.",
    "",
  ];

  const spines = [...new Set(c.sources.map((s) => s.spine))];
  for (const sp of spines) {
    out.push(`## ${sp}`);
    for (const s of c.sources.filter((x) => x.spine === sp)) {
      const status = s.contentStatus === "full" ? `${s.sections} sections` : `NOT INDEXED: ${notIndexedReason(s)}`;
      out.push(`- \`${s.id}\` ${s.title} (${s.body}, ${authorityLabel(s)}). ${status}`);
    }
    out.push("");
  }

  const related = new Set(c.relations.flatMap((r) => [r.from, r.to]));
  const lonely = c.sources.filter((s) => !related.has(s.id));
  out.push(`## No curated relationships (${lonely.length})`,
    "A gap in our curation, not evidence of independence: these may supersede, conflict with or depend on other sources without that being recorded.",
    lonely.map((s) => `\`${s.id}\``).join(", "));
  return out.join("\n") + footer(c);
}

function recentChanges(c, { days = 90, source_id }) {
  const d = Math.min(Math.max(Number(days) || 90, 1), 730);
  const cutoff = new Date(Date.now() - d * 86400000).toISOString();
  const notes = c.watch.filter((w) => w.timestamp >= cutoff && (!source_id || w.sourceId === source_id));
  const out = [`# Change notes, last ${d} days${source_id ? `, \`${source_id}\`` : ""}`,
    "In the publisher's own words, newest first. Only notes the publisher wrote are listed: a page can change without one. " +
      "The exception is the Teal Book (`teal-book`): its publisher's notes cannot be read automatically, so its entries are this tool's own, from comparing each week's text with the last.", ""];
  if (notes.length === 0) out.push("None recorded in this window.");
  for (const w of notes) out.push(`- **${day(w.timestamp)}** ${w.sourceTitle} (\`${w.sourceId}\`, ${w.body}): ${w.note}${w.liveUrl ? ` ${w.liveUrl}` : ""}`);
  return out.join("\n") + footer(c);
}

// --- protocol ------------------------------------------------------------------

class ToolError extends Error {}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS = [
  {
    name: "search_guidance",
    title: "Search UK government delivery guidance",
    description:
      "Search the curated corpus of UK government delivery guidance (HM Treasury Green Book and business cases, NISTA assurance and gate reviews, " +
      "GDS Service Manual and Service Standard, Technology Code of Practice, Orange Book risk, evaluation and more). Returns matching sections verbatim " +
      "with citation links, page dates, extracted obligations labelled MANDATORY/RECOMMENDED/PERMITTED/POSSIBLE, and any curated warning that a source " +
      "has been superseded. Quote MANDATORY text verbatim, cite the link, and repeat any WARNING alongside the text it applies to.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "What to look for, in plain words. The words the guidance itself would use work best." },
        source_id: { type: "string", description: "Optional: restrict to one source, by id (see coverage)." },
        limit: { type: "integer", minimum: 1, maximum: 10, default: 6, description: "Number of sections to return." },
      },
      required: ["question"],
    },
    annotations: { title: "Search guidance", ...READ_ONLY },
    run: searchGuidance,
  },
  {
    name: "get_source",
    title: "Describe one source",
    description:
      "One registered source: owner, authority, licence, canonical URL, whether it is indexed (and why not), curated relationships to other sources " +
      "(supersedes, conflicts, requires, gates...), recent change notes, and its contents with links.",
    inputSchema: {
      type: "object",
      properties: { source_id: { type: "string", description: "Source id, e.g. green-book, tcop, service-standard. Call coverage for the list." } },
      required: ["source_id"],
    },
    annotations: { title: "Describe source", ...READ_ONLY },
    run: getSource,
  },
  {
    name: "coverage",
    title: "What the corpus covers",
    description:
      "The declared boundary of the corpus: every registered source by spine with its id, which are not indexed and why, which have no curated " +
      "relationships, and when it was last refreshed. Call this to find source ids, or before treating an empty search as meaningful.",
    inputSchema: { type: "object", properties: {} },
    annotations: { title: "Coverage", ...READ_ONLY },
    run: coverage,
  },
  {
    name: "recent_changes",
    title: "Recent changes to the guidance",
    description: "Change notes published by the guidance owners, in their own words, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 730, default: 90, description: "How far back to look." },
        source_id: { type: "string", description: "Optional: one source only." },
      },
    },
    annotations: { title: "Recent changes", ...READ_ONLY },
    run: recentChanges,
  },
];

export const INSTRUCTIONS = `The Gov Delivery Library serves UK government delivery guidance from a hand-curated registry of sources, refreshed weekly from GOV.UK and the Government Project Delivery website. It is unofficial.

When you answer from these tools:
- Quote requirements labelled MANDATORY verbatim, in quotation marks. Never paraphrase one.
- Cite inline, never at the end. Each result has a "Cite inline as" link: put it in your sentence straight after the point it supports, for example: Digital and technology spend above the department's delegated limit needs HM Treasury approval ([Getting approval to spend money on a service: When you need extra approval or support](https://www.gov.uk/...)). Do not write a "Sources" or "References" section, and do not use numbered footnotes.
- If something comes from your own knowledge rather than these tools, say so.
- When a result carries a WARNING (superseded or conflict), state it before or alongside the text it applies to.
- Mention the page date when a result says the page is old.
- "Possible conflict (NOT verified)" notes are machine suggestions. Present them as such, never as fact.
- If a search finds nothing, say the corpus has a gap there. Do not fill it from memory as if it were current guidance. Call coverage to see what is in scope.`;

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/**
 * Handle one JSON-RPC message. Returns the response, or null for a notification.
 * @param {any} msg
 * @param {() => object} [getCorpus]  injectable for tests
 */
export function handleMessage(msg, getCorpus = corpus) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return fail(msg?.id, -32600, "Invalid Request");
  }
  const { id, method, params = {} } = msg;
  if (id === undefined || id === null) return null; // notifications need no answer

  switch (method) {
    case "initialize": {
      const asked = params.protocolVersion;
      return ok(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "gov-delivery-library", title: "Gov Delivery Library", version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS.map(({ run, ...t }) => t) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const text = tool.run(getCorpus(), params.arguments ?? {});
        return ok(id, { content: [{ type: "text", text }], isError: false });
      } catch (e) {
        // Bad arguments are the model's to fix, so they come back as a tool result it
        // can read. Anything else is ours, and is a protocol error.
        if (e instanceof ToolError) return ok(id, { content: [{ type: "text", text: e.message }], isError: true });
        return fail(id, -32603, `Internal error: ${e.message}`);
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}
