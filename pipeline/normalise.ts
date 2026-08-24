/**
 * Turn govspeak HTML into heading-delimited sections.
 *
 * GOV.UK HTML publications are clean and predictable: headings carry stable `id`
 * attributes that work as deep-link anchors, so there is no need for a full DOM
 * parser here. A purpose-built splitter keeps the dependency count at one.
 */

export interface Section {
  anchor: string | null;
  heading: string;
  headingPath: string;
  level: number;
  ordinal: number;
  text: string;
}

const BLOCK_END = /<\/(p|li|h[1-6]|div|tr|blockquote|td|th)>/gi;

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(BLOCK_END, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
    .replace(/&pound;/g, "£")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

const HEADING = /<h([2-4])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
const ID_ATTR = /\bid=["']([^"']+)["']/i;

export function splitSections(html: string): Section[] {
  const matches = [...html.matchAll(HEADING)];
  if (matches.length === 0) {
    const text = htmlToText(html);
    return text ? [{ anchor: null, heading: "(untitled)", headingPath: "(untitled)", level: 2, ordinal: 0, text }] : [];
  }

  const sections: Section[] = [];
  // Tracks the current heading at each level, so a section knows its ancestry.
  const trail: string[] = [];

  matches.forEach((m, i) => {
    const level = Number(m[1]);
    const heading = htmlToText(m[3] ?? "").replace(/\n/g, " ").trim();
    const anchor = ID_ATTR.exec(m[2] ?? "")?.[1] ?? null;

    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index ?? html.length : html.length;
    const text = htmlToText(html.slice(start, end));

    trail.length = level - 2;
    trail[level - 2] = heading;
    const headingPath = trail.filter(Boolean).join(" > ");

    // Heading-only sections (a parent with no prose of its own) carry no retrievable
    // content, so drop them rather than polluting the index.
    if (text) sections.push({ anchor, heading, headingPath, level, ordinal: sections.length, text });
  });

  return sections;
}
