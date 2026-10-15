/**
 * Retrieval evaluation against a hand-marked question set.
 *
 * The test is deliberately weak in one respect and strict in another: it only asks
 * whether the right SOURCE appears in the top 5 (not the exact section), because
 * ranking within a document is not what this tool needs to get right. What it must
 * get right is never sending someone to the wrong document, and never presenting
 * superseded guidance without a warning - so the caveat expectations are strict.
 *
 * It runs the cases twice:
 *
 *   static  - assets/search.js over the exported JSON. This is what a user actually
 *             gets, so it is the one that has to pass. It needs only committed files,
 *             so it still runs on a clean clone with no corpus.db.
 *   sqlite  - the original FTS5 implementation, when corpus.db is present. Kept as a
 *             reference point: the browser engine replaced it, and a silent drop in
 *             agreement between the two is worth seeing before users do.
 *
 * Run: node --experimental-strip-types test/golden.test.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { caveatsFor, loadRelations } from "../pipeline/graph.ts";
// @ts-expect-error - plain ES module, deliberately untyped so the browser loads it as-is
import { buildIndex, searchSections as staticSearch } from "../assets/search.js";

interface Case {
  q: string;
  /** At least one of these source ids must appear in the top 5. */
  expect: string[];
  /**
   * A substring of a doc_path that must appear in the top 5.
   *
   * Source ids are too coarse for some checks: HMT's Test and Learn guide is an
   * attachment of the Magenta Book, so asserting "magenta-book" would pass on any
   * evaluation page at all. These assert the actual document.
   */
  expectPath?: string;
  /** These source ids must be flagged as superseded/conflicting when returned. */
  expectCaveatOn?: string[];
  why?: string;
}

