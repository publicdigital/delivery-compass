/**
 * GOV.UK publications whose only edition is a PDF.
 *
 * Several mandatory sources are exactly that: the 2026 business case guidance, and
 * NISTA's assurance guides. They were "not indexed" because ingestion is HTML-first
 * (HANDOVER.md §4), and that rule exists because some old PDFs extract as garbage.
 * These were each checked by hand before being registered (docs/wp0-discovery.md):
 * Word and InDesign exports that extract as clean text.
 *
 * The registry keeps the publication's GOV.UK slug, not the PDF's URL. Every run
 * reads the landing page and takes whichever PDF is attached now, so a new version
 * replaces the old one without anyone editing the registry, and an old version is
 * never indexed. Change detection is GOV.UK's own (public_updated_at and change
 * notes on the landing page), exactly as for HTML sources.
 *
 * Citations link to the PDF itself, at the page the section starts on (#page=N,
 * which browsers' PDF viewers honour).
 */
import type { Section } from "../normalise.ts";
import { buildSections, downloadPdf, openPdf, outlineBoundaries, runningLines, typeSizeBoundaries, type Boundary } from "./pdf.ts";

/** Bookmarks that are not sections: Word and InDesign bookmark every table and figure. */
const NOT_A_SECTION = /^(table|figure|box|chart|diagram|annex table)\s*\d+|^(cover|contents|table of contents)$/i;

export interface GovukPdf {
  sections: Section[];
  /** "outline" or "type size": how section starts were found, for the ingest log. */
  method: string;
}

export const downloadGovukPdf = (url: string) => downloadPdf(url, "weekly corpus refresh");

/**
 * Also used for committed snapshots (`snapshot_pdf`), which cite a web page rather
 * than the PDF and so pass their own anchor.
 */
export async function parseGovukPdf(
  data: Uint8Array,
  anchor: (b: Boundary, text: string) => string | null = (b) => `page=${b.page + 1}`,
): Promise<GovukPdf> {
  const pdf = await openPdf(data);
  const lines = await pdf.lines();
  const running = runningLines(lines, pdf.numPages);

  let boundaries = await outlineBoundaries(pdf, pdf.outline, 0, (t) => !NOT_A_SECTION.test(t));
  let method = "outline";
  if (boundaries.length === 0) {
    boundaries = typeSizeBoundaries(lines, running);
    method = "type size";
  }

  const sections = [...buildSections(lines, boundaries, running, anchor).values()];
  await pdf.destroy();
  return { sections, method };
}
