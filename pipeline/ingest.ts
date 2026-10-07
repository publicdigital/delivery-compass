import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { extractObligations } from "./classify.ts";
import { getContent, type ContentItem } from "./fetchers/govuk.ts";
import { splitSections } from "./normalise.ts";
import type { Source } from "./types.ts";

export interface IngestResult {
  sourceId: string;
  docs: number;
  sections: number;
  obligations: number;
  skipped?: string;
  metadataOnly?: boolean;
  /** Set when the registry slug now redirects; the registry should be updated. */
  movedTo?: string;
}

/** A single ingestible document: one page of HTML with a canonical path. */
interface Doc {
  path: string;
  html: string;
  updatedAt: string | null;
}

/**
 * Whether a GOV.UK attachment's title is plausibly the one a registry entry names.
 * The parent publication may carry a dozen unrelated attachments; matching on
 * significant title words is the same heuristic currency.ts uses to pick the right
 * one for a "print-of-html" seed PDF.
 */
function attachmentTitleMatches(attachmentTitle: string, sourceTitle: string): boolean {
  const words = sourceTitle.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const t = attachmentTitle.toLowerCase();
  return words.length > 0 && words.every((w) => t.includes(w));
}

/**
 * Resolve a source to the pages that actually carry its text.
 *
 * HTML-first throughout. PDF extraction is deliberately not attempted here: the
 * seed folder proved that several of these PDFs are CID-encoded or are print-outs
 * of web pages, and GOV.UK now publishes an HTML edition of nearly everything.
 * Where only a PDF exists, the source is skipped and reported rather than
 * silently ingested as garbage.
 *
 * excludeAttachmentTitles omits attachments that belong to a registered
 * govuk_attachment child (see resolveAttachmentDoc) - otherwise the child's guidance
 * would be absorbed into this parent's own sections under the wrong source id.
 */
async function resolveDocs(
  source: Source,
  excludeAttachmentTitles: string[] = [],
): Promise<{ docs: Doc[]; skipped?: string; movedTo?: string }> {
  if (!source.slug) return { docs: [], skipped: "no slug" };

  let item = await getContent(source.slug);
  if ("httpError" in item) return { docs: [], skipped: `HTTP ${item.httpError}` };

  // GOV.UK moves pages and leaves a redirect behind. checkSource already followed
  // these; this did not, so a renamed slug came back as "no body content" while the
  // previous ingest's rows stayed in the database and the corpus looked healthy.
  // That is how the Green Book quietly emptied itself in October 2026.
  let movedTo: string | undefined;
  if (item.document_type === "redirect" || item.schema_name === "redirect") {
    const target = item.details?.redirects?.[0]?.destination ?? item.redirects?.[0]?.destination;
    if (!target) return { docs: [], skipped: "redirect with no destination" };
    const followed = await getContent(target);
    if ("httpError" in followed) return { docs: [], skipped: `HTTP ${followed.httpError} after redirect to ${target}` };
    movedTo = target;
    item = followed;
  }

  const docs: Doc[] = [];

  // Guides and detailed guides carry their prose inline.
  const inline = item.details?.body;
  if (inline && inline.trim().length > 0) {
    docs.push({ path: movedTo ?? source.slug, html: inline, updatedAt: item.public_updated_at ?? null });
  }

  // Publications hold their prose in HTML attachments, one page each.
  const htmlAttachments = (item.details?.attachments ?? []).filter(
    (a) => a.attachment_type === "html" && a.url?.startsWith("/"),
  );
  for (const a of htmlAttachments) {
    if (excludeAttachmentTitles.some((t) => attachmentTitleMatches(a.title ?? "", t))) continue;
    const sub = await getContent(a.url!);
    if ("httpError" in sub) continue;
    const body = sub.details?.body;
    if (body && body.trim().length > 0) {
      docs.push({ path: a.url!, html: body, updatedAt: sub.public_updated_at ?? item.public_updated_at ?? null });
    }
  }

  if (docs.length === 0) {
    const hasPdf = (item.details?.attachments ?? []).some((a) => a.content_type === "application/pdf");
    const hasExternal = (item.details?.attachments ?? []).some((a) => a.attachment_type === "external");
    return {
      docs: [],
      movedTo,
      skipped: hasExternal ? "content hosted off GOV.UK" : hasPdf ? "PDF only, no HTML edition" : "no body content",
    };
  }
  return { docs, movedTo };
}

