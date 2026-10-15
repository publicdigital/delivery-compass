import type { DatabaseSync } from "node:sqlite";

export interface Hit {
  sectionId: number;
  sourceId: string;
  sourceTitle: string;
  body: string;
  spine: string;
  authority: string;
  licence: string;
  heading: string;
  headingPath: string;
  anchor: string | null;
  docPath: string;
  text: string;
  publicUpdatedAt: string | null;
  indexedAt: string | null;
  score: number;
}

export interface ObligationHit {
  strength: string;
  modal: string;
  sentence: string;
  actor: string | null;
  conventional: boolean;
  sourceId: string;
  sourceTitle: string;
  body: string;
  headingPath: string;
  anchor: string | null;
  docPath: string;
  /** Full text of the section the obligation was extracted from, for narrative context around the isolated sentence. */
  sectionText: string;
  /** Date of the page the obligation was extracted from, not when the obligation was authored. */
  publicUpdatedAt: string | null;
}

/**
 * FTS5 treats a lot of punctuation as syntax. Rather than let a user's question
 * become a malformed MATCH expression, reduce it to bare terms and OR them,
 * boosting documents that contain more of them via bm25 ranking.
 */
export function toFtsQuery(question: string): string {
  const STOP = new Set([
    "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "is", "are", "do", "does",
    "what", "which", "who", "when", "how", "i", "we", "my", "our", "it", "this", "that",
    "be", "been", "with", "at", "by", "from", "as", "if", "can", "need", "needs", "about",
  ]);
  const terms = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .slice(0, 12);
  if (terms.length === 0) return "";
  return terms.map((t) => `"${t}"`).join(" OR ");
}

/** Bare content terms from a question, reused for both matching and title boosting. */
function queryTerms(question: string): string[] {
  const STOP = new Set([
    "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "is", "are", "do", "does",
    "what", "which", "who", "when", "how", "i", "we", "my", "our", "it", "this", "that",
    "be", "been", "with", "at", "by", "from", "as", "if", "can", "need", "needs", "about",
    "require", "requires", "required",
  ]);
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .slice(0, 12);
}

/**
 * Fraction of query terms that appear in a source's title.
 *
 * A question that names a document ("what does the technology code of practice
 * require") should return that document, but bm25 over section text alone ranks
 * whichever source mentions the phrase most often - usually a different one that
 * cross-references it. Boosting on title overlap fixes that without disturbing
 * topic-shaped queries, where no title matches strongly.
 */
function titleAffinity(title: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const t = title.toLowerCase();
  return terms.filter((term) => t.includes(term)).length / terms.length;
}

/** Full-text search over ingested sections, excluding landing-page-only sources. */
export function searchSections(db: DatabaseSync, question: string, limit = 8): Hit[] {
  const match = toFtsQuery(question);
  if (!match) return [];

  const rows = db
    .prepare(
      `SELECT
         sec.id            AS sectionId,
         sec.source_id     AS sourceId,
         src.title         AS sourceTitle,
         src.body          AS body,
         src.spine         AS spine,
         src.authority     AS authority,
         src.licence       AS licence,
         sec.heading       AS heading,
         sec.heading_path  AS headingPath,
         sec.anchor        AS anchor,
         sec.doc_path      AS docPath,
         sec.text          AS text,
         COALESCE(sec.doc_updated_at, src.public_updated_at) AS publicUpdatedAt,
         src.indexed_at    AS indexedAt,
         bm25(sections_fts, 3.0, 1.0) AS score
       FROM sections_fts
       JOIN sections sec ON sec.id = sections_fts.rowid
       JOIN sources  src ON src.id = sec.source_id
       WHERE sections_fts MATCH ?
         AND src.content_status = 'full'
       ORDER BY score
       LIMIT ?`,
    )
    .all(match, Math.max(limit * 8, 60)) as unknown as Hit[];

  // bm25 is negative-better in SQLite; normalise to positive-better before blending.
  const terms = queryTerms(question);
  const ranked = rows
    .map((r) => ({ hit: r, rank: -r.score + titleAffinity(r.sourceTitle, terms) * 8 }))
    .sort((a, b) => b.rank - a.rank)
    .map((x) => x.hit);

  // Registry entries legitimately overlap - the Service Manual and the spend-controls
  // entry both cover the same page - so the same passage can arrive twice under
  // different source ids. Keep the best-scoring copy of each page section.
  const seen = new Set<string>();
  const deduped: Hit[] = [];
  for (const r of ranked) {
    const key = `${r.docPath}#${r.anchor ?? r.heading}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

/**
 * Obligations relevant to a question, strongest first.
 *
 * Retrieval is scoped to the sections the query already matched, so an obligation
 * is only returned in the context that surfaced it.
 */
export function obligationsForSections(db: DatabaseSync, sectionIds: number[]): ObligationHit[] {
  if (sectionIds.length === 0) return [];
  const placeholders = sectionIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT
         o.strength, o.modal, o.sentence, o.actor, o.conventional,
         o.source_id AS sourceId, src.title AS sourceTitle, src.body AS body,
         sec.heading_path AS headingPath, sec.anchor AS anchor, sec.doc_path AS docPath,
         sec.text AS sectionText,
         COALESCE(sec.doc_updated_at, src.public_updated_at) AS publicUpdatedAt
       FROM obligations o
       JOIN sections sec ON sec.id = o.section_id
       JOIN sources  src ON src.id = o.source_id
       WHERE o.section_id IN (${placeholders})
       ORDER BY CASE o.strength
                  WHEN 'mandatory'   THEN 0
                  WHEN 'recommended' THEN 1
                  WHEN 'permitted'   THEN 2
                  ELSE 3 END,
                o.conventional DESC`,
    )
    .all(...sectionIds) as unknown as (Omit<ObligationHit, "conventional"> & { conventional: number })[];

  return rows.map((r) => ({ ...r, conventional: Boolean(r.conventional) }));
}

/** Deep link to the exact heading on GOV.UK. */
export function citationUrl(hit: { docPath: string; anchor: string | null }): string {
  const base = /^https?:/.test(hit.docPath) ? hit.docPath : `https://www.gov.uk${hit.docPath}`;
  return hit.anchor ? `${base}#${hit.anchor}` : base;
}
