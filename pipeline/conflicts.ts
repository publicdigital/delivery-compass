import type { DatabaseSync } from "node:sqlite";
import { loadRegistry } from "./registry.ts";
import { loadRelations } from "./graph.ts";
import { citationUrl } from "./search.ts";

/**
 * Conflict discovery sweep (HANDOVER.md §6, item 2).
 *
 * The tool's two known cross-source conflicts were both found by hand. This proposes
 * further candidates for human review instead of relying on serendipity: pair
 * obligations that name the same actor and a similar topic, but come from different
 * sources and different-aged pages. That combination - same actor, same subject,
 * pages years apart - is the shape a real conflict takes before anyone has confirmed
 * it. No LLM is used; this is regex and set overlap, same as the rest of extraction.
 *
 * This only proposes. A human still decides what goes into relations.yaml.
 */

interface ObligationRow {
  sourceId: string;
  strength: string;
  actor: string;
  sentence: string;
  anchor: string | null;
  docPath: string;
  updatedAt: string | null;
}

export interface ConflictEvidence {
  actor: string;
  sharedWords: string[];
  ageGapDays: number;
  a: { sourceId: string; sourceTitle: string; strength: string; sentence: string; updatedAt: string | null; url: string };
  b: { sourceId: string; sourceTitle: string; strength: string; sentence: string; updatedAt: string | null; url: string };
}

export interface ConflictCandidate {
  sourceA: string;
  sourceB: string;
  sourceATitle: string;
  sourceBTitle: string;
  score: number;
  overlapCount: number;
  mandatoryInvolved: number;
  evidence: ConflictEvidence[];
}

// Pronouns and parser artifacts that name no one in particular. Bucketing obligations
// by these would just group "must" sentences by writing style, not by who they bind -
// "you" alone accounts for over a fifth of every obligation in the corpus.
const GENERIC_ACTORS = new Set([
  "you", "your", "yours", "this", "that", "these", "those", "it", "its",
  "they", "their", "theirs", "there", "we", "our", "i", "my", "data",
]);

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "is", "are", "do", "does",
  "what", "which", "who", "when", "how", "with", "at", "by", "from", "as", "if", "not",
  "be", "been", "was", "were", "will", "would", "can", "could", "may", "might", "also",
  "must", "should", "shall", "need", "needs", "required", "requires", "require", "have", "has",
  "any", "all", "each", "other", "than", "then", "into", "before", "after", "when", "where",
  // Function words that survive length>=4 filtering but carry no topic - the false
  // positives this sweep is prone to are boilerplate phrasing ("your team should"),
  // not genuine subject overlap, and these are exactly the words that fake it.
  "this", "these", "those", "that", "your", "yours", "means", "being", "under", "using",
  "between", "during", "within", "without", "such", "some", "more", "most", "same", "here",
  "make", "made", "used", "part", "case", "help", "including", "include", "includes",
]);

/** Strips leading determiners so "your team" and "the team" bucket together. */
function normaliseActor(actor: string): string | null {
  const a = actor
    .toLowerCase()
    .trim()
    .replace(/^(the|a|an|your|its|this|that|these|those)\s+/, "")
    .replace(/[.,;:]+$/, "");
  return a.length > 0 ? a : null;
}

function contentWords(sentence: string): Set<string> {
  return new Set(
    sentence
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP_WORDS.has(w)),
  );
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

const MIN_SHARED_WORDS = 2;
const MIN_AGE_GAP_DAYS = 365;

/**
 * Every candidate obligation-pair in the corpus, unranked and unlimited - the raw
 * material both `findConflictCandidates` (ranked, source-pair view, for `compass
 * conflicts`) and the web UI's per-obligation inline flagging are built from.
 * Same thresholds either way: this is the one place they're allowed to drift.
 */
