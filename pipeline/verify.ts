import type { DatabaseSync } from "node:sqlite";
import { loadRegistry } from "./registry.ts";

// Floors, not targets. A deploy that ingests half the corpus because GOV.UK changed a
// response shape would otherwise come up looking fine and answer fewer questions -
// the silent-degradation failure mode flagged in HANDOVER.md §7.4. These numbers are
// set well below where the corpus stood when they were written (29 sources / ~2.4k
// sections), so ordinary drift does not trip them but a structural break does.
export const FLOORS = { sources: 24, sections: 1200, obligations: 800, mandatory: 100 } as const;

export type CorpusHealth = {
  ok: boolean;
  counts: { sources: number; sections: number; obligations: number; mandatory: number };
  floors: typeof FLOORS;
  failures: string[];
  registered: number;
  indexedAt: string | null;
  ftsWorking: boolean;
};

export function checkCorpus(db: DatabaseSync): CorpusHealth {
  const counts = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM sources WHERE content_status='full') AS sources,
       (SELECT COUNT(*) FROM sections) AS sections,
       (SELECT COUNT(*) FROM obligations) AS obligations,
       (SELECT COUNT(*) FROM obligations WHERE strength='mandatory') AS mandatory,
       (SELECT MAX(indexed_at) FROM sources) AS indexedAt`,
  ).get() as unknown as { sources: number; sections: number; obligations: number; mandatory: number; indexedAt: string | null };

  const failures: string[] = [];
  for (const [key, floor] of Object.entries(FLOORS)) {
    const got = counts[key as keyof typeof FLOORS];
    if (got < floor) failures.push(`${key}: ${got} < floor ${floor}`);
  }

  // The FTS index is populated separately from the tables it mirrors (external-content
  // table, rebuilt after bulk load). A corpus with every row present but an empty index
  // answers "no match" to everything while looking perfectly healthy by row count.
  let ftsWorking = false;
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM sections_fts").get() as unknown as { n: number };
    ftsWorking = row.n > 0;
  } catch (e) {
    failures.push(`fts unreadable: ${(e as Error).message}`);
  }
  if (!ftsWorking) failures.push("fts index is empty - run ingest, which rebuilds it");

  return {
    ok: failures.length === 0,
    counts: { sources: counts.sources, sections: counts.sections, obligations: counts.obligations, mandatory: counts.mandatory },
    floors: FLOORS,
    failures,
    registered: loadRegistry().length,
    indexedAt: counts.indexedAt,
  ftsWorking,
  };
}
