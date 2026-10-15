/**
 * Retrieval for Delivery Compass, in plain ES-module JavaScript.
 *
 * This file is loaded unchanged by the browser AND imported by the golden test in
 * Node, deliberately: the suite that decides whether retrieval is good enough must
 * exercise the same code a user does. The hosting has no build step (the deploy runs
 * `netlify deploy --dir=.` over the repo as-is), so this is plain .js with JSDoc
 * types rather than TypeScript.
 *
 * It replaces SQLite FTS5 `bm25(sections_fts, 3.0, 1.0)` blended with a title
 * affinity bonus. The blend is reproduced exactly; BM25 itself is reimplemented
 * rather than ported, so absolute scores differ from SQLite's. Only the ordering
 * matters, and test/golden.test.ts is what certifies it.
 */

/** Terms carrying no retrieval signal in this corpus. Matches pipeline/search.ts. */
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "is", "are", "do", "does",
  "what", "which", "who", "when", "how", "i", "we", "my", "our", "it", "this", "that",
  "be", "been", "with", "at", "by", "from", "as", "if", "can", "need", "needs", "about",
]);

/** `queryTerms` in pipeline/search.ts drops these three as well, for title affinity. */
const STOP_QUERY = new Set([...STOP, "require", "requires", "required"]);

const CONSONANT = /[^aeiou]/;

/** Is the character at position i a consonant, treating y contextually? */
function isConsonant(word, i) {
  const c = word[i];
  if (c === "y") return i === 0 ? true : !isConsonant(word, i - 1);
  return CONSONANT.test(c);
}

/** Porter's measure m: the number of vowel-consonant sequences in a stem. */
function measure(word) {
  let n = 0;
  let i = 0;
  const len = word.length;
  while (i < len && isConsonant(word, i)) i++;
  while (i < len) {
    while (i < len && !isConsonant(word, i)) i++;
    if (i >= len) break;
    n++;
    while (i < len && isConsonant(word, i)) i++;
  }
  return n;
}

const hasVowel = (w) => { for (let i = 0; i < w.length; i++) if (!isConsonant(w, i)) return true; return false; };
const endsDoubleConsonant = (w) => w.length > 1 && w[w.length - 1] === w[w.length - 2] && isConsonant(w, w.length - 1);
const endsCVC = (w) => {
  if (w.length < 3) return false;
  const l = w.length - 1;
  return isConsonant(w, l - 2) && !isConsonant(w, l - 1) && isConsonant(w, l) && !"wxy".includes(w[l]);
};

const STEP2 = [
  ["ational", "ate"], ["tional", "tion"], ["enci", "ence"], ["anci", "ance"], ["izer", "ize"],
  ["abli", "able"], ["alli", "al"], ["entli", "ent"], ["eli", "e"], ["ousli", "ous"],
  ["ization", "ize"], ["ation", "ate"], ["ator", "ate"], ["alism", "al"], ["iveness", "ive"],
  ["fulness", "ful"], ["ousness", "ous"], ["aliti", "al"], ["iviti", "ive"], ["biliti", "ble"],
];
const STEP3 = [["icate", "ic"], ["ative", ""], ["alize", "al"], ["iciti", "ic"], ["ical", "ic"], ["ful", ""], ["ness", ""]];
const STEP4 = [
  "al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement", "ment", "ent",
  "ion", "ou", "ism", "ate", "iti", "ous", "ive", "ize",
];

/**
 * Porter stemmer, matching the `porter unicode61` tokenizer the SQLite index used.
 * Stemming is what lets "approval" find "approve" and "reporting" find "report" —
 * dropping it would quietly change which sections come back.
 */
