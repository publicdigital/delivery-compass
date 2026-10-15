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
import { createHash } from "node:crypto";
import type { Section } from "../normalise.ts";

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

interface OutlineNode {
  title: string;
  dest: unknown;
  items?: OutlineNode[];
}

interface Boundary {
  page: number;
  y: number;
  title: string;
  /** Titles from the chapter down to this heading. */
  trail: string[];
  chapter: number;
}

interface Line {
  page: number;
  y: number;
  x: number;
  height: number;
  text: string;
  /** Where the last run of text on this line ended, to tell a word gap from a style change. */
  end: number;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Text fragment for a heading. Every chapter page repeats its headings in a
 * contents list, and a bare fragment jumps to the first match, which is that list.
 * So the fragment also names the first few words after the heading (`,-suffix`),
 * which only the real heading has. If the suffix ever fails to match, the browser
 * simply opens the chapter at the top. "-", "&" and "," are fragment syntax, so
 * they are escaped on top of the usual URI encoding.
 */
const enc = (s: string) => encodeURIComponent(s).replace(/-/g, "%2D").replace(/,/g, "%2C");
const textFragment = (heading: string, text: string) => {
  const lead = text.split(/\s+/).slice(0, 3).join(" ");
  return `:~:text=${enc(heading)}${lead ? `,-${enc(lead)}` : ""}`;
};

/** Collapse whitespace so a heading that wraps in the PDF still matches its outline title. */
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

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

export async function downloadPdf(url: string): Promise<Uint8Array> {
  // Says who we are, as the GOV.UK checker does. Not a browser's user agent: the
  // PDF is served openly, and nothing here should look like getting past a check.
  const res = await fetch(url, { headers: { "user-agent": "delivery-compass/0.1 (prototype; weekly Teal Book refresh)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  // A Cloudflare challenge comes back as HTML. Say so plainly rather than handing
  // pdf.js a web page and reporting a parse error.
  if (!type.includes("pdf")) throw new Error(`expected a PDF, got ${type || "no content type"}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function parseTealBook(data: Uint8Array): Promise<TealBook> {
  // Imported here, not at the top: only the pipeline needs pdf.js, and nothing that
  // imports this module for its types should pay for loading it.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data, verbosity: 0, isEvalSupported: false }).promise;

  const pageOf = async (dest: unknown): Promise<{ page: number; y: number }> => {
    const d = (typeof dest === "string" ? await doc.getDestination(dest) : dest) as unknown[] | null;
    if (!d) throw new Error("outline entry with no destination");
    const ref = d[0];
    const page = typeof ref === "number" ? ref : await doc.getPageIndex(ref as { num: number; gen: number });
    // [ref, {name: "XYZ"}, left, top, zoom]
    return { page, y: typeof d[3] === "number" ? d[3] : Infinity };
  };

  // --- Walk the outline into chapters and section boundaries -------------------
  const outline = ((await doc.getOutline()) ?? []) as OutlineNode[];
  const chapters: { url: string; title: string }[] = [];
  const boundaries: Boundary[] = [];
  const unrecognised: string[] = [];
  let part: string | null = null;

  const addBoundaries = async (node: OutlineNode, trail: string[], chapter: number) => {
    const here = [...trail, squash(node.title)];
    const { page, y } = await pageOf(node.dest);
    boundaries.push({ page, y, title: squash(node.title), trail: here, chapter });
    for (const child of node.items ?? []) await addBoundaries(child, here, chapter);
  };

  for (const node of outline) {
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
    await addBoundaries(node, [], chapters.length - 1);
  }

  // A heading starts where its destination is. Sort by position on the page
  // rather than trusting outline order.
  boundaries.sort((a, b) => a.page - b.page || b.y - a.y);

  // --- Read every page into lines -----------------------------------------------
  const lines: Line[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let current: Line | null = null;
    for (const raw of content.items) {
      if (!("str" in raw)) continue;
      const [, , , , x, y] = raw.transform as number[];
      if (raw.str.trim()) {
        if (current && Math.abs(current.y - y!) < 2) {
          // A link or bold phrase is its own run, often with no space character
          // either side. A horizontal gap is the only sign there was a space.
          const spaced = /\s$/.test(current.text) || /^\s/.test(raw.str) || x! - current.end > 1;
          current.text += (spaced ? " " : "") + raw.str;
        } else {
          if (current) lines.push(current);
          current = { page: p - 1, y: y!, x: x!, height: raw.height, text: raw.str, end: 0 };
        }
        current.end = x! + raw.width;
      }
      if (raw.hasEOL && current) { lines.push(current); current = null; }
    }
    if (current) lines.push(current);
    page.cleanup();
  }

  // --- Assign lines to the heading above them -----------------------------------
  const textBy = new Map<Boundary, Line[]>();
  let b = -1;
  for (const line of lines) {
    const text = squash(line.text);
    if (inMargin(line.y) || RUNNING.some((r) => r.test(text))) continue;
    while (b + 1 < boundaries.length) {
      const next = boundaries[b + 1]!;
      // Destinations mark the top of the heading; its baseline sits below that.
      if (line.page > next.page || (line.page === next.page && line.y <= next.y + 1)) b++;
      else break;
    }
    if (b < 0) continue; // before the first chapter: cover, copyright, contents
    const bucket = textBy.get(boundaries[b]!) ?? [];
    bucket.push({ ...line, text });
    textBy.set(boundaries[b]!, bucket);
  }

  // --- Build sections -----------------------------------------------------------
  const out: TealChapter[] = chapters.map((c) => ({ ...c, sections: [], hash: "" }));
  for (const boundary of boundaries) {
    const chapter = out[boundary.chapter]!;
    const text = paragraphs(stripHeading(textBy.get(boundary) ?? [], boundary.title));
    if (!text) continue; // a heading with no prose of its own, as splitSections does
    const isChapter = boundary.trail.length === 1;
    chapter.sections.push({
      anchor: isChapter ? null : textFragment(boundary.title, text),
      heading: boundary.title,
      headingPath: boundary.trail.join(" > "),
      level: Math.min(boundary.trail.length + 1, 4),
      ordinal: chapter.sections.length,
      text,
    });
  }

  const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
  for (const c of out) c.hash = sha(c.sections.map((s) => `${s.headingPath}\n${s.text}`).join("\n\n"));

  const cover = await (await doc.getPage(1)).getTextContent();
  const coverText = cover.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  const version = /Version:\s*([\d.]+)/.exec(coverText)?.[1] ?? null;

  await doc.destroy();
  return {
    chapters: out,
    version,
    contentHash: sha(out.map((c) => `${c.url} ${c.hash}`).join("\n")),
    unrecognised,
  };
}

/** Drop the heading's own line(s) from the top of its text, however it wrapped. */
function stripHeading(lines: Line[], heading: string): Line[] {
  let acc = "";
  for (let i = 0; i < Math.min(lines.length, 4); i++) {
    acc = squash(`${acc} ${lines[i]!.text}`);
    if (acc === heading) return lines.slice(i + 1);
    if (!heading.startsWith(acc)) break;
  }
  return lines;
}

/**
 * Rejoin wrapped lines into paragraphs, one per line of output, the shape the
 * HTML splitter produces. The obligation extractor works sentence by sentence, and
 * a sentence broken across three lines would otherwise be three fragments.
 *
 * A new paragraph starts on a vertical gap wider than ordinary line spacing, a
 * change of indent (list items), a change of font size, or a page turn after a line
 * that ended a sentence.
 */
function paragraphs(lines: Line[]): string {
  const out: string[] = [];
  let prev: Line | null = null;
  for (const line of lines) {
    let joins = false;
    if (prev) {
      const samePage = prev.page === line.page;
      const gap = prev.y - line.y;
      const sameSize = Math.abs(prev.height - line.height) < 1;
      const sameIndent = Math.abs(prev.x - line.x) < 3;
      if (samePage) joins = sameSize && sameIndent && gap > 0 && gap < line.height * 1.9;
      else joins = sameSize && !/[.:;!?]$/.test(prev.text);
    }
    if (joins) out[out.length - 1] += ` ${line.text}`;
    else out.push(line.text);
    prev = line;
  }
  return out.join("\n").trim();
}
