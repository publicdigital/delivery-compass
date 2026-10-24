import { readOffsiteState } from "../offsite-state.ts";
import type { Attachment, ChangeNote, Source, SourceState } from "../types.ts";

const API = "https://www.gov.uk/api/content";
const UA = "delivery-compass/0.1 (prototype; corpus currency checker)";

/** Simple polite serial rate limit. GOV.UK is a public good; don't hammer it. */
let lastCall = 0;
async function polite(ms = 150): Promise<void> {
  const wait = lastCall + ms - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export interface ContentItem {
  document_type?: string;
  schema_name?: string;
  title?: string;
  public_updated_at?: string;
  first_published_at?: string;
  withdrawn_notice?: { explanation?: string; withdrawn_at?: string };
  details?: {
    change_history?: { public_timestamp: string; note: string }[];
    attachments?: { title?: string; url?: string; content_type?: string; attachment_type?: string }[];
    body?: string;
    redirects?: { destination?: string }[];
    /** Manuals list their section pages here. */
    child_section_groups?: { title?: string; child_sections?: { base_path?: string; title?: string }[] }[];
    /** Manuals publish change notes here, per section, rather than in change_history. */
    change_notes?: { published_at?: string; change_note?: string; title?: string }[];
  };
  links?: Record<string, { base_path?: string; title?: string }[]> & {
    children?: { base_path?: string; title?: string }[];
    parts?: { base_path?: string; title?: string }[];
    documents?: { base_path?: string; title?: string }[];
    /** Service manual topics list their guides here rather than under children. */
    linked_items?: { base_path?: string; title?: string }[];
  };
  redirects?: { destination?: string }[];
}

export async function getContent(slug: string): Promise<ContentItem | { httpError: number }> {
  await polite();
  const res = await fetch(`${API}${slug}`, { headers: { accept: "application/json", "user-agent": UA } });
  if (!res.ok) return { httpError: res.status };
  return (await res.json()) as ContentItem;
}

function toChangeNotes(item: ContentItem): ChangeNote[] {
  const history = (item.details?.change_history ?? []).map((c) => ({ timestamp: c.public_timestamp, note: c.note }));
  const manual = (item.details?.change_notes ?? [])
    .filter((c) => c.published_at && c.change_note)
    .map((c) => ({ timestamp: c.published_at!, note: c.title ? `${c.title}: ${c.change_note}` : c.change_note! }));
  return [...history, ...manual];
}

function toAttachments(item: ContentItem): Attachment[] {
  return (item.details?.attachments ?? [])
    .filter((a) => a.url)
    .map((a) => ({
      title: a.title ?? "(untitled)",
      url: a.url!,
      contentType: a.content_type,
      attachmentType: a.attachment_type,
    }));
}

/**
 * Resolve a source's current state without downloading its content.
 * Follows one level of redirect, reporting the move rather than hiding it —
 * a moved slug is itself a change worth surfacing.
 */
export async function checkSource(source: Source, parentSlug?: string): Promise<SourceState> {
  const checkedAt = new Date().toISOString();
  const base: SourceState = { sourceId: source.id, ok: false, checkedAt };

  if (source.fetcher === "withdrawn") {
    return { ...base, ok: true, documentType: "withdrawn", withdrawnNotice: source.withdrawnReason };
  }
  // An attachment source has no slug of its own; its state comes from its parent publication.
  if (source.fetcher === "govuk_attachment") {
    if (!parentSlug) return { ...base, ok: false, error: "govuk_attachment source has no resolvable parent" };
    const parent = await getContent(parentSlug);
    if ("httpError" in parent) return { ...base, error: `HTTP ${parent.httpError} on parent` };
    return {
      ...base,
      ok: true,
      documentType: "attachment_of_" + (parent.document_type ?? "unknown"),
      title: parent.title,
      publicUpdatedAt: parent.public_updated_at,
      changeHistory: toChangeNotes(parent),
      attachments: toAttachments(parent),
    };
  }
  // Off GOV.UK, so nothing to ask an API. Ingest has already read the text and
  // recorded whether it changed; report that, with our own notes standing in for
  // the publisher's change history.
  if (source.fetcher === "projectdelivery_pdf") {
    const state = readOffsiteState(source.id);
    if (!state) return { ...base, error: "no recorded text yet; run ingest first" };
    return {
      ...base,
      ok: true,
      documentType: "projectdelivery_pdf",
      title: source.title,
      publicUpdatedAt: state.changedAt,
      firstPublishedAt: state.firstRecordedAt,
      changeHistory: state.notes,
    };
  }
  if (source.fetcher === "local_only" || !source.slug) {
    return { ...base, ok: true, documentType: "local_only" };
  }

  const item = await getContent(source.slug);
  if ("httpError" in item) return { ...base, error: `HTTP ${item.httpError}` };

  const isRedirect = item.document_type === "redirect" || item.schema_name === "redirect";
  if (isRedirect) {
    const target = item.details?.redirects?.[0]?.destination ?? item.redirects?.[0]?.destination;
    if (!target) return { ...base, error: "redirect with no destination" };
    const followed = await getContent(target);
    if ("httpError" in followed) return { ...base, redirectTo: target, error: `HTTP ${followed.httpError} after redirect` };
    return {
      ...base,
      ok: true,
      redirectTo: target,
      documentType: followed.document_type,
      title: followed.title,
      publicUpdatedAt: followed.public_updated_at,
      firstPublishedAt: followed.first_published_at,
      changeHistory: toChangeNotes(followed),
      attachments: toAttachments(followed),
      withdrawnNotice: followed.withdrawn_notice?.explanation,
    };
  }

  return {
    ...base,
    ok: true,
    documentType: item.document_type,
    title: item.title,
    publicUpdatedAt: item.public_updated_at,
    firstPublishedAt: item.first_published_at,
    changeHistory: toChangeNotes(item),
    attachments: toAttachments(item),
    withdrawnNotice: item.withdrawn_notice?.explanation,
  };
}

/** Expand a collection into its member document paths via links.documents. */
export async function expandCollection(slug: string): Promise<{ path: string; title: string }[]> {
  const item = await getContent(slug);
  if ("httpError" in item) return [];
  const docs = item.links?.documents ?? [];
  return docs
    .filter((d) => d.base_path)
    .map((d) => ({ path: d.base_path!, title: d.title ?? "(untitled)" }));
}