export function stem(word) {
  let w = word;
  if (w.length < 3) return w;

  // Step 1a — plurals.
  if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("ies")) w = w.slice(0, -2);
  else if (w.endsWith("ss")) { /* keep */ }
  else if (w.endsWith("s")) w = w.slice(0, -1);

  // Step 1b — past tense and gerunds.
  if (w.endsWith("eed")) {
    if (measure(w.slice(0, -3)) > 0) w = w.slice(0, -1);
  } else if ((w.endsWith("ed") && hasVowel(w.slice(0, -2))) || (w.endsWith("ing") && hasVowel(w.slice(0, -3)))) {
    w = w.endsWith("ed") ? w.slice(0, -2) : w.slice(0, -3);
    if (w.endsWith("at") || w.endsWith("bl") || w.endsWith("iz")) w += "e";
    else if (endsDoubleConsonant(w) && !"lsz".includes(w[w.length - 1])) w = w.slice(0, -1);
    else if (measure(w) === 1 && endsCVC(w)) w += "e";
  }

  // Step 1c — terminal y.
  if (w.endsWith("y") && hasVowel(w.slice(0, -1))) w = w.slice(0, -1) + "i";

  // Steps 2 and 3 — derivational suffixes.
  for (const [suf, rep] of STEP2) {
    if (w.endsWith(suf)) { if (measure(w.slice(0, -suf.length)) > 0) w = w.slice(0, -suf.length) + rep; break; }
  }
  for (const [suf, rep] of STEP3) {
    if (w.endsWith(suf)) { if (measure(w.slice(0, -suf.length)) > 0) w = w.slice(0, -suf.length) + rep; break; }
  }

  // Step 4 — strip suffixes from longer stems.
  for (const suf of STEP4) {
    if (!w.endsWith(suf)) continue;
    const base = w.slice(0, -suf.length);
    if (measure(base) > 1 && (suf !== "ion" || "st".includes(base[base.length - 1]))) w = base;
    break;
  }

  // Step 5 — terminal e and doubled l.
  if (w.endsWith("e")) {
    const base = w.slice(0, -1);
    const m = measure(base);
    if (m > 1 || (m === 1 && !endsCVC(base))) w = base;
  }
  if (measure(w) > 1 && endsDoubleConsonant(w) && w.endsWith("l")) w = w.slice(0, -1);

  return w;
}

/** Split text into stemmed terms, dropping stop words and single characters. */
export function tokenize(text, stopSet = STOP) {
  const out = [];
  const raw = String(text).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/);
  for (const t of raw) {
    if (t.length < 2 || stopSet.has(t)) continue;
    out.push(stem(t));
  }
  return out;
}

/**
 * Bare (unstemmed) content terms from a question, for title affinity.
 * Mirrors `queryTerms` in pipeline/search.ts, including its 12-term cap.
 */
export function queryTerms(question) {
  return String(question)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_QUERY.has(t))
    .slice(0, 12);
}

/**
 * The words of a document's own title, recovered from its URL slug.
 *
 * Sections carry the title of their registry SOURCE, which for a 144-page manual is
 * just "Service Manual" for every one of them — useless as a ranking signal and
 * actively misleading for affinity. GOV.UK slugs are the page title hyphenated, so
 * the last path segment gives the document title back for free, with no re-ingest
 * and no schema change. "how should governance change for agile delivery" failed to
 * reach /service-manual/.../governance-principles-for-agile-service-delivery until
 * this was added.
 */
export function docTitleWords(docPath) {
  const last = String(docPath ?? "").split("/").filter(Boolean).pop() ?? "";
  return last.replace(/-/g, " ");
}

/**
 * Fraction of query terms appearing in a document's title.
 *
 * A question naming a document ("what does the technology code of practice require")
 * should return that document, but BM25 over section text alone ranks whichever
 * source mentions the phrase most often — usually a different one citing it.
 *
 * Matched against the source title and the document's own slug-derived title
 * together, so both "the Service Manual" and "governance principles for agile
 * service delivery" are things a reader can successfully name.
 */
export function titleAffinity(title, terms) {
  if (terms.length === 0) return 0;
  const t = String(title).toLowerCase();
  return terms.filter((term) => t.includes(term)).length / terms.length;
}

const K1 = 1.2;
const B = 0.75;
/** Field weights, matching bm25(sections_fts, 3.0, 1.0): headings count treble. */
const W_HEADING = 3.0;
const W_TEXT = 1.0;
/** Weight on title affinity when blended with the BM25 score. */
const TITLE_BOOST = 8;

/**
 * Ceiling on a single term's inverse document frequency.
 *
 * BM25 rewards rare terms, which is usually right and occasionally catastrophic. Asked
 * "what governance is recommended for test and learn accelerators", the corpus put the
 * Treasury Approvals Process top: "accelerators" stems to "acceler", which appears in
 * "Accelerated projects and programmes" and almost nowhere else, so one off-target word
 * outscored four on-target ones. Over 3,300 sections an unstemmed hapax scores about
 * 7.7; this caps the advantage without flattening genuinely distinctive terms.
 */
