/**
 * Load a Netlify Forms CSV export into the local feedback database.
 *
 * Feedback used to be written directly by the Node server. On static hosting there is
 * no server, so submissions land in Netlify Forms instead and are exported as CSV.
 * This brings them back into the same SQLite shape the analysis commands already
 * read, so `compass feedback` keeps working unchanged — the reporting is the useful
 * part, and it should not have to care where the rows came from.
 *
 * Two shapes are accepted, matching the two forms declared in index.html:
 *   compass-feedback — one row per rating or written comment
 *   compass-queries  — one row per session, with a JSON array of questions asked
 *
 * Re-importing the same export is safe: rows are keyed on their submission time plus
 * content, so a second run of a growing export adds only what is new.
 */
import { readFileSync } from "node:fs";
import { openFeedbackDb } from "./feedback.ts";

/** RFC 4180 parser: fields may be quoted, contain commas, newlines and "" escapes. */
export function parseCsv(input: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);

  const header = rows.shift();
  if (!header) return [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

/** Netlify names its timestamp column inconsistently across exports; accept any of them. */
function timestampOf(row: Record<string, string>): string {
  const raw = row["Created at"] ?? row["created_at"] ?? row["Date"] ?? row["at"] ?? "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export function importCsv(path: string): { feedback: number; queries: number; skipped: number } {
  const rows = parseCsv(readFileSync(path, "utf8"));
  const db = openFeedbackDb();

  const insertFeedback = db.prepare(
    `INSERT INTO feedback (created_at, surface, useful, question, comment, role, contact, session)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM feedback WHERE created_at = ? AND IFNULL(comment,'') = IFNULL(?,'') AND IFNULL(useful,'') = IFNULL(?,'')
     )`,
  );
  const insertQuery = db.prepare(
    `INSERT INTO queries (created_at, q, hits, obligations, session)
     SELECT ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM queries WHERE created_at = ? AND q = ? AND session = ?)`,
  );

  let feedback = 0;
  let queries = 0;
  let skipped = 0;

  for (const row of rows) {
    const at = timestampOf(row);
    const session = blank(row.session) ?? "anon";

    // A queries row carries the whole session's questions as a JSON array.
    if (row.queries?.trim()) {
      let parsed: { q: string; hits: number; obligations: number; at?: string }[] = [];
      try {
        parsed = JSON.parse(row.queries);
      } catch {
        skipped++;
        continue;
      }
      for (const q of parsed) {
        if (!q?.q) continue;
        const qAt = q.at ?? at;
        const info = insertQuery.run(qAt, q.q, Number(q.hits ?? 0), Number(q.obligations ?? 0), session, qAt, q.q, session);
        if (info.changes) queries++;
      }
      continue;
    }

    const useful = blank(row.useful);
    const comment = blank(row.comment);
    if (!useful && !comment) { skipped++; continue; }

    const info = insertFeedback.run(
      at, blank(row.surface) ?? "ask", useful, blank(row.question), comment,
      blank(row.role), blank(row.contact), session,
      at, comment, useful,
    );
    if (info.changes) feedback++;
  }

  // Deliberately not closed: openFeedbackDb() hands out a shared connection that the
  // reporting commands reuse straight after an import.
  return { feedback, queries, skipped };
}
