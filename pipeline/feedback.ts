import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

// Deliberately a *separate* database from corpus.db. The corpus is a build artefact -
// thrown away and re-ingested on every deploy - whereas feedback is the only thing in
// this system that cannot be regenerated. Keeping them apart means a corpus rebuild
// can never take the research data with it, and the two can live on different disks
// (image layer vs. mounted volume) without ceremony.
const FEEDBACK_DB = process.env.FEEDBACK_DB
  ? process.env.FEEDBACK_DB
  : fileURLToPath(new URL("../data/feedback.db", import.meta.url));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY,
  created_at  TEXT NOT NULL,
  surface     TEXT NOT NULL,          -- ask | map | watch | general
  useful      TEXT,                   -- yes | partly | no, when they answered that
  question    TEXT,                   -- what they had asked, carried over from the Ask box
  comment     TEXT,                   -- free text
  role        TEXT,                   -- optional, self-described
  contact     TEXT,                   -- optional, only if volunteered
  -- A random per-browser id. Enough to tell "one person asked six things" from "six
  -- people asked one thing" - the distinction that decides whether a gap is real -
  -- without storing anything that identifies a person. Never an IP address.
  session     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback(created_at);

-- Every question asked, with how many sections came back. Queries that return nothing
-- are the highest-value thing this deployment can learn: they say what people expect
-- the corpus to cover and it does not. Nobody has to write feedback for this to work.
CREATE TABLE IF NOT EXISTS queries (
  id          INTEGER PRIMARY KEY,
  created_at  TEXT NOT NULL,
  q           TEXT NOT NULL,
  hits        INTEGER NOT NULL,
  obligations INTEGER NOT NULL,
  session     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS queries_created ON queries(created_at);
CREATE INDEX IF NOT EXISTS queries_hits ON queries(hits);
`;

let cached: DatabaseSync | null = null;

export function openFeedbackDb(): DatabaseSync {
  if (cached) return cached;
  mkdirSync(dirname(FEEDBACK_DB), { recursive: true });
  const db = new DatabaseSync(FEEDBACK_DB);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  cached = db;
  return db;
}

/** Caps on stored text. Long enough for a real paragraph of feedback, short enough
 *  that an unauthenticated write endpoint cannot be used to fill the disk. */
const LIMITS = { comment: 4000, question: 500, role: 200, contact: 200, q: 500, session: 64 };

function clip(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export type FeedbackInput = {
  surface?: unknown;
  useful?: unknown;
  question?: unknown;
  comment?: unknown;
  role?: unknown;
  contact?: unknown;
  session?: unknown;
};

const SURFACES = new Set(["ask", "map", "watch", "general"]);
const USEFUL = new Set(["yes", "partly", "no"]);

export function recordFeedback(input: FeedbackInput): { ok: true } | { ok: false; error: string } {
  const surface = typeof input.surface === "string" && SURFACES.has(input.surface) ? input.surface : "general";
  const useful = typeof input.useful === "string" && USEFUL.has(input.useful) ? input.useful : null;
  const comment = clip(input.comment, LIMITS.comment);
  if (!useful && !comment) return { ok: false, error: "nothing to record" };

  const row = {
    created_at: new Date().toISOString(),
    surface,
    useful,
    question: clip(input.question, LIMITS.question),
    comment,
    role: clip(input.role, LIMITS.role),
    contact: clip(input.contact, LIMITS.contact),
    session: clip(input.session, LIMITS.session) ?? "anon",
  };

  openFeedbackDb().prepare(
    `INSERT INTO feedback (created_at, surface, useful, question, comment, role, contact, session)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.created_at, row.surface, row.useful, row.question, row.comment, row.role, row.contact, row.session);

  // Mirrored to stdout as one JSON line so the platform's log drain holds a copy. If
  // the volume is ever lost, misconfigured, or replaced, the feedback still exists
  // somewhere - the failure mode of a research instance quietly recording nothing is
  // worse than duplication.
  console.log(JSON.stringify({ evt: "feedback", ...row }));
  return { ok: true };
}

export function recordQuery(q: string, hits: number, obligations: number, session: string | null): void {
  const text = clip(q, LIMITS.q);
  if (!text) return;
  const at = new Date().toISOString();
  const sess = clip(session, LIMITS.session) ?? "anon";
  openFeedbackDb().prepare(
    "INSERT INTO queries (created_at, q, hits, obligations, session) VALUES (?, ?, ?, ?, ?)",
  ).run(at, text, hits, obligations, sess);
  console.log(JSON.stringify({ evt: "query", created_at: at, q: text, hits, obligations, session: sess }));
}

export type FeedbackRow = {
  id: number; created_at: string; surface: string; useful: string | null;
  question: string | null; comment: string | null; role: string | null;
  contact: string | null; session: string;
};

export function listFeedback(limit = 500): FeedbackRow[] {
  return openFeedbackDb()
    .prepare("SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?")
    .all(limit) as unknown as FeedbackRow[];
}

export type QueryRow = { q: string; asks: number; sessions: number; hits: number; lastAt: string };

/** Questions grouped by text, worst-served first. A query with zero hits asked by
 *  several different people is a registry gap with evidence attached. */
export function queryReport(limit = 200): QueryRow[] {
  return openFeedbackDb().prepare(
    `SELECT lower(q) AS q, COUNT(*) AS asks, COUNT(DISTINCT session) AS sessions,
            MAX(hits) AS hits, MAX(created_at) AS lastAt
     FROM queries GROUP BY lower(q)
     ORDER BY (MAX(hits) = 0) DESC, COUNT(DISTINCT session) DESC, COUNT(*) DESC
     LIMIT ?`,
  ).all(limit) as unknown as QueryRow[];
}

export function feedbackSummary(): {
  feedback: number; rated: number; useful: number; partly: number; notUseful: number;
  queries: number; emptyQueries: number; people: number; since: string | null;
} {
  const db = openFeedbackDb();
  const f = db.prepare(
    `SELECT COUNT(*) AS feedback,
            SUM(useful IS NOT NULL) AS rated,
            SUM(useful = 'yes') AS useful,
            SUM(useful = 'partly') AS partly,
            SUM(useful = 'no') AS notUseful,
            MIN(created_at) AS since
     FROM feedback`,
  ).get() as Record<string, number | string | null>;
  const q = db.prepare(
    "SELECT COUNT(*) AS queries, SUM(hits = 0) AS emptyQueries, COUNT(DISTINCT session) AS people FROM queries",
  ).get() as Record<string, number>;
  return {
    feedback: Number(f.feedback ?? 0), rated: Number(f.rated ?? 0), useful: Number(f.useful ?? 0),
    partly: Number(f.partly ?? 0), notUseful: Number(f.notUseful ?? 0),
    queries: Number(q.queries ?? 0), emptyQueries: Number(q.emptyQueries ?? 0),
    people: Number(q.people ?? 0), since: (f.since as string | null) ?? null,
  };
}

/** RFC 4180-ish. Feedback comments contain commas, quotes and newlines as a matter of course. */
export function toCsv(rows: Record<string, unknown>[]): string {
  const first = rows[0];
  if (!first) return "";
  const cols = Object.keys(first);
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

export { FEEDBACK_DB };