/**
 * A govuk_attachment source has no slug of its own - its text is one HTML
 * attachment hanging off a parent publication (e.g. the AI evaluation guide is an
 * attachment of the Magenta Book). Resolve it by title match against the parent's
 * attachments, same heuristic as resolveDocs' exclusion above.
 */
async function resolveAttachmentDoc(source: Source, parent: Source): Promise<{ docs: Doc[]; skipped?: string }> {
  if (!parent.slug) return { docs: [], skipped: `parent "${parent.id}" has no slug` };

  const item = await getContent(parent.slug);
  if ("httpError" in item) return { docs: [], skipped: `HTTP ${item.httpError} on parent` };

  const htmlAttachments = (item.details?.attachments ?? []).filter(
    (a) => a.attachment_type === "html" && a.url?.startsWith("/"),
  );
  const match = htmlAttachments.find((a) => attachmentTitleMatches(a.title ?? "", source.title));
  if (!match) return { docs: [], skipped: "no matching attachment on parent" };

  const sub = await getContent(match.url!);
  if ("httpError" in sub) return { docs: [], skipped: `HTTP ${sub.httpError}` };
  const body = sub.details?.body;
  if (!body || body.trim().length === 0) return { docs: [], skipped: "no body content" };

  return { docs: [{ path: match.url!, html: body, updatedAt: sub.public_updated_at ?? item.public_updated_at ?? null }] };
}

/**
 * Child pages of a service manual index. The manual nests two levels deep: the
 * homepage lists topics, and each topic lists the guides that hold the prose.
 * The Service Standard is flatter - its 14 points are direct children.
 */
async function serviceManualChildren(item: ContentItem, depth = 2): Promise<string[]> {
  const direct = [
    ...(item.links?.children ?? []),
    ...(item.links?.parts ?? []),
    ...(item.links?.linked_items ?? []),
  ]
    .map((c) => c.base_path)
    .filter((p): p is string => Boolean(p));
  if (depth <= 1) return direct;

  const all: string[] = [];
  for (const path of direct) {
    all.push(path);
    const child = await getContent(path);
    if ("httpError" in child) continue;
    // Only descend where the topic page itself carries no prose.
    if (!child.details?.body?.trim()) all.push(...(await serviceManualChildren(child, depth - 1)));
  }
  return [...new Set(all)];
}

/**
 * A landing page whose only text is its own summary. GOV.UK returns these for
 * publications whose substance sits in a PDF or on another host.
 */
function isMetadataOnly(sections: number, totalChars: number, anchored: number): boolean {
  return sections <= 2 && anchored === 0 && totalChars < 1500;
}

/**
 * Pages that a registry entry claims as its own.
 *
 * Broad sources overlap narrow ones: the Service Manual crawl reaches the
 * spend-controls guide, which is also registered in its own right. Ingesting the
 * same page under two source ids makes attribution non-deterministic, and
 * attribution is what the relations layer keys on - so a supersession warning
 * would fire or not depending on which copy happened to rank higher. A page
 * explicitly registered as its own source is therefore never also ingested as
 * part of a parent.
 */
export function explicitlyClaimedPaths(registry: Source[]): Set<string> {
  return new Set(
    registry
      .filter((s) => s.slug && !s.expand && s.fetcher !== "govuk_collection")
      .map((s) => s.slug!),
  );
}

