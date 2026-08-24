import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { loadRegistry } from "./registry.ts";
import type { Source } from "./types.ts";

const RELATIONS_PATH = fileURLToPath(new URL("../sources/relations.yaml", import.meta.url));

export type RelationType =
  | "requires" | "feeds" | "assured_by" | "gates" | "supersedes" | "conflicts" | "elaborates";

export interface Relation {
  from: string;
  to: string;
  type: RelationType;
  scope?: string;
  effective?: string;
  severity?: "high" | "medium" | "low";
  evidence?: string;
  guidance?: string;
}

export function loadRelations(): Relation[] {
  const doc = parse(readFileSync(RELATIONS_PATH, "utf8")) as { relations?: Relation[] } | null;
  const relations = doc?.relations ?? [];
  const ids = new Set(loadRegistry().map((s) => s.id));
  for (const r of relations) {
    // A typo in a relation would silently drop an edge, so fail loudly instead.
    if (!ids.has(r.from)) throw new Error(`relations.yaml: unknown source "${r.from}"`);
    if (!ids.has(r.to)) throw new Error(`relations.yaml: unknown source "${r.to}"`);
  }
  return relations;
}

/**
 * Warnings that apply to a set of sources appearing in an answer.
 *
 * If an answer cites a source that another source supersedes or conflicts with,
 * the reader needs to know before acting. This is the whole point of modelling
 * relationships: no single GOV.UK page tells you it has been overtaken elsewhere.
 */
export interface Caveat {
  supersededSourceId: string;
  bySourceId: string;
  type: RelationType;
  scope?: string;
  effective?: string;
  severity: string;
  guidance?: string;
  evidence?: string;
}

export function caveatsFor(sourceIds: string[], relations: Relation[]): Caveat[] {
  const cited = new Set(sourceIds);
  return relations
    .filter((r) => (r.type === "supersedes" || r.type === "conflicts") && cited.has(r.to))
    .map((r) => ({
      supersededSourceId: r.to,
      bySourceId: r.from,
      type: r.type,
      scope: r.scope,
      effective: r.effective,
      severity: r.severity ?? "medium",
      guidance: r.guidance,
      evidence: r.evidence,
    }));
}

export interface GraphNode {
  id: string;
  title: string;
  body: string;
  spine: string;
  authority: string;
  degree: number;
}

export function buildGraph(): { nodes: GraphNode[]; edges: Relation[]; sources: Source[] } {
  const sources = loadRegistry();
  const edges = loadRelations();
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const nodes: GraphNode[] = sources.map((s) => ({
    id: s.id,
    title: s.title,
    body: s.body,
    spine: s.spine,
    authority: s.authority,
    degree: degree.get(s.id) ?? 0,
  }));
  return { nodes, edges, sources };
}