const CASES: Case[] = [
  // --- the change that makes the tool worth building -----------------------
  {
    q: "who approves digital spending in my department",
    expect: ["spend-controls", "tap", "tcop"],
    expectCaveatOn: ["tcop", "agile-business-case"],
    why: "Spend controls were replaced on 2026-04-01; older sources still describe the old regime.",
  },
  {
    q: "do I need Cabinet Office approval for a digital programme",
    expect: ["spend-controls", "tap", "tcop"],
    expectCaveatOn: ["tcop", "agile-business-case"],
  },
  {
    q: "what does the technology code of practice say about spend controls",
    expect: ["tcop"],
    expectCaveatOn: ["tcop"],
    why: "TCoP still instructs readers to follow the abolished Cabinet Office spend control process.",
  },

  // --- digital spine --------------------------------------------------------
  { q: "when do I need a service assessment", expect: ["service-manual", "service-standard"] },
  { q: "what are the points of the service standard", expect: ["service-standard", "service-manual"] },
  { q: "accessibility requirements for a public sector website", expect: ["accessibility-regs", "service-manual"] },
  { q: "how should we evaluate an AI intervention", expect: ["ai-evaluation", "ai-playbook", "magenta-book", "data-ethics"] },
  { q: "what does the technology code of practice require", expect: ["tcop"], expectCaveatOn: ["tcop"] },

  // --- funding and appraisal ------------------------------------------------
  { q: "what goes in the economic case", expect: ["green-book", "tap", "agile-business-case"] },
  { q: "how do I discount future costs and benefits", expect: ["green-book"] },
  { q: "when does HM Treasury need to approve a business case", expect: ["tap", "green-book"] },
  { q: "how does the five case model work for agile delivery", expect: ["agile-business-case", "green-book"] },
  { q: "optimism bias in cost estimates", expect: ["green-book", "tap"] },

  // --- risk -----------------------------------------------------------------
  { q: "how do I set risk appetite", expect: ["orange-book"] },
  { q: "what are the principles of risk management", expect: ["orange-book"] },
  { q: "who is accountable for risk in a department", expect: ["orange-book"] },

  // --- assurance ------------------------------------------------------------
  { q: "what happens at a gate review before investment decision", expect: ["gate-review-3", "gate-review-2"] },
  { q: "what is assessed at strategic assessment", expect: ["gate-review-0", "gate-review-1"] },
  { q: "how is benefits realisation assured", expect: ["gate-review-5", "digital-data-benefits"] },

  // --- evaluation -----------------------------------------------------------
  { q: "how do I design a process evaluation", expect: ["magenta-book"] },
  { q: "what is a theory of change", expect: ["magenta-book"] },

  // --- from real tester sessions, 2026-10-07 --------------------------------
  // The first of these is the question that prompted the ranking fix. "accelerators"
  // stems to "acceler" and matched "Accelerated projects and programmes" in the
  // Treasury Approvals Process - a near-unique term, so BM25 floated an unrelated
  // page above four on-target ones and the tester concluded the corpus had nothing.
  {
    q: "what governance is recommended for test and learn accelerators",
    expect: ["magenta-book"],
    expectPath: "test-and-learn",
    why: "A single rare off-target term must not outrank several on-target ones.",
  },
  { q: "governance for test and learn", expect: ["magenta-book"], expectPath: "test-and-learn" },
  { q: "test and learn", expect: ["magenta-book"], expectPath: "test-and-learn" },
  {
    q: "how should governance change for agile delivery",
    expect: ["service-manual"],
    expectPath: "governance-principles-for-agile",
    why: "GDS published exactly this; a tester looking for it did not reach it.",
  },

  // --- concept bridges (sources/concepts.yaml) ------------------------------
  // These share no content words with the document that answers them, so they fail
  // without the bridge no matter how the ranking is tuned. They are the regression
  // test for concepts.yaml being loaded and applied at all.
  {
    q: "light touch governance for a pilot",
    expect: ["service-manual", "magenta-book"],
    expectPath: "test-and-learn",
    why: "No shared vocabulary with 'Test and Learn'; only the concept bridge connects them.",
  },
  {
    q: "proportionate oversight of an experiment",
    expect: ["magenta-book", "service-manual"],
    why: "Bridged through adaptive-governance.",
  },
  // --- GOV.UK sources read from their PDF (fetchers/govuk-pdf.ts) -------------
  {
    q: "five case model",
    expect: ["business-cases"],
    expectPath: "Guidance_on_Developing_Business_Cases.pdf",
    why: "The 2026 combined guide is PDF only. Fails if it stops parsing or an old edition comes back.",
  },
  // --- the Teal Book, the one source read from a PDF off GOV.UK ---------------
  {
    q: "what does the teal book say about tailoring",
    expect: ["teal-book"],
    expectPath: "projectdelivery.gov.uk/teal-book/home/part-b-tailoring-and-adopting/",
    why: "Named directly. Fails if the nightly PDF stops parsing or its chapter URLs drift.",
  },
  {
    q: "stages of a programme and project life cycle",
    expect: ["teal-book"],
    why: "Teal Book chapter 14 is the only source that sets out the life cycle stage by stage.",
  },
];

const relations = loadRelations();
const SECTIONS_JSON = fileURLToPath(new URL("../assets/data/sections.json", import.meta.url));
const CONCEPTS_JSON = fileURLToPath(new URL("../assets/data/concepts.json", import.meta.url));
const CORPUS_DB = fileURLToPath(new URL("../data/corpus.db", import.meta.url));