export function findAllConflictEvidence(db: DatabaseSync): ConflictEvidence[] {
  const registry = loadRegistry();
  const titleById = new Map(registry.map((s) => [s.id, s.title] as const));
  const alreadyCurated = new Set(loadRelations().map((r) => pairKey(r.from, r.to)));

  const rows = db
    .prepare(
      `SELECT
         o.source_id AS sourceId, o.strength, o.actor, o.sentence,
         sec.anchor AS anchor, sec.doc_path AS docPath,
         COALESCE(sec.doc_updated_at, src.public_updated_at) AS updatedAt
       FROM obligations o
       JOIN sections sec ON sec.id = o.section_id
       JOIN sources  src ON src.id = o.source_id
       WHERE o.actor IS NOT NULL
         AND o.strength IN ('mandatory', 'recommended')
         AND src.content_status = 'full'`,
    )
    .all() as unknown as ObligationRow[];

  const buckets = new Map<string, ObligationRow[]>();
  for (const r of rows) {
    if (!r.updatedAt) continue;
    const actor = normaliseActor(r.actor);
    if (!actor || GENERIC_ACTORS.has(actor)) continue;
    buckets.set(actor, [...(buckets.get(actor) ?? []), r]);
  }

  const evidence: ConflictEvidence[] = [];

  for (const [actor, obligations] of buckets) {
    const words = obligations.map((o) => contentWords(o.sentence));
    for (let i = 0; i < obligations.length; i++) {
      for (let j = i + 1; j < obligations.length; j++) {
        const a = obligations[i]!;
        const b = obligations[j]!;
        if (a.sourceId === b.sourceId) continue;
        if (alreadyCurated.has(pairKey(a.sourceId, b.sourceId))) continue;

        const shared = [...words[i]!].filter((w) => words[j]!.has(w));
        if (shared.length < MIN_SHARED_WORDS) continue;

        const ageGapDays = Math.abs(new Date(a.updatedAt!).getTime() - new Date(b.updatedAt!).getTime()) / 86_400_000;
        if (ageGapDays < MIN_AGE_GAP_DAYS) continue;

        evidence.push({
          actor,
          sharedWords: shared,
          ageGapDays,
          a: { sourceId: a.sourceId, sourceTitle: titleById.get(a.sourceId) ?? a.sourceId, strength: a.strength, sentence: a.sentence, updatedAt: a.updatedAt, url: citationUrl(a) },
          b: { sourceId: b.sourceId, sourceTitle: titleById.get(b.sourceId) ?? b.sourceId, strength: b.strength, sentence: b.sentence, updatedAt: b.updatedAt, url: citationUrl(b) },
        });
      }
    }
  }

  return evidence;
}

/**
 * Score and rank candidate source pairs by: age gap between the two obligations'
 * pages, how much of their subject they share, and whether either is mandatory.
 * Source pairs already linked in relations.yaml are excluded - a human has already
 * judged those, whichever way.
 */
export function findConflictCandidates(db: DatabaseSync, limit = 20): ConflictCandidate[] {
  const registry = loadRegistry();
  const titleById = new Map(registry.map((s) => [s.id, s.title] as const));

  const bySourcePair = new Map<string, { score: number; mandatoryInvolved: number; evidence: ConflictEvidence[] }>();

  for (const e of findAllConflictEvidence(db)) {
    const key = pairKey(e.a.sourceId, e.b.sourceId);
    const mandatoryCount = (e.a.strength === "mandatory" ? 1 : 0) + (e.b.strength === "mandatory" ? 1 : 0);
    const score = e.ageGapDays * e.sharedWords.length * (mandatoryCount || 0.5);

    const entry = bySourcePair.get(key) ?? { score: 0, mandatoryInvolved: 0, evidence: [] };
    entry.score += score;
    entry.mandatoryInvolved += mandatoryCount;
    entry.evidence.push(e);
    bySourcePair.set(key, entry);
  }

  const candidates: ConflictCandidate[] = [...bySourcePair.entries()].map(([key, v]) => {
    const [sourceA, sourceB] = key.split("|") as [string, string];
    v.evidence.sort((a, b) => b.ageGapDays * b.sharedWords.length - a.ageGapDays * a.sharedWords.length);
    return {
      sourceA,
      sourceB,
      sourceATitle: titleById.get(sourceA) ?? sourceA,
      sourceBTitle: titleById.get(sourceB) ?? sourceB,
      score: v.score,
      overlapCount: v.evidence.length,
      mandatoryInvolved: v.mandatoryInvolved,
      evidence: v.evidence.slice(0, 3),
    };
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}
