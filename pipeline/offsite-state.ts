/**
 * What we last saw of sources that are not on GOV.UK, kept in git.
 *
 * GOV.UK tells us when a page changed and, usually, why: `public_updated_at` and
 * `change_history`. projectdelivery.gov.uk tells a non-browser client nothing, and
 * its PDF is regenerated every night whether or not a word moved, so its file date
 * means nothing either. The only honest signal is the text itself: hash it, and
 * compare with last time.
 *
 * "Last time" cannot live in data/corpus.db. The scheduled refresh starts from an
 * empty database every week, so it would see every source for the first time,
 * forever. This file is committed alongside assets/data/ instead, which makes the
 * previous refresh's commit the baseline.
 *
 * The notes written here are ours, not the publisher's, and say so. They name the
 * chapters whose text changed; the publisher's own account of why is on their site.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ChangeNote } from "./types.ts";

const PATH = fileURLToPath(new URL("../data/offsite-state.json", import.meta.url));

/** How many of our own change notes to keep per source. */
const KEEP_NOTES = 20;

export interface OffsiteState {
  version: string | null;
  contentHash: string;
  /** Chapter URL to hash of its text, to say which chapters moved. */
  chapters: Record<string, string>;
  /** When the text was last seen to change, or first recorded. */
  changedAt: string;
  firstRecordedAt: string;
  notes: ChangeNote[];
}

type StateFile = Record<string, OffsiteState>;

function readAll(): StateFile {
  return existsSync(PATH) ? (JSON.parse(readFileSync(PATH, "utf8")) as StateFile) : {};
}

export function readOffsiteState(sourceId: string): OffsiteState | undefined {
  return readAll()[sourceId];
}

/**
 * Record what an ingest found, and return the state now on file. A change in the
 * text adds a note naming the chapters that moved; an identical text changes
 * nothing, so the file (and the commit) stays quiet on an ordinary week.
 */
export function recordOffsiteText(
  sourceId: string,
  seen: { version: string | null; contentHash: string; chapters: { url: string; title: string; hash: string }[] },
  updatesUrl: string,
): { state: OffsiteState; changed: ChangeNote | null } {
  const all = readAll();
  const prior = all[sourceId];
  const now = new Date().toISOString();
  const chapters = Object.fromEntries(seen.chapters.map((c) => [c.url, c.hash]));

  if (prior && prior.contentHash === seen.contentHash && prior.version === seen.version) {
    return { state: prior, changed: null };
  }

  let changed: ChangeNote | null = null;
  if (prior) {
    const moved = seen.chapters.filter((c) => prior.chapters[c.url] !== c.hash).map((c) => c.title);
    const gone = Object.keys(prior.chapters).filter((u) => !(u in chapters));
    const parts: string[] = [];
    if (prior.version !== seen.version) parts.push(`Version ${prior.version ?? "unknown"} is now ${seen.version ?? "unknown"}.`);
    if (moved.length) parts.push(`Text changed in ${moved.length} chapter(s): ${moved.join("; ")}.`);
    if (gone.length) parts.push(`${gone.length} chapter page(s) no longer in the book: ${gone.join(", ")}.`);
    parts.push(`Detected by comparing this week's text with last week's; the publisher's own notes are at ${updatesUrl}`);
    changed = { timestamp: now, note: parts.join(" ") };
  }

  const state: OffsiteState = {
    version: seen.version,
    contentHash: seen.contentHash,
    chapters,
    changedAt: now,
    firstRecordedAt: prior?.firstRecordedAt ?? now,
    notes: [...(changed ? [changed] : []), ...(prior?.notes ?? [])].slice(0, KEEP_NOTES),
  };
  all[sourceId] = state;
  writeFileSync(PATH, JSON.stringify(all, null, 2) + "\n");
  return { state, changed };
}