/** Run every case against one retrieval function and report. */
function evaluate(
  label: string,
  lookup: (q: string) => string[],
  paths?: (q: string) => string[],
): { failures: string[]; sourcesByQ: Map<string, string[]> } {
  let passed = 0;
  let caveatChecks = 0;
  let caveatPassed = 0;
  const failures: string[] = [];
  const sourcesByQ = new Map<string, string[]>();

  for (const c of CASES) {
    const sources = lookup(c.q);
    sourcesByQ.set(c.q, sources);

    if (c.expect.some((e) => sources.includes(e))) {
      passed++;
    } else {
      failures.push(`  MISS  "${c.q}"\n        expected one of [${c.expect.join(", ")}]\n        got [${sources.join(", ") || "nothing"}]`);
    }

    if (c.expectPath && paths) {
      const got = paths(c.q);
      if (!got.some((p) => p.includes(c.expectPath!))) {
        failures.push(`  WRONG DOC  "${c.q}"\n        expected a path containing "${c.expectPath}"\n        got [${got.map((p) => p.split("/").pop()).join(", ") || "nothing"}]`);
      }
    }

    if (c.expectCaveatOn) {
      const caveats = caveatsFor(sources, relations).map((x) => x.supersededSourceId);
      for (const needed of c.expectCaveatOn) {
        // Only meaningful if the stale source was actually returned.
        if (!sources.includes(needed)) continue;
        caveatChecks++;
        if (caveats.includes(needed)) caveatPassed++;
        else failures.push(`  NO WARNING  "${c.q}" returned ${needed} without a supersession caveat`);
      }
    }
  }

  console.log(`\n${label}`);
  console.log(`  Retrieval: ${passed}/${CASES.length} questions found an expected source in the top 5`);
  console.log(`  Caveats:   ${caveatPassed}/${caveatChecks} superseded sources correctly flagged`);
  if (caveatChecks === 0) {
    failures.push(`  NO CAVEAT ASSERTIONS RAN in ${label} - the supersession path is untested, which is how a 0/0 pass hid a gap before.`);
  }
  return { failures, sourcesByQ };
}

// --- static engine: what a user actually gets --------------------------------
if (!existsSync(SECTIONS_JSON)) {
  console.error("assets/data/sections.json is missing. Run `npm run export` first.");
  process.exit(1);
}
const sections = JSON.parse(readFileSync(SECTIONS_JSON, "utf8")) as { id: number; sourceId: string }[];
// Concepts are passed in because the deployed app passes them: the suite has to
// exercise the configuration users actually get, bridges included.
const concepts = existsSync(CONCEPTS_JSON) ? JSON.parse(readFileSync(CONCEPTS_JSON, "utf8")) : [];
const index = buildIndex(sections);
const byId = new Map(sections.map((s) => [s.id, s]));
const staticRun = evaluate(
  "static (assets/search.js over exported JSON — what ships)",
  (q) => [...new Set((staticSearch(index, byId, q, 5, concepts) as { sourceId: string }[]).map((h) => h.sourceId))],
  (q) => (staticSearch(index, byId, q, 5, concepts) as { docPath: string }[]).map((h) => h.docPath),
);

// --- sqlite engine: reference, only when the database is present -------------
let sqliteRun: ReturnType<typeof evaluate> | null = null;
if (existsSync(CORPUS_DB)) {
  const { openDb } = await import("../pipeline/db.ts");
  const { searchSections: sqliteSearch } = await import("../pipeline/search.ts");
  const db = openDb();
  sqliteRun = evaluate(
    "sqlite (pipeline/search.ts over corpus.db — reference)",
    (q) => [...new Set(sqliteSearch(db, q, 5).map((h) => h.sourceId))],
    (q) => sqliteSearch(db, q, 5).map((h) => h.docPath),
  );
  db.close();

  // Agreement is reported, never asserted. The two engines rank differently by
  // construction, and the cases above are the actual contract; this number exists
  // so a large divergence is visible rather than discovered by a user.
  let overlap = 0;
  let union = 0;
  for (const c of CASES) {
    const a = new Set(staticRun.sourcesByQ.get(c.q) ?? []);
    const b = new Set(sqliteRun.sourcesByQ.get(c.q) ?? []);
    for (const s of a) if (b.has(s)) overlap++;
    union += new Set([...a, ...b]).size;
  }
  console.log(`\nAgreement: ${Math.round((overlap / Math.max(union, 1)) * 100)}% of returned sources are common to both engines.`);
} else {
  console.log("\nsqlite reference skipped — data/corpus.db not present (expected on a clean clone).");
}

// Only the static engine gates: it is the one users hit.
const failures = staticRun.failures;
if (failures.length) {
  console.log(`\n${failures.join("\n")}`);
} else {
  console.log("\nAll cases passed against the engine that ships.");
}
if (sqliteRun?.failures.length) {
  console.log(`\nReference engine also has failures (not gating):\n${sqliteRun.failures.join("\n")}`);
}

process.exitCode = failures.length > 0 ? 1 : 0;
