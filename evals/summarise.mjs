/**
 * Reads the transcripts evals/run.sh wrote and prints a markdown summary: per question,
 * which library tools Claude called, and for out-of-scope questions whether the answer
 * says the library does not cover it (a rough text match: read the answer to be sure).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, label, model, others] = process.argv.slice(2);
const SERVER = "mcp__gov-delivery-library__";
// Wording that admits the library has nothing on it. Loose on purpose; check by eye.
const SAYS_NOT_COVERED = /out of scope|outside (the|its) (scope|coverage)|(doesn't|does not|don't|do not) (cover|include|hold)|not (covered|included|in the (library|corpus))|no (results|match)|exclude|gap/i;

const rows = readdirSync(dir).filter((f) => f.endsWith(".q")).sort().map((f) => {
  const n = f.slice(0, -2);
  const [kind, question] = readFileSync(join(dir, f), "utf8").trim().split("|");
  const tools = [];
  const otherTools = [];
  let answer = "";
  let answered = false;
  for (const line of readFileSync(join(dir, `${n}.jsonl`), "utf8").split("\n")) {
    if (!line) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    for (const block of event.message?.content ?? []) {
      if (block.type !== "tool_use") continue;
      if (block.name.startsWith(SERVER)) tools.push(block.name.slice(SERVER.length));
      else otherTools.push(block.name);
    }
    if (event.type === "result") { answered = true; answer = event.result ?? ""; }
  }
  return { n, kind, question, tools, otherTools, answer, answered, notCovered: SAYS_NOT_COVERED.test(answer) };
});

// A run with no answer at all failed; it says nothing about Claude's choice, so it is
// left out of the counts and listed instead.
const failed = rows.filter((r) => !r.answered);
const share = (kind, test) => {
  const of = rows.filter((r) => r.kind === kind && r.answered);
  return `${of.filter(test).length} of ${of.length}`;
};
const used = (r) => r.tools.length > 0;
const counts = {};
for (const r of rows) for (const t of r.tools) counts[t] = (counts[t] ?? 0) + 1;

const out = [
  `# Tool-use eval: ${label}`,
  "",
  `- **In scope, library not named: used on ${share("in", used)}**`,
  `- Named the library (control): used on ${share("control", used)}`,
  `- Out of scope: said not covered on ${share("out", (r) => r.notCovered)} (text match, check below)`,
  `- Tool calls: ${Object.entries(counts).map(([t, c]) => `${t} ${c}`).join(", ") || "none"}`,
  ...(failed.length ? [`- **Failed runs, not counted: ${failed.map((r) => r.n).join(", ")}**`] : []),
  "",
  `Run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC with Claude Code (\`${model}\`), ${others ? `this MCP server plus ${others.split(",").join(", ")}` : "this MCP server as its only tool"}, no project instructions.`,
  "",
  "| # | Kind | Question | Library tools called | Other tools |",
  "|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.n} | ${r.kind} | ${r.question} | ${!r.answered ? "(run failed)" : r.tools.join(", ") || "**none**"}${r.kind === "out" ? (r.notCovered ? " (says not covered)" : " (**does not say** not covered)") : ""} | ${r.otherTools.join(", ")} |`),
  "",
  "## Out-of-scope answers",
  "",
  ...rows.filter((r) => r.kind === "out").flatMap((r) => [`### ${r.question}`, "", r.answer.trim().split("\n").map((l) => `> ${l}`).join("\n"), ""]),
];
console.log(out.join("\n"));
