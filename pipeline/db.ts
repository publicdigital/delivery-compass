import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

// Overridable so a deployment can put the corpus somewhere other than the repo -
// a read-only image layer, or a mounted volume - without the code caring which.
const DB_PATH = process.env.COMPASS_DB
  ? process.env.COMPASS_DB
  : fileURLToPath(new URL("../data/corpus.db", import.meta.url));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  spine         TEXT NOT NULL,
  authority     TEXT NOT NULL,
  slug          TEXT,
  licence       TEXT,
  live_url      TEXT,
  public_updated_at TEXT,
  indexed_at    TEXT,
  -- "full" when real guidance text was ingested; "metadata_only" when GOV.UK offers
  -- nothing but a landing-page summary (the substance being a PDF or off-platform).
  -- metadata_only sources are excluded from retrieval so a one-line blurb can never
  -- be returned as though it were guidance.
  content_status TEXT NOT NULL DEFAULT 'full',
  -- True where the document sets out the "shall denotes a requirement" convention.
  declares_convention INTEGER NOT NULL DEFAULT 0,
  note          TEXT
);

-- One row per heading-delimited section of a document.
CREATE TABLE IF NOT EXISTS sections (
  id            INTEGER PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  doc_path      TEXT NOT NULL,       -- the GOV.UK path this section came from
  anchor        TEXT,                -- heading id, for deep linking
  heading       TEXT NOT NULL,
  heading_path  TEXT NOT NULL,       -- "3. Risk management > 3.2 Risk appetite"
  level         INTEGER NOT NULL,
  ordinal       INTEGER NOT NULL,
  text          TEXT NOT NULL,
  -- The date of the page this section came from. A source like the Service Manual
  -- spans 144 pages with 144 different update dates; reporting the homepage date
  -- for all of them would misstate currency, which is the one thing this tool
  -- must not do.
  doc_updated_at TEXT
);
CREATE INDEX IF NOT EXISTS sections_source ON sections(source_id);

-- One row per detected obligation sentence.
CREATE TABLE IF NOT EXISTS obligations (
  id            INTEGER PRIMARY KEY,
  section_id    INTEGER NOT NULL REFERENCES sections(id),
  source_id     TEXT NOT NULL REFERENCES sources(id),
  strength      TEXT NOT NULL,       -- mandatory | recommended | permitted | possible
  modal         TEXT NOT NULL,       -- the word that triggered it
  sentence      TEXT NOT NULL,
  actor         TEXT,                -- best-effort subject, e.g. "the SRO"
  conventional  INTEGER NOT NULL DEFAULT 1  -- modal is part of the document's declared convention
);
CREATE INDEX IF NOT EXISTS obligations_source ON obligations(source_id);
CREATE INDEX IF NOT EXISTS obligations_strength ON obligations(strength);

-- Snapshots of source state, for change detection over time.
CREATE TABLE IF NOT EXISTS snapshots (
  id            INTEGER PRIMARY KEY,
  source_id     TEXT NOT NULL,
  checked_at    TEXT NOT NULL,
  public_updated_at TEXT,
  content_hash  TEXT,
  change_history TEXT,               -- JSON
  redirect_to   TEXT,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS snapshots_source ON snapshots(source_id, checked_at);

CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
  heading, text, content='sections', content_rowid='id', tokenize='porter unicode61'
);
`;

export function openDb(): DatabaseSync {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

/** FTS5 external-content tables need explicit repopulation after a bulk load. */
export function rebuildFts(db: DatabaseSync): void {
  db.exec("INSERT INTO sections_fts(sections_fts) VALUES('rebuild')");
}

export { DB_PATH };
