/**
 * The Teal Book, from the Government Project Delivery website.
 *
 * The one deliberate exception to HTML-first ingestion. The Teal Book is not on
 * GOV.UK at all: it lives on projectdelivery.gov.uk, whose HTML pages sit behind a
 * Cloudflare bot challenge that answers every non-browser request with a 403. We do
 * not try to get past that. The site also publishes the whole book as one PDF,
 * regenerated overnight from the same pages and served without the challenge, and
 * that is what this reads.
 *
 * The reasons for avoiding PDFs (HANDOVER.md §4) do not apply to this one. It is
 * produced by wkhtmltopdf from the live HTML, so it extracts as clean text, and it
 * carries a full heading outline (about 1,000 entries) that does the job GOV.UK's
 * heading ids do elsewhere: it says where each section starts.
 *
 * Citations still point at the web pages, not the 36MB PDF. Chapter URLs follow
 * the outline's titles (checked by hand against the live site on 2026-10-15), and
 * a text fragment (#:~:text=) jumps to the exact heading. The site's own anchors
 * are positional (section-1, section-2...) and would silently drift.
 */
import type { Section } from "../normalise.ts";
import { buildSections, downloadPdf, openPdf, outlineBoundaries, sha, squash, textFragment, type Boundary } from "./pdf.ts";

const SITE = "https://projectdelivery.gov.uk/teal-book/home/";

export interface TealChapter {
  /** The chapter's web page, used as the doc path for every section in it. */
  url: string;
  title: string;
  sections: Section[];
  hash: string;
}

export interface TealBook {
  chapters: TealChapter[];
  /** From the cover, e.g. "3.0". */
  version: string | null;
  /** Hash over every chapter's text. Stable across nightly regenerations. */
  contentHash: string;
  /** Top-level outline entries this parser did not recognise, so dropped. */
  unrecognised: string[];
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Running header and footer. The footer carries the generation date, which changes
// every night: leaving it in would make the content hash move daily and report a
// change that never happened.
const RUNNING = [
  /^\d*\s*The Teal Book: Project delivery in government$/,
  /^Generated from the Government Project Delivery website on/,
];

// Belt and braces for the same thing: the running header and footer sit in the top
// and bottom margins of an A4 page (842pt high), where body text never goes.
const inMargin = (y: number) => y > 795 || y < 45;

export const downloadTealBook = (url: string) => downloadPdf(url, "weekly Teal Book refresh");

export async function parseTealBook(data: Uint8Array): Promise<TealBook> {
  const pdf = await openPdf(data);

  // --- Walk the outline into chapters and section boundaries -------------------
  const chapters: { url: string; title: string }[] = [];
  const boundaries: Boundary[] = [];
  const unrecognised: string[] = [];
  let part: string | null = null;

  for (const node of pdf.outline) {
    const title = squash(node.title);
    const partLetter = /^Part ([A-F])$/.exec(title)?.[1];
    if (partLetter) {
      // A part divider page. Its one child carries the part's name, which is half
      // of every chapter URL in it.
      const name = squash(node.items?.[0]?.title ?? "");
      part = slugify(`Part ${partLetter}: ${name}`);
      continue;
    }

    let url: string | null = null;
    if (title === "About The Teal Book") url = `${SITE}about-the-teal-book/`;
    else if (title === "The structure of The Teal Book" || title === "How to use The Teal Book") url = `${SITE}${slugify(title)}/`;
    else if (part && (/^Chapter \d+:/.test(title) || /^Part [A-F]: Introduction$/.test(title))) url = `${SITE}${part}/${slugify(title)}/`;

    if (!url) {
      // Front and back matter (copyright, contents, back cover) is expected here.
      // Anything else is a structural change worth a person's attention.
      if (!/^©|^Contents$/.test(title) && (node.items?.length ?? 0) > 0) unrecognised.push(title);
      continue;
    }
    chapters.push({ url, title });
    boundaries.push(...(await outlineBoundaries(pdf, [node], chapters.length - 1)));
  }

  const lines = await pdf.lines();
  const sections = buildSections(
    lines,
    boundaries,
    (l) => inMargin(l.y) || RUNNING.some((r) => r.test(l.text)),
    (b, text) => (b.trail.length === 1 ? null : textFragment(b.title, text)),
  );

  const out: TealChapter[] = chapters.map((c) => ({ ...c, sections: [], hash: "" }));
  for (const [boundary, section] of sections) {
    const chapter = out[boundary.group]!;
    chapter.sections.push({ ...section, ordinal: chapter.sections.length });
  }
  for (const c of out) c.hash = sha(c.sections.map((s) => `${s.headingPath}\n${s.text}`).join("\n\n"));

  const version = /Version:\s*([\d.]+)/.exec(await pdf.pageText(1))?.[1] ?? null;
  await pdf.destroy();
  return {
    chapters: out,
    version,
    contentHash: sha(out.map((c) => `${c.url} ${c.hash}`).join("\n")),
    unrecognised,
  };
}