const IDF_CAP = 4.5;

/**
 * How much matching more of the query is worth.
 *
 * A document matching one rare term should not beat one matching four of five. The
 * final score is multiplied by COVERAGE_FLOOR + (1 - COVERAGE_FLOOR) * matched/asked,
 * so a single-term match keeps roughly half its score and a full match keeps all of it.
 * Lucene calls this a coordination factor. A hard matched/asked multiplier was too
 * brutal: it buried good single-paragraph answers to long, chatty questions.
 */
const COVERAGE_FLOOR = 0.45;

/**
 * Weight given to a term the reader did not type.
 *
 * Concept expansion (sources/concepts.yaml) bridges the gap between what people ask
 * and what the guidance calls itself. It must never outvote the actual question, so
 * expanded terms count for well under half of a typed one, and they do not count
 * towards coverage — otherwise a document matching only the expansion would look
 * like a document matching the whole query.
 */
const EXPANSION_WEIGHT = 0.4;

/**
 * Build an inverted index over sections.
 *
 * Built in the browser on load rather than shipped prebuilt: the postings lists
 * serialise larger than the section text they describe, and the text has to be
 * downloaded anyway to render results.
 *
 * @param {{id:number, heading:string, text:string}[]} docs
 */
export function buildIndex(docs) {
  /** @type {Map<string, Map<number, [number, number]>>} term -> docId -> [headingTf, textTf] */
  const postings = new Map();
  const headingLen = new Map();
  const textLen = new Map();
  let totalHeading = 0;
  let totalText = 0;

  for (const doc of docs) {
    const h = tokenize(doc.heading ?? "");
    const t = tokenize(doc.text ?? "");
    headingLen.set(doc.id, h.length);
    textLen.set(doc.id, t.length);
    totalHeading += h.length;
    totalText += t.length;

    const bump = (term, slot) => {
      let byDoc = postings.get(term);
      if (!byDoc) { byDoc = new Map(); postings.set(term, byDoc); }
      const entry = byDoc.get(doc.id) ?? [0, 0];
      entry[slot]++;
      byDoc.set(doc.id, entry);
    };
    for (const term of h) bump(term, 0);
    for (const term of t) bump(term, 1);
  }

  const n = docs.length || 1;
  return {
    postings,
    headingLen,
    textLen,
    docCount: n,
    avgHeading: totalHeading / n || 1,
    avgText: totalText / n || 1,
  };
}

function bm25Field(tf, docLen, avgLen, idf) {
  if (tf === 0) return 0;
  return idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLen / avgLen))));
}

/**
 * Score documents for a question and return them best-first.
 *
 * Terms are OR-ed, as the FTS5 query was: a document matching more of them scores
 * higher through BM25 rather than through a hard AND, so a long question still
 * returns its best partial matches instead of nothing.
 *
 * @returns {{id:number, score:number}[]}
 */