export async function ingestSource(
  db: DatabaseSync,
  source: Source,
  claimedElsewhere: Set<string> = new Set(),
  byId: Map<string, Source> = new Map(),
): Promise<IngestResult> {
  const result: IngestResult = { sourceId: source.id, docs: 0, sections: 0, obligations: 0 };

  if (source.fetcher === "withdrawn" || source.fetcher === "local_only" || source.fetcher === "nao_wp" || source.fetcher === "off_platform") {
    const message =
      source.fetcher === "nao_wp" ? "not OGL, link only"
      : source.fetcher === "off_platform" ? `off-platform, not fetchable${source.externalAttachment ? ` (${source.externalAttachment})` : ""}`
      : source.fetcher;
    return { ...result, skipped: message };
  }

  let docs: Doc[];
  let skipped: string | undefined;
  let movedTo: string | undefined;

  if (source.fetcher === "govuk_attachment") {
    if (!source.parent) return { ...result, skipped: "no parent" };
    const parent = byId.get(source.parent);
    if (!parent) return { ...result, skipped: `unknown parent "${source.parent}"` };
    ({ docs, skipped } = await resolveAttachmentDoc(source, parent));
  } else {
    // Exclude attachments claimed by a registered govuk_attachment child, so their
    // guidance doesn't get absorbed into this parent's own sections instead.
    const attachmentChildren = [...byId.values()]
      .filter((s) => s.fetcher === "govuk_attachment" && s.parent === source.id)
      .map((s) => s.title);
    ({ docs, skipped, movedTo } = await resolveDocs(source, attachmentChildren));
  }

  // Service manual index pages have no prose of their own; their children do.
  if (docs.length === 0 && source.fetcher === "service_manual" && source.expand && source.slug) {
    const item = await getContent(source.slug);
    if (!("httpError" in item)) {
      for (const path of await serviceManualChildren(item)) {
        if (claimedElsewhere.has(path)) continue;
        const child = await getContent(path);
        if ("httpError" in child) continue;
        const body = child.details?.body;
        if (body?.trim()) docs.push({ path, html: body, updatedAt: child.public_updated_at ?? null });
      }
      if (docs.length > 0) skipped = undefined;
    }
  }

  if (docs.length === 0) return { ...result, skipped: skipped ?? "no content", movedTo };

  const liveUrl = source.slug ? `https://www.gov.uk${source.slug}` : `https://www.gov.uk${docs[0]!.path}`;
  let publicUpdatedAt: string | null;
  if (source.slug) {
    const state = await getContent(source.slug);
    publicUpdatedAt = "httpError" in state ? null : (state.public_updated_at ?? null);
  } else {
    // No page of its own (a bare attachment) - the doc's own date is all there is.
    publicUpdatedAt = docs[0]!.updatedAt;
  }

  db.prepare(
    `INSERT INTO sources (id, title, body, spine, authority, slug, licence, live_url, public_updated_at, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, public_updated_at=excluded.public_updated_at, indexed_at=excluded.indexed_at`,
  ).run(
    source.id, source.title, source.body, source.spine, source.authority,
    source.slug ?? null, source.licence, liveUrl, publicUpdatedAt, new Date().toISOString(),
  );

  // Re-ingesting a source replaces its sections wholesale.
  db.prepare("DELETE FROM obligations WHERE source_id = ?").run(source.id);
  db.prepare("DELETE FROM sections WHERE source_id = ?").run(source.id);

  const insertSection = db.prepare(
    `INSERT INTO sections (source_id, doc_path, anchor, heading, heading_path, level, ordinal, text, doc_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertObligation = db.prepare(
    `INSERT INTO obligations (section_id, source_id, strength, modal, sentence, actor, conventional)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  let totalChars = 0;
  let anchored = 0;

  // Curated in the registry rather than detected: the convention table appears only
  // in the PDF front matter, and the HTML editions we ingest drop it. In practice
  // the Orange Book is the only ingested source that uses "shall" at all - every
  // other source in the corpus expresses requirements with "must".
  const declares = source.declaresConvention;
  if (declares) db.prepare("UPDATE sources SET declares_convention = 1 WHERE id = ?").run(source.id);

  for (const doc of docs) {
    for (const section of splitSections(doc.html)) {
      totalChars += section.text.length;
      if (section.anchor) anchored++;
      const info = insertSection.run(
        source.id, doc.path, section.anchor, section.heading,
        section.headingPath, section.level, section.ordinal, section.text, doc.updatedAt,
      );
      const sectionId = Number(info.lastInsertRowid);
      result.sections++;

      for (const o of extractObligations(section.text, declares)) {
        insertObligation.run(sectionId, source.id, o.strength, o.modal, o.sentence, o.actor, o.conventional ? 1 : 0);
        result.obligations++;
      }
    }
    result.docs++;
  }

  if (isMetadataOnly(result.sections, totalChars, anchored)) {
    db.prepare("UPDATE sources SET content_status = 'metadata_only', note = ? WHERE id = ?")
      .run("GOV.UK exposes only a landing-page summary; the substance is a PDF or off-platform", source.id);
    result.metadataOnly = true;
  }

  result.movedTo = movedTo;
  return result;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
