/**
 * The one PDF reader. Used by the Teal Book (projectdelivery.ts) and by GOV.UK PDF
 * attachments (govuk-pdf.ts); each of those decides where sections start and what
 * a citation links to, and everything else lives here.
 *
 * PDFs are the exception, not the rule (HANDOVER.md §4: several seed PDFs extract
 * as garbage). A PDF is only read here once someone has checked that it extracts as
 * clean text, and a caller treats a PDF that parses to almost nothing as an
 * incident, not as content.
 *
 * The approach: a PDF has no headings, only positioned runs of text. So read every
 * page into lines, decide where each section starts (from the PDF's outline where it
 * has one, from type size where it does not), give each line to the heading above
 * it, and rejoin wrapped lines into paragraphs.
 */
import { createHash } from "node:crypto";
import type { Section } from "../normalise.ts";

export interface Line {
  /** Zero-based page index. */
  page: number;
  /** Baseline, in PDF points from the bottom of the page. */
  y: number;
  x: number;
  height: number;
  text: string;
  /** Where the last run of text on this line ended, to tell a word gap from a style change. */
  end: number;
  pageHeight: number;
}

/** Where a section starts, and the headings it sits under. */
export interface Boundary {
  page: number;
  /** Top of the heading. */
  y: number;
  title: string;
  /** Titles from the outermost heading down to this one. */
  trail: string[];
  /** Caller's grouping (the Teal Book groups by chapter). */
  group: number;
}

export interface OutlineNode {
  title: string;
  dest: unknown;
  items?: OutlineNode[];
}

