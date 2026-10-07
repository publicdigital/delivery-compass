import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { Source } from "./types.ts";

// fileURLToPath, not .pathname: the repo path may contain spaces.
const SOURCES_DIR = fileURLToPath(new URL("../sources/", import.meta.url));

/** snake_case in YAML maps to camelCase in code. */
function normalise(raw: Record<string, unknown>, definedIn: string): Source {
  return {
    id: String(raw.id),
    title: String(raw.title),
    body: String(raw.body),
    spine: raw.spine as Source["spine"],
    authority: raw.authority as Source["authority"],
    fetcher: raw.fetcher as Source["fetcher"],
    slug: raw.slug as string | undefined,
    endpoint: raw.endpoint as string | undefined,
    prefer: raw.prefer as Source["prefer"],
    expand: Boolean(raw.expand),
    expandAttachments: Boolean(raw.expand_attachments),
    parent: raw.parent as string | undefined,
    licence: String(raw.licence ?? "unknown"),
    redistribute: raw.redistribute as boolean | undefined,
    externalAttachment: raw.external_attachment as string | undefined,
    supersedesUrl: raw.supersedes_url as string | undefined,
    declaresConvention: Boolean(raw.declares_convention),
    withdrawnOn: raw.withdrawn_on ? String(raw.withdrawn_on) : undefined,
    withdrawnFrom: raw.withdrawn_from as string | undefined,
    withdrawnReason: raw.withdrawn_reason as string | undefined,
    replacement: raw.replacement as string | undefined,
    definedIn,
  };
}

export function loadRegistry(): Source[] {
  // sources/ holds two kinds of file. Everything not named here is expected to be a
  // list of sources, and a file that is not gets a real error rather than being
  // skipped - a malformed source file should never vanish quietly.
  const NOT_SOURCE_LISTS = new Set(["relations.yaml", "concepts.yaml"]);
  const files = readdirSync(SOURCES_DIR).filter((f) => f.endsWith(".yaml") && !NOT_SOURCE_LISTS.has(f));
  const sources: Source[] = [];
  const seenIds = new Map<string, string>();

  for (const file of files) {
    const entries = parse(readFileSync(join(SOURCES_DIR, file), "utf8")) as Record<string, unknown>[] | null;
    if (entries === null) continue;
    if (!Array.isArray(entries)) {
      throw new Error(`sources/${file} is not a list of sources. If it is a different kind of registry file, add it to NOT_SOURCE_LISTS in registry.ts.`);
    }
    for (const raw of entries) {
      const source = normalise(raw, file);
      const clash = seenIds.get(source.id);
      if (clash) throw new Error(`Duplicate source id "${source.id}" in ${file} and ${clash}`);
      seenIds.set(source.id, file);
      sources.push(source);
    }
  }
  return sources;
}
