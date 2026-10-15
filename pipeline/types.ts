/** Core domain types for the guidance corpus. */

export type Spine = "funding" | "assurance" | "risk" | "evaluation" | "digital" | "oversight";

/** How binding a source or section is. `withdrawn` means the publisher has removed it. */
export type Authority = "mandatory" | "advisory" | "informative" | "withdrawn";

export type FetcherName =
  | "govuk_content"
  | "govuk_publication"
  | "govuk_collection"
  | "govuk_attachment"
  | "service_manual"
  | "nao_wp"
  | "http_pdf"
  | "local_only"
  | "withdrawn"
  // A real canonical source exists, but not on GOV.UK, and it isn't fetchable
  // (e.g. blocks non-browser requests). Distinct from local_only, where no public
  // canonical exists at all - kept registered so the gap is visible, not silent.
  | "off_platform"
  // The Teal Book: off GOV.UK, HTML behind a bot challenge, but published as a
  // nightly PDF generated from the same pages. See pipeline/fetchers/projectdelivery.ts.
  | "projectdelivery_pdf"
  // A GOV.UK publication whose only edition is a PDF, read from whichever PDF the
  // landing page carries now. See pipeline/fetchers/govuk-pdf.ts.
  | "govuk_pdf";

export interface Source {
  id: string;
  title: string;
  body: string;
  spine: Spine;
  authority: Authority;
  fetcher: FetcherName;
  slug?: string;
  endpoint?: string;
  prefer?: "html" | "pdf";
  expand?: boolean;
  expandAttachments?: boolean;
  parent?: string;
  licence: string;
  redistribute?: boolean;
  externalAttachment?: string;
  /** For projectdelivery_pdf: the PDF that is read. `endpoint` is the web page cited. */
  pdf?: string;
  /** For govuk_pdf, when the publication carries several PDFs: words in the wanted one's title. */
  pdfTitle?: string;
  /**
   * Why a source is not indexed, in a sentence a reader understands. Overrides the
   * generic reason derived from the fetcher, which is right for most sources but
   * says nothing specific about, say, a site that blocks automated access.
   */
  notIndexedReason?: string;
  supersedesUrl?: string;
  /** Document sets out the "shall denotes a requirement" convention in its front matter. */
  declaresConvention: boolean;
  withdrawnOn?: string;
  withdrawnFrom?: string;
  withdrawnReason?: string;
  replacement?: string;
  /** File the entry was loaded from, for error messages. */
  definedIn: string;
}

/** A change note published by the source's owner. */
export interface ChangeNote {
  timestamp: string;
  note: string;
}

/** What a fetcher learns about a source without downloading its content. */
export interface SourceState {
  sourceId: string;
  ok: boolean;
  /** Present when the API resolved the source. */
  documentType?: string;
  title?: string;
  publicUpdatedAt?: string;
  firstPublishedAt?: string;
  changeHistory?: ChangeNote[];
  attachments?: Attachment[];
  /** Set when GOV.UK reports the slug now redirects elsewhere. */
  redirectTo?: string;
  /** Set when the publication carries a withdrawal notice. */
  withdrawnNotice?: string;
  error?: string;
  checkedAt: string;
}

export interface Attachment {
  title: string;
  url: string;
  contentType?: string;
  /** GOV.UK distinguishes "file", "html" and "external" attachments. */
  attachmentType?: "file" | "html" | "external" | string;
}