/** Collapse whitespace so a heading that wraps in the PDF still matches its outline title. */
export const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export async function downloadPdf(url: string, purpose: string): Promise<Uint8Array> {
  // Says who we are, as the GOV.UK checker does. Not a browser's user agent: every
  // PDF read here is served openly, and nothing should look like getting past a check.
  const res = await fetch(url, { headers: { "user-agent": `delivery-compass/0.1 (prototype; ${purpose})` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  // A bot challenge comes back as HTML. Say so plainly rather than handing pdf.js a
  // web page and reporting a parse error.
  if (!type.includes("pdf")) throw new Error(`expected a PDF, got ${type || "no content type"}`);
  return new Uint8Array(await res.arrayBuffer());
}

export interface Pdf {
  numPages: number;
  outline: OutlineNode[];
  /** Page index and top-of-heading position an outline entry points at. */
  destOf(dest: unknown): Promise<{ page: number; y: number }>;
  lines(): Promise<Line[]>;
  pageText(page: number): Promise<string>;
  destroy(): Promise<void>;
}

export async function openPdf(data: Uint8Array): Promise<Pdf> {
  // Imported here, not at the top: only the pipeline needs pdf.js, and nothing that
  // imports a fetcher for its types should pay for loading it.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data, verbosity: 0, isEvalSupported: false }).promise;

  return {
    numPages: doc.numPages,
    outline: ((await doc.getOutline()) ?? []) as OutlineNode[],

    async destOf(dest) {
      const d = (typeof dest === "string" ? await doc.getDestination(dest) : dest) as unknown[] | null;
      if (!d) throw new Error("outline entry with no destination");
      const ref = d[0];
      const page = typeof ref === "number" ? ref : await doc.getPageIndex(ref as { num: number; gen: number });
      // [ref, {name: "XYZ"}, left, top, zoom]; "Fit"-style destinations have no top.
      return { page, y: typeof d[3] === "number" ? d[3] : Infinity };
    },

    async lines() {
      const lines: Line[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const pageHeight = page.view[3]!;
        const content = await page.getTextContent();
        let current: Line | null = null;
        for (const raw of content.items) {
          if (!("str" in raw)) continue;
          const [, , , , x, y] = raw.transform as number[];
          // A footnote marker is a small number raised above the line it sits in. As
          // its own run at its own height it would end the line and split the
          // sentence in two, which the obligation extractor then reads as two
          // fragments. It adds nothing to the text, so drop it.
          if (current && /^\d{1,2}$/.test(raw.str.trim()) && raw.height < current.height * 0.85 && y! > current.y && y! - current.y < current.height) {
            continue;
          }
          if (raw.str.trim()) {
            if (current && Math.abs(current.y - y!) < 2) {
              // A link or bold phrase is its own run, often with no space character
              // either side. A horizontal gap is the only sign there was a space.
              const spaced = /\s$/.test(current.text) || /^\s/.test(raw.str) || x! - current.end > 1;
              current.text += (spaced ? " " : "") + raw.str;
            } else {
              if (current) lines.push(current);
              current = { page: p - 1, y: y!, x: x!, height: raw.height, text: raw.str, end: 0, pageHeight };
            }
            current.end = x! + raw.width;
          }
          if (raw.hasEOL && current) { lines.push(current); current = null; }
        }
        if (current) lines.push(current);
        page.cleanup();
      }
      return lines;
    },

    async pageText(n) {
      const content = await (await doc.getPage(n)).getTextContent();
      return content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
    },

    destroy: () => doc.destroy(),
  };
}

/**
 * Turn lines into sections, one per boundary. A line belongs to the last boundary
 * at or above it; lines before the first boundary (cover, contents) are dropped,
 * and so is any line `skip` rejects (running headers and footers).
 *
 * `anchor` gives each section its deep-link anchor, given its boundary and text.
 */
export function buildSections(
  lines: Line[],
  boundaries: Boundary[],
  skip: (line: Line) => boolean,
  anchor: (b: Boundary, text: string) => string | null,
): Map<Boundary, Section> {
  // A heading starts where its destination is. Sort by position on the page rather
  // than trusting outline order.
  const sorted = placeOnPage(boundaries, lines).sort((a, b) => a.page - b.page || b.y - a.y);

  const textBy = new Map<Boundary, Line[]>();
  let b = -1;
  for (const line of lines) {
    const text = squash(line.text);
    if (skip({ ...line, text })) continue;
    while (b + 1 < sorted.length) {
      const next = sorted[b + 1]!;
      // Destinations mark the top of the heading; its baseline sits below that.
      if (line.page > next.page || (line.page === next.page && line.y <= next.y + 1)) b++;
      else break;
    }
    if (b < 0) continue;
    const bucket = textBy.get(sorted[b]!) ?? [];
    bucket.push({ ...line, text });
    textBy.set(sorted[b]!, bucket);
  }

  const out = new Map<Boundary, Section>();
  let ordinal = 0;
  for (const boundary of sorted) {
    // A contents page is a boundary (so its lines don't run into the section
    // before it) but never a section of its own.
    if (/^(table of )?contents$/i.test(boundary.title)) continue;
    const text = paragraphs(stripHeading(textBy.get(boundary) ?? [], boundary.title));
    if (!text) continue; // a heading with no prose of its own, as splitSections does
    out.set(boundary, {
      anchor: anchor(boundary, text),
      heading: boundary.title,
      headingPath: boundary.trail.join(" > "),
      level: Math.min(boundary.trail.length + 1, 4),
      ordinal: ordinal++,
      text,
    });
  }
  return out;
}

const comparable = (s: string) => squash(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]/g, "");

/** Many documents print a heading with its number ("1 Introduction", "7.2 Scope") but bookmark it without. */
const unnumbered = (s: string) => s.replace(/^\d+(\.\d+)*\.?\s+/, "");

/**
 * Many exports bookmark a page, not a spot on it ("Fit" destinations), so every
 * heading on that page would appear to start at the top and all but the last would
 * lose their text. Find each such heading's own line on its page instead, searching
 * down the page in outline order. A heading that cannot be found keeps the top of
 * the page, which is no worse than before.
 */
function placeOnPage(boundaries: Boundary[], lines: Line[]): Boundary[] {
  const below = new Map<number, number>(); // page -> y of the last heading placed on it
  return boundaries.map((b) => {
    if (Number.isFinite(b.y)) return b;
    const want = comparable(b.title);
    const floor = below.get(b.page) ?? Infinity;
    const onPage = lines.filter((l) => l.page === b.page && l.y < floor).sort((x, y) => y.y - x.y);
    for (let i = 0; i < onPage.length; i++) {
      // A heading may wrap: accumulate up to three lines while they stay a prefix.
      let acc = "";
      for (let j = i; j < Math.min(i + 3, onPage.length); j++) {
        acc = comparable(`${acc} ${onPage[j]!.text}`);
        const bare = unnumbered(acc);
        if (!acc || !(want.startsWith(acc) || (bare && want.startsWith(bare)))) break;
        if (acc === want || bare === want) {
          const top = onPage[i]!.y + onPage[i]!.height;
          below.set(b.page, onPage[j]!.y);
          return { ...b, y: top };
        }
      }
    }
    return { ...b, y: onPage[0] ? onPage[0].pageHeight : b.y };
  });
}

/**
 * Walk an outline into boundaries. `keep` drops entries that are not sections
 * (a Word or InDesign export bookmarks every table and figure too); a dropped
 * entry's children are dropped with it.
 */
export async function outlineBoundaries(
  pdf: Pdf,
  nodes: OutlineNode[],
  group: number,
  keep: (title: string) => boolean = () => true,
  trail: string[] = [],
): Promise<Boundary[]> {
  const out: Boundary[] = [];
  for (const node of nodes) {
    const title = squash(node.title);
    if (!title || !keep(title)) continue;
    const here = [...trail, title];
    const { page, y } = await pdf.destOf(node.dest);
    out.push({ page, y, title, trail: here, group });
    out.push(...(await outlineBoundaries(pdf, node.items ?? [], group, keep, here)));
  }
  return out;
}

/**
 * For a PDF with no outline: headings are the lines set noticeably larger than the
 * body text. The body size is the one most characters are set in; each larger size
 * is a heading level, biggest first. Wrapped headings (consecutive lines at the same
 * large size) are joined.
 */
export function typeSizeBoundaries(lines: Line[], skip: (line: Line) => boolean): Boundary[] {
  const body = new Map<number, number>();
  for (const l of lines) if (!skip(l)) body.set(Math.round(l.height), (body.get(Math.round(l.height)) ?? 0) + l.text.length);
  const bodySize = [...body].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;

  // The cover (first page) is set large throughout and is never a section.
  const isHeading = (l: Line) =>
    l.page > 0 && !skip(l) && Math.round(l.height) >= bodySize * 1.2 && squash(l.text).length <= 150 && /^[A-Z0-9]/.test(squash(l.text));

  const heads: { line: Line; title: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!isHeading(l)) continue;
    const prev = heads[heads.length - 1];
    const prevLine = lines[i - 1];
    if (prev && prevLine === prev.line && prevLine.page === l.page && Math.round(prevLine.height) === Math.round(l.height)) {
      prev.title = squash(`${prev.title} ${l.text}`);
      prev.line = l;
      continue;
    }
    heads.push({ line: l, title: squash(l.text) });
  }

  const sizes = [...new Set(heads.map((h) => Math.round(h.line.height)))].sort((a, b) => b - a);
  const trail: string[] = [];
  return heads.map(({ line, title }) => {
    const depth = Math.min(sizes.indexOf(Math.round(line.height)), 2);
    trail.length = depth;
    trail[depth] = title;
    // The first line's top, not the last line's: a wrapped heading starts above.
    const first = lines.find((l) => l.page === line.page && Math.round(l.height) === Math.round(line.height) && squash(l.text) && title.startsWith(squash(l.text)));
    const top = (first ?? line).y + line.height;
    return { page: line.page, y: top, title, trail: trail.filter(Boolean), group: 0 };
  });
}

/**
 * Lines repeated in the top or bottom margin of many pages: running headers,
 * footers, page numbers, protective markings. Digits are ignored when comparing,
 * so "Page 4 of 30" and "Page 5 of 30" count as the same line.
 */
export function runningLines(lines: Line[], numPages: number): (line: Line) => boolean {
  const inMargin = (l: Line) => l.y > l.pageHeight * 0.92 || l.y < l.pageHeight * 0.08;
  const key = (l: Line) => squash(l.text).replace(/\d+/g, "#");
  const pagesWith = new Map<string, Set<number>>();
  for (const l of lines) {
    if (!inMargin(l)) continue;
    const k = key(l);
    pagesWith.set(k, (pagesWith.get(k) ?? new Set()).add(l.page));
  }
  const threshold = Math.max(3, numPages * 0.3);
  return (l) => {
    if (!inMargin(l)) return false;
    const k = key(l);
    return /^[#\s|/-]*$/.test(k) || (pagesWith.get(k)?.size ?? 0) >= threshold;
  };
}

/** Drop the heading's own line(s) from the top of its text, however it wrapped. */
function stripHeading(lines: Line[], heading: string): Line[] {
  let acc = "";
  for (let i = 0; i < Math.min(lines.length, 4); i++) {
    acc = squash(`${acc} ${lines[i]!.text}`);
    const bare = unnumbered(acc);
    if (acc === heading || bare === heading) return lines.slice(i + 1);
    if (!heading.startsWith(acc) && !heading.startsWith(bare)) break;
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
