/**
 * Obligation extraction.
 *
 * GovS 002 and the Orange Book both publish an RFC-2119-style convention in their
 * own front matter:
 *
 *   shall  - denotes a requirement: a mandatory element
 *   should - denotes a recommendation: an advisory element
 *   may    - denotes approval
 *   might  - denotes a possibility
 *   can    - denotes both capability and possibility
 *   is/are - denotes a description
 *
 * So this is a high-precision extraction against a documented convention, not a
 * guess. That distinction is what lets the tool state plainly whether something
 * binds the reader, which is the main guard against giving wrong compliance advice.
 *
 * Precision matters far more than recall here: a missed obligation is a gap, but a
 * false "mandatory" is actively misleading.
 */

export type Strength = "mandatory" | "recommended" | "permitted" | "possible";

export interface Obligation {
  strength: Strength;
  modal: string;
  sentence: string;
  actor: string | null;
  /**
   * Whether the modal carries defined force in THIS document.
   *
   * Only part of the corpus declares the RFC-2119-style convention: the Orange Book
   * and the GovS 002 family set out "shall denotes a requirement" in their front
   * matter. Across the wider corpus - the Service Manual, the Green Book, the AI
   * Playbook - "must" is simply the ordinary way of writing a requirement, and no
   * competing "shall" convention exists.
   *
   * So the flag is context-sensitive. In a convention-declaring document, "must" is
   * informal phrasing ("our risk culture must embrace openness" is aspiration, not a
   * requirement) and gets flagged. Everywhere else "must" is the normal mandatory
   * marker and is not flagged, because warning about it would be noise.
   */
  conventional: boolean;
}

const MODALS: { re: RegExp; modal: string; strength: Strength; conventional: boolean }[] = [
  { re: /\bshall\b/i, modal: "shall", strength: "mandatory", conventional: true },
  { re: /\bmust\b/i, modal: "must", strength: "mandatory", conventional: false },
  { re: /\b(?:is|are) required to\b/i, modal: "is required to", strength: "mandatory", conventional: false },
  { re: /\bshould\b/i, modal: "should", strength: "recommended", conventional: true },
  { re: /\bmay\b/i, modal: "may", strength: "permitted", conventional: true },
  { re: /\bmight\b/i, modal: "might", strength: "possible", conventional: true },
];

const ABBREVIATIONS = /\b(e\.g|i\.e|etc|cf|vs|No|Fig|para|paras|Ch|Sec|Dr|Mr|Ms|Mrs|St)\./gi;

/** Placeholder standing in for a full stop while sentences are split. */
const DOT = "\u0001";

/**
 * Sentence splitter that avoids breaking on the abbreviations and numbered clause
 * references that are dense in this corpus ("clause 4.4.4", "e.g.", "No. 10").
 * Both are masked before splitting and restored afterwards.
 */
function sentences(text: string): string[] {
  const masked = text
    .replace(ABBREVIATIONS, (m) => m.replace(".", DOT))
    .replace(/(\d)\.(\d)/g, "$1" + DOT + "$2");

  return masked
    .split(/(?<=[.!?])\s+(?=[A-Z"'(\[])|\n+/)
    .map((s) => s.split(DOT).join(".").trim())
    .filter((s) => s.length > 20 && s.length < 1200);
}

/**
 * Best-effort subject: the noun phrase immediately before the modal. Deliberately
 * conservative - returns null rather than guessing at a long or clause-initial run.
 */
function extractActor(sentence: string, modalIndex: number): string | null {
  const before = sentence.slice(0, modalIndex).trim();
  if (!before) return null;
  const clause = before.split(/[,;:]|\b(?:and|but|which|that|where|when|if)\b/i).pop()?.trim();
  if (!clause) return null;
  const words = clause.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 8) return null;
  const actor = words.join(" ").replace(/^(the|a|an|each|all|any|every)\s+/i, "");
  return actor.length >= 3 && actor.length <= 90 ? actor : null;
}

/** Prose that quotes or defines the convention rather than imposing an obligation. */
function isConventionBoilerplate(s: string): boolean {
  return (
    /\bdenotes\b[\s\S]*\b(requirement|recommendation|approval|possibility|capability|description)\b/i.test(s) ||
    /\bmandatory element\b|\badvisory element\b/i.test(s)
  );
}

export function extractObligations(text: string, sourceDeclaresConvention = false): Obligation[] {
  const found: Obligation[] = [];
  for (const sentence of sentences(text)) {
    if (isConventionBoilerplate(sentence)) continue;
    // First match wins: MODALS is ordered strongest first, so a sentence containing
    // both "shall" and "may" is recorded at its binding strength.
    for (const { re, modal, strength, conventional } of MODALS) {
      const m = re.exec(sentence);
      if (!m) continue;
      found.push({
        strength,
        modal,
        sentence: sentence.replace(/\s+/g, " ").trim(),
        actor: extractActor(sentence, m.index),
        // Outside convention-declaring documents, "must" is ordinary mandatory
        // language rather than a departure from a declared scheme.
        conventional: sourceDeclaresConvention ? conventional : true,
      });
      break;
    }
  }
  return found;
}
