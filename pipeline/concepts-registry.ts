import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const CONCEPTS_PATH = fileURLToPath(new URL("../sources/concepts.yaml", import.meta.url));

export interface Concept {
  id: string;
  triggers: string[];
  terms: string[];
  sources?: string[];
  /** Substrings of a document URL. Finer-grained than `sources`. */
  docs?: string[];
  why?: string;
}

/**
 * Load the concept bridges, failing loudly on a source id that does not exist.
 *
 * A typo in `sources:` would silently stop a concept nudging the document it was
 * written to surface, which is exactly the kind of quiet non-event that is never
 * noticed. Same reasoning as the check in loadRelations.
 */
export function loadConcepts(knownSourceIds: string[]): Concept[] {
  const doc = parse(readFileSync(CONCEPTS_PATH, "utf8")) as { concepts?: Concept[] } | null;
  const concepts = doc?.concepts ?? [];
  const known = new Set(knownSourceIds);
  const seen = new Set<string>();

  for (const c of concepts) {
    if (seen.has(c.id)) throw new Error(`concepts.yaml: duplicate concept id "${c.id}"`);
    seen.add(c.id);
    if (!c.triggers?.length) throw new Error(`concepts.yaml: "${c.id}" has no triggers`);
    if (!c.terms?.length) throw new Error(`concepts.yaml: "${c.id}" has no terms`);
    for (const s of c.sources ?? []) {
      if (!known.has(s)) throw new Error(`concepts.yaml: "${c.id}" names unknown source "${s}"`);
    }
  }
  return concepts;
}