export function scoreDocs(index, question, expansion = []) {
  const terms = tokenize(question);
  if (terms.length === 0) return [];

  const asked = new Set(terms.slice(0, 12));
  // Expanded terms the reader already typed add nothing; drop them so they do not
  // get double counted at a lower weight.
  const extra = [...new Set(expansion.map((t) => stem(String(t).toLowerCase())))]
    .filter((t) => t.length > 1 && !asked.has(t))
    .slice(0, 16);

  /** @type {Map<number, number>} */
  const scores = new Map();
  /** @type {Map<number, number>} how many of the reader's own terms each document matched */
  const matched = new Map();

  const weighted = [...[...asked].map((t) => [t, 1, true]), ...extra.map((t) => [t, EXPANSION_WEIGHT, false])];

  for (const [term, weight, counts] of weighted) {
    const byDoc = index.postings.get(term);
    if (!byDoc) continue;
    // Probabilistic IDF, floored so a term in almost every document cannot score
    // negative, and capped so one rare term cannot carry a document on its own.
    const df = byDoc.size;
    const idf = Math.min(IDF_CAP, Math.max(0.01, Math.log(1 + (index.docCount - df + 0.5) / (df + 0.5))));
    for (const [docId, [hTf, tTf]] of byDoc) {
      const s =
        W_HEADING * bm25Field(hTf, index.headingLen.get(docId) ?? 0, index.avgHeading, idf) +
        W_TEXT * bm25Field(tTf, index.textLen.get(docId) ?? 0, index.avgText, idf);
      scores.set(docId, (scores.get(docId) ?? 0) + s * weight);
      if (counts) matched.set(docId, (matched.get(docId) ?? 0) + 1);
    }
  }

  return [...scores]
    .map(([id, score]) => {
      const coverage = COVERAGE_FLOOR + (1 - COVERAGE_FLOOR) * ((matched.get(id) ?? 0) / asked.size);
      return { id, score: score * coverage, matched: matched.get(id) ?? 0, asked: asked.size };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * What the search actually looked for, so the interface can show it.
 *
 * A reader who can see that "accelerators" was searched as "acceler", and matched
 * three sections about accelerated Treasury approvals, can diagnose their own odd
 * result in a second. Without it the ranking is unexplainable and people conclude the
 * tool has nothing, when what happened is that one word pulled it sideways.
 *
 * @returns {{raw: string, stem: string, docs: number, matched: boolean}[]}
 */
export function explainQuery(index, question) {
  const seen = new Set();
  const out = [];
  const raws = String(question)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const raw of raws) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    const stem_ = stem(raw);
    if (seen.has(stem_)) continue;
    seen.add(stem_);
    if (out.length >= 12) break;
    const docs = index.postings.get(stem_)?.size ?? 0;
    out.push({ raw, stem: stem_, docs, matched: docs > 0 });
  }
  return out;
}

/**
 * Full retrieval: score, blend in title affinity, then de-duplicate.
 *
 * Registry entries legitimately overlap — the Service Manual crawl reaches the
 * spend-controls guide, which is also registered in its own right — so the same
 * passage can arrive twice under different source ids. Keep the best-scoring copy.
 *
 * @param {object} index          from buildIndex
 * @param {Map<number, object>} byId  section id -> section record
 * @param {string} question
 * @param {number} limit
 */
export function searchSections(index, byId, question, limit = 6, concepts = null) {
  const bridge = concepts ? matchConcepts(concepts, question) : { terms: [], concepts: [] };
  const scored = scoreDocs(index, question, bridge.terms);
  if (scored.length === 0) return [];

  const terms = queryTerms(question);
  const boosted = new Set(bridge.concepts.flatMap((c) => c.sources ?? []));
  const boostedDocs = bridge.concepts.flatMap((c) => c.docs ?? []);
  const pool = scored.slice(0, Math.max(limit * 8, 60));

  const ranked = pool
    .map(({ id, score }) => {
      const section = byId.get(id);
      if (!section) return null;
      const titleText = `${section.sourceTitle} ${docTitleWords(section.docPath)}`;
      // A nudge, not a override: enough to lift the canonical document into view when
      // a concept names it, not enough to beat a strong direct match elsewhere.
      const named =
        (boostedDocs.some((d) => section.docPath.includes(d)) ? 4 : 0) +
        (boosted.has(section.sourceId) ? 1.5 : 0);
      return { section, rank: score + titleAffinity(titleText, terms) * TITLE_BOOST + named };
    })
    .filter(Boolean)
    .sort((a, b) => b.rank - a.rank);

  const seen = new Set();
  const out = [];
  for (const { section } of ranked) {
    const key = `${section.docPath}#${section.anchor ?? section.heading}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(section);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Which curated concepts a question touches, and the terms they contribute.
 *
 * Substring matching on the raw question rather than on stems, because the triggers
 * are phrases ("new ways of funding") and phrase structure is exactly what stemming
 * throws away.
 *
 * @returns {{terms: string[], concepts: object[]}}
 */
export function matchConcepts(concepts, question) {
  const q = String(question).toLowerCase();
  const hit = (concepts ?? []).filter((c) => (c.triggers ?? []).some((t) => q.includes(String(t).toLowerCase())));
  return { terms: hit.flatMap((c) => c.terms ?? []), concepts: hit };
}

/**
 * Deep link to the exact heading. A doc path is a GOV.UK path, or a full URL for
 * a source hosted elsewhere (the Teal Book), whose anchor is a text fragment.
 */
export function citationUrl(section) {
  const base = /^https?:/.test(section.docPath) ? section.docPath : `https://www.gov.uk${section.docPath}`;
  return section.anchor ? `${base}#${section.anchor}` : base;
}
