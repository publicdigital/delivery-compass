/**
 * Retrieval evaluation against a hand-marked question set.
 *
 * The test is deliberately weak in one respect and strict in another: it only asks
 * whether the right SOURCE appears in the top 5 (not the exact section), because
 * ranking within a document is not what this tool needs to get right. What it must
 * get right is never sending someone to the wrong document, and never presenting
 * superseded guidance without a warning - so the caveat expectations are strict.
 *
 * Run: node --experimental-strip-types test/golden.test.ts
 */
import { openDb } from "../pipeline/db.ts";
import { caveatsFor, loadRelations } from "../pipeline/graph.ts";
import { searchSections } from "../pipeline/search.ts";

interface Case {
  q: string;
  /** At least one of these source ids must appear in the top 5. */
  expect: string[];
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
];

const db = openDb();
const relations = loadRelations();

let passed = 0;
let caveatChecks = 0;
let caveatPassed = 0;
const failures: string[] = [];

for (const c of CASES) {
  const hits = searchSections(db, c.q, 5);
  const sources = [...new Set(hits.map((h) => h.sourceId))];
  const hit = c.expect.some((e) => sources.includes(e));

  if (hit) {
    passed++;
  } else {
    failures.push(`  MISS  "${c.q}"\n        expected one of [${c.expect.join(", ")}]\n        got [${sources.join(", ") || "nothing"}]`);
  }

  if (c.expectCaveatOn) {
    const caveats = caveatsFor(sources, relations).map((x) => x.supersededSourceId);
    for (const needed of c.expectCaveatOn) {
      // Only meaningful if the stale source was actually returned.
      if (!sources.includes(needed)) continue;
      caveatChecks++;
      if (caveats.includes(needed)) {
        caveatPassed++;
      } else {
        failures.push(`  NO WARNING  "${c.q}" returned ${needed} without a supersession caveat`);
      }
    }
  }
}

console.log(`\nRetrieval: ${passed}/${CASES.length} questions found an expected source in the top 5`);
console.log(`Caveats:   ${caveatPassed}/${caveatChecks} superseded sources correctly flagged`);
if (caveatChecks === 0) {
  failures.push("  NO CAVEAT ASSERTIONS RAN - the supersession path is untested, which is how a 0/0 pass hid a gap before.");
}

if (failures.length) {
  console.log(`\n${failures.join("\n")}`);
} else {
  console.log("\nAll cases passed.");
}
db.close();

process.exitCode = failures.length > 0 ? 1 : 0;
