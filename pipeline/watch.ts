import type { DatabaseSync } from "node:sqlite";
import { checkSource } from "./fetchers/govuk.ts";
import type { ChangeNote, Source } from "./types.ts";

export interface ChangeEvent {
  sourceId: string;
  sourceTitle: string;
  body: string;
  spine: string;
  authority: string;
  timestamp: string;
  /** The publisher's own words, where GOV.UK provides them. */
  note: string;
  kind: "published-note" | "first-seen" | "date-moved" | "redirected" | "withdrawn" | "error";
  liveUrl?: string;
}

interface SnapshotRow {
  public_updated_at: string | null;
  content_hash: string | null;
  redirect_to: string | null;
}

/**
 * Poll every source and record a snapshot.
 *
 * Change detection is a cheap timestamp comparison: GOV.UK exposes
 * `public_updated_at`, so there is no need to download and diff content just to
 * learn that nothing moved. Where something did move, `details.change_history`
 * usually carries a human-authored note explaining what and why, which beats any
 * machine diff we could produce.
 */
export async function poll(
  db: DatabaseSync,
  sources: Source[],
  onProgress?: (source: Source) => void,
): Promise<ChangeEvent[]> {
  const events: ChangeEvent[] = [];
  const previous = db.prepare(
    `SELECT public_updated_at, content_hash, redirect_to FROM snapshots
     WHERE source_id = ? ORDER BY checked_at DESC LIMIT 1`,
  );
  const insert = db.prepare(
    `INSERT INTO snapshots (source_id, checked_at, public_updated_at, content_hash, change_history, redirect_to, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const slugById = new Map(sources.map((s) => [s.id, s.slug]));

  for (const source of sources) {
    onProgress?.(source);
    // An attachment source has no slug of its own; its state comes from the
    // publication it hangs off, so resolve the parent's slug for the check.
    const parentSlug = source.parent ? slugById.get(source.parent) : undefined;
    const state = await checkSource(source, parentSlug);
    const prior = previous.get(source.id) as SnapshotRow | undefined;

    const base = {
      sourceId: source.id,
      sourceTitle: source.title,
      body: source.body,
      spine: source.spine,
      authority: source.authority,
      liveUrl: source.slug ? `https://www.gov.uk${source.slug}` : source.endpoint,
    };

    if (!state.ok) {
      events.push({ ...base, timestamp: state.checkedAt, note: state.error ?? "check failed", kind: "error" });
      insert.run(source.id, state.checkedAt, null, null, null, null, state.error ?? "unknown");
      continue;
    }

    if (state.redirectTo && state.redirectTo !== prior?.redirect_to) {
      events.push({
        ...base,
        timestamp: state.checkedAt,
        note: `Slug now redirects to ${state.redirectTo}. Update the registry.`,
        kind: "redirected",
      });
    }

    if (state.withdrawnNotice) {
      events.push({ ...base, timestamp: state.checkedAt, note: state.withdrawnNotice, kind: "withdrawn" });
    }

    if (!prior) {
      events.push({
        ...base,
        timestamp: state.publicUpdatedAt ?? state.checkedAt,
        note: "First seen; baseline recorded.",
        kind: "first-seen",
      });
    } else if ((prior.public_updated_at ?? null) !== (state.publicUpdatedAt ?? null)) {
      // Normalise before comparing: SQLite hands back null, the checker returns
      // undefined, and a dateless source would otherwise "move" on every poll.
      // Prefer the publisher's own note over a bare timestamp move.
      const newest = (state.changeHistory ?? [])
        .filter((c) => !prior.public_updated_at || c.timestamp > prior.public_updated_at)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      if (newest.length > 0) {
        for (const n of newest) {
          events.push({ ...base, timestamp: n.timestamp, note: n.note, kind: "published-note" });
        }
      } else {
        events.push({
          ...base,
          timestamp: state.publicUpdatedAt ?? state.checkedAt,
          note: `Updated ${prior.public_updated_at ?? "unknown"} to ${state.publicUpdatedAt ?? "unknown"} with no published note.`,
          kind: "date-moved",
        });
      }
    }

    insert.run(
      source.id,
      state.checkedAt,
      state.publicUpdatedAt ?? null,
      null,
      JSON.stringify(state.changeHistory ?? []),
      state.redirectTo ?? null,
      null,
    );
  }

  return events;
}

/**
 * The publisher-authored change notes already on record, newest first.
 *
 * Useful from the very first run: the corpus arrives with years of history
 * attached, so there is no need to wait for a second poll to see anything.
 */
export function recentPublishedChanges(db: DatabaseSync, sinceDays: number, limit = 40): ChangeEvent[] {
  const cutoff = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const rows = db.prepare(
    `SELECT s.source_id, s.change_history, s.checked_at
     FROM snapshots s
     JOIN (SELECT source_id, MAX(checked_at) AS latest FROM snapshots GROUP BY source_id) m
       ON m.source_id = s.source_id AND m.latest = s.checked_at
     WHERE s.change_history IS NOT NULL`,
  ).all() as unknown as { source_id: string; change_history: string }[];

  const meta = new Map(
    (db.prepare("SELECT id, title, body, spine, authority, live_url FROM sources").all() as unknown as {
      id: string; title: string; body: string; spine: string; authority: string; live_url: string | null;
    }[]).map((r) => [r.id, r]),
  );

  const events: ChangeEvent[] = [];
  for (const row of rows) {
    const notes = JSON.parse(row.change_history) as ChangeNote[];
    const m = meta.get(row.source_id);
    for (const n of notes) {
      if (n.timestamp < cutoff) continue;
      events.push({
        sourceId: row.source_id,
        sourceTitle: m?.title ?? row.source_id,
        body: m?.body ?? "unknown",
        spine: m?.spine ?? "unknown",
        authority: m?.authority ?? "unknown",
        timestamp: n.timestamp,
        note: n.note,
        kind: "published-note",
        liveUrl: m?.live_url ?? undefined,
      });
    }
  }
  return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
}
