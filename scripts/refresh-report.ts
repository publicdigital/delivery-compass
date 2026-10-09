/**
 * Summarise a refresh for the person who curates the registry.
 *
 * Run after `npm run refresh`, before the result is committed. It compares the newly
 * exported corpus with the one at HEAD and prints markdown: how the counts moved,
 * which change notes are new since the last refresh, and anything the pipeline
 * flagged for a human (see pipeline/review.ts). The scheduled workflow puts this in
 * the job summary and, when there is something to act on, opens an issue with it.
 *
 * A new change note goes in the queue even though the corpus already carries the new
 * text: the text refreshes itself, the relations in sources/relations.yaml do not. A
 * page that has just changed is the page whose supersessions and conflicts might no
 * longer hold.
 *
 *   node --experimental-strip-types scripts/refresh-report.ts [review-file]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

type Meta = { sources: number; sections: number; obligations: number; mandatory: number; registered: number; relations: number };
type Note = { sourceId: string; sourceTitle: string; body: string; timestamp: string; note: string; liveUrl?: string };

function atHead<T>(path: string): T | null {
  try {
    return JSON.parse(execFileSync("git", ["show", `HEAD:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 })) as T;
  } catch {
    return null;
  }
}

const now = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")) as T;

const reviewFile = process.argv[2] ?? process.env.COMPASS_REVIEW;
const flagged = reviewFile && existsSync(reviewFile) ? readFileSync(reviewFile, "utf8").trim() : "";

const before = atHead<Meta>("assets/data/meta.json");
const after = now<Meta>("assets/data/meta.json");
const key = (n: Note) => `${n.sourceId}|${n.timestamp}|${n.note}`;
const seen = new Set((atHead<Note[]>("assets/data/watch.json") ?? []).map(key));
const fresh = now<Note[]>("assets/data/watch.json").filter((n) => !seen.has(key(n)));

const out: string[] = [];
out.push(`## Corpus refresh, ${new Date().toISOString().slice(0, 10)}`, "");

out.push("| | Before | After | |", "| --- | ---: | ---: | ---: |");
for (const k of ["sources", "sections", "obligations", "mandatory", "registered", "relations"] as const) {
  const b = before?.[k];
  const a = after[k];
  const d = b === undefined ? "" : a === b ? "" : a > b ? `+${a - b}` : `${a - b}`;
  out.push(`| ${k} | ${b ?? "?"} | ${a} | ${d} |`);
}
out.push("");

out.push("### Needs a curator", "");
out.push(flagged || "Nothing flagged by ingest or watch.", "");

out.push("### New change notes since the last refresh", "");
if (fresh.length === 0) {
  out.push("None.");
} else {
  out.push("The text below is already in the corpus. Check whether each change affects a relation in `sources/relations.yaml`, or warrants a new one.", "");
  for (const n of fresh) {
    const title = n.liveUrl ? `[${n.sourceTitle}](${n.liveUrl})` : n.sourceTitle;
    out.push(`- **${n.timestamp.slice(0, 10)}** ${title} (${n.body}): ${n.note.replace(/\s+/g, " ").slice(0, 300)}`);
  }
}
out.push("");

console.log(out.join("\n"));

const needsReview = flagged.length > 0 || fresh.length > 0;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `needs_review=${needsReview}\n`);
