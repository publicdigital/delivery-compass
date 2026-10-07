/**
 * Delivery Compass, client side.
 *
 * Everything that used to be `/api/ask` now happens here: the corpus ships as static
 * JSON, the search index is built in the browser on load (~400ms over 3,300 sections),
 * and all the enrichment — confirmed conflicts, candidate conflicts, section context —
 * was precomputed by pipeline/export-static.ts.
 *
 * The only thing that still leaves the browser is feedback, which is posted to
 * Netlify Forms. That is deliberate: feedback is the one thing here that cannot be
 * regenerated, so it must not live only in the tab that produced it.
 */
import { buildIndex, searchSections, citationUrl, explainQuery } from "./search.js";
import { renderGraph } from "./map.js";

const $ = (s) => document.querySelector(s);

/** Render into a panel and drop the loading style, which otherwise greys out real content. */
function render(selector, html) {
  const el = $(selector);
  el.innerHTML = html;
  el.classList.remove("loading");
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const date = (s) => (s ? String(s).slice(0, 10) : "unknown");

/**
 * A random id for this tab only, held in a variable — not a cookie, not localStorage,
 * gone when the tab closes. Enough to distinguish one person asking five questions
 * from five people asking one, which is the distinction that decides whether an
 * unanswered question is a real gap. Nothing about it identifies anybody.
 */
/** Fallback destination when a feedback POST fails. */
const FEEDBACK_EMAIL = "oli.lovell@public.digital";

const SESSION = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);

let surface = "ask";
let lastQuestion = "";

/** Corpus, loaded once. */
let sections = [];
let sectionById = new Map();
let obligationsBySection = {};
let index = null;
let ready = false;

/**
 * Every obligation and section card carries an explicit age badge, deliberately even
 * when the page is recent — an absent badge would otherwise read as "checked, fine",
 * which is not a claim this tool can back for pages it has not compared against anything.
 */
function ageTag(iso) {
  if (!iso) return '<span class="tag age-unknown">page date unknown</span>';
  const years = (Date.now() - new Date(iso).getTime()) / (365.25 * 86400000);
  if (years >= 3) return `<span class="tag age-old">page from ${date(iso)} &mdash; verify currency</span>`;
  if (years >= 1) return `<span class="tag age-mid">page from ${date(iso)}</span>`;
  return `<span class="tag age-fresh">page from ${date(iso)}</span>`;
}

// --- loading -----------------------------------------------------------------
async function loadJson(name) {
  const res = await fetch(`assets/data/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

async function boot() {
  try {
    const [meta, secs, obs] = await Promise.all([
      loadJson("meta.json"),
      loadJson("sections.json"),
      loadJson("obligations.json"),
    ]);

    sections = secs;
    sectionById = new Map(sections.map((s) => [s.id, s]));
    obligationsBySection = obs;
    index = buildIndex(sections);
    ready = true;

    render("#stats", `
      <div><span>${meta.sources}</span><small>sources indexed of ${meta.registered} registered</small></div>
      <div><span>${meta.sections.toLocaleString()}</span><small>sections</small></div>
      <div><span>${meta.obligations.toLocaleString()}</span><small>obligations extracted</small></div>
      <div><span>${meta.mandatory.toLocaleString()}</span><small>mandatory</small></div>
      <div><span>${meta.relations}</span><small>curated relationships</small></div>
      <div><span>${date(meta.indexedAt)}</span><small>corpus last refreshed</small></div>`);

    // A question typed before the corpus finished loading still runs.
    if (pendingQuestion) { const q = pendingQuestion; pendingQuestion = null; runAsk(q); }
  } catch (e) {
    render("#stats", `<div class="loading">Could not load the corpus (${esc(e.message)}). A reload usually fixes it.</div>`);
  }
}

let pendingQuestion = null;

// --- tabs --------------------------------------------------------------------
const loaded = new Set(["ask"]);
document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${btn.dataset.panel}`));
    const name = btn.dataset.panel;
    surface = name;
    if (!loaded.has(name)) { loaded.add(name); LOADERS[name]?.(); }
  });
});

// --- ask ---------------------------------------------------------------------
$("#ask-form").addEventListener("submit", (e) => { e.preventDefault(); runAsk($("#q").value); });
document.querySelectorAll(".examples button").forEach((b) =>
  b.addEventListener("click", () => { $("#q").value = b.dataset.q; runAsk(b.dataset.q); }));

/** Caveats for the set of sources an answer cites, from the curated relations. */
let relations = null;
async function caveatsFor(sourceIds) {
  if (!relations) relations = await loadJson("relations.json").catch(() => []);
  const map = await sourceTitles();
  const cited = new Set(sourceIds);
  return relations
    .filter((r) => (r.type === "supersedes" || r.type === "conflicts") && cited.has(r.to))
    .map((r) => ({
      type: r.type,
      scope: r.scope,
      effective: r.effective,
      guidance: r.guidance,
      evidence: r.evidence,
      supersededTitle: map.get(r.to) ?? r.to,
      byTitle: map.get(r.from) ?? r.from,
    }));
}

let titleMap = null;
async function sourceTitles() {
  if (titleMap) return titleMap;
  const { nodes } = await loadJson("map.json").catch(() => ({ nodes: [] }));
  titleMap = new Map(nodes.map((n) => [n.id, n.title]));
  return titleMap;
}

async function runAsk(q) {
  if (!q?.trim()) return;
  lastQuestion = q.trim();
  const out = $("#ask-results");

  if (!ready) {
    pendingQuestion = lastQuestion;
    out.innerHTML = '<p class="loading">Loading the corpus&hellip; your question will run as soon as it is ready.</p>';
    return;
  }

  out.innerHTML = '<p class="loading">Searching&hellip;</p>';

  const hits = searchSections(index, sectionById, lastQuestion, 6);
  const explain = queryExplainer(lastQuestion);

  if (hits.length === 0) {
    out.innerHTML = explain + `<div class="empty"><strong>No match in the corpus.</strong>
      <p>The corpus covers only the registered sources, so this is a gap rather than an answer. It has been logged as one &mdash; and it is worth saying more about
      <a href="#feedback">in the feedback form</a>, because an unanswered question is the most useful thing this prototype can be told.</p></div>` + rateStrip();
    wireRate();
    logQuery(lastQuestion, 0, 0);
    return;
  }

  // Obligations are scoped to the sections the query matched, so one is only shown
  // in the context that surfaced it. Strongest first, capped at ten.
  const RANK = { mandatory: 0, recommended: 1 };
  const obligations = hits
    .flatMap((h) => (obligationsBySection[String(h.id)] ?? []).map((o) => ({ ...o, sectionId: h.id })))
    .sort((a, b) => (RANK[a.strength] ?? 9) - (RANK[b.strength] ?? 9) || Number(b.conventional) - Number(a.conventional))
    .slice(0, 10);

  const caveats = await caveatsFor([...new Set(hits.map((h) => h.sourceId))]);

  let html = explain + rateStrip();

  for (const c of caveats) {
    html += `<div class="card warn">
      <span class="tag ${c.type === "supersedes" ? "superseded" : "mandatory"}">${c.type === "supersedes" ? "Superseded" : "Conflict"}</span>
      <strong>${esc(c.supersededTitle)}</strong> is out of date on <strong>${esc(c.scope ?? "this topic")}</strong>${c.effective ? ` (since ${esc(c.effective)})` : ""}.
      <p class="para-tight">Current position is in <strong>${esc(c.byTitle)}</strong>. ${esc(c.guidance ?? "")}</p>
      ${c.evidence ? `<p class="caveat-note">${esc(c.evidence)}</p>` : ""}
    </div>`;
  }

  if (obligations.length) {
    html += `<h2>What the guidance says</h2>`;
    // Consecutive obligations often come from the same section (e.g. two "must"
    // sentences in one paragraph). Showing the same surrounding text again under
    // each one would just be noise — show it once per run.
    let lastSection = null;
    for (const o of obligations) {
      const section = sectionById.get(o.sectionId);
      const sectionKey = `${o.sourceTitle}::${o.headingPath}`;
      const isNewSection = sectionKey !== lastSection;
      lastSection = sectionKey;

      const hasConfirmed = o.confirmedConflicts?.length > 0;
      const hasCandidate = !hasConfirmed && o.candidateConflicts?.length > 0;
      const quoteClass = hasConfirmed ? "conflict-confirmed" : hasCandidate ? "conflict-candidate" : "";

      let conflictNotes = "";
      for (const c of o.confirmedConflicts ?? []) {
        conflictNotes += `<div class="conflict-note confirmed">
          <strong>${c.type === "supersedes" ? "Superseded" : "Conflicts"}</strong> on ${esc(c.scope ?? "this point")}${c.effective ? ` (since ${esc(c.effective)})` : ""}
          &mdash; current position is in <strong>${esc(c.byTitle)}</strong>. ${esc(c.guidance ?? "")}</div>`;
      }
      for (const c of o.candidateConflicts ?? []) {
        conflictNotes += `<div class="conflict-note candidate">
          <strong>Possible conflict (unverified)</strong> &mdash; similar wording in <strong>${esc(c.sourceTitle)}</strong>,
          pages roughly ${Math.round((c.ageGapDays / 365) * 10) / 10} years apart: &ldquo;${esc(c.sentence)}&rdquo;
          <a href="${esc(c.url)}" target="_blank" rel="noopener">Compare on GOV.UK</a></div>`;
      }

      const context = section?.text ?? "";
      html += `<div class="card ${o.strength}">
        <span class="tag ${o.strength}">${o.strength}</span>${ageTag(o.updatedAt)}
        ${!o.conventional ? `<span class="meta inline">informal phrasing, not the document&rsquo;s declared convention</span>` : ""}
        <blockquote class="${quoteClass}">${esc(o.sentence)}</blockquote>
        ${conflictNotes}
        ${isNewSection
          ? `<div>${context.split("\n").map((p) => `<p class="para">${esc(p)}</p>`).join("")}
             ${section?.truncated ? `<p class="meta">Section continues &mdash; <a href="${esc(o.url)}" target="_blank" rel="noopener">read the rest on GOV.UK</a>.</p>` : ""}</div>`
          : `<p class="meta">(same section as above)</p>`}
        <div class="meta">${esc(o.sourceTitle)} &mdash; ${esc(o.body)}<br>${esc(o.headingPath)}<br>
        <a href="${esc(o.url)}" target="_blank" rel="noopener">Read on GOV.UK</a></div>
      </div>`;
    }
  }

  html += `<h2>Relevant sections</h2>`;
  // The top matches carry enough of the source's own words to read as a narrative;
  // weaker matches fall back to a one-line pointer and a click-through. Full text for
  // everything would bury the strongest matches; a snippet for everything was the
  // original complaint.
  hits.forEach((s, i) => {
    const primary = i < 3;
    const url = citationUrl(s);
    const body = primary
      ? s.text.split("\n").map((p) => `<p class="para">${esc(p)}</p>`).join("") +
        (s.truncated ? `<p class="meta">Section continues &mdash; <a href="${esc(url)}" target="_blank" rel="noopener">read the rest on GOV.UK</a>.</p>` : "")
      : `<p class="para">${esc(s.text.split("\n")[0].slice(0, 220))}&hellip;
         <a href="${esc(url)}" target="_blank" rel="noopener">Read the full section on GOV.UK</a></p>`;
    html += `<div class="card section">
      <span class="tag spine">${esc(s.spine)}</span><span class="tag ${s.authority}">${esc(s.authority)}</span>${ageTag(s.updatedAt)}
      <strong>${esc(s.headingPath)}</strong>
      ${body}
      <div class="meta">${esc(s.sourceTitle)} &mdash; ${esc(s.body)} &middot; indexed ${date(s.indexedAt)}
      ${s.staleIndex ? ' &middot; <strong class="alert">source changed since indexing</strong>' : ""}
      ${primary ? `<br><a href="${esc(url)}" target="_blank" rel="noopener">Read on GOV.UK</a>` : ""}</div>
    </div>`;
  });

  out.innerHTML = html;
  wireRate();
  logQuery(lastQuestion, hits.length, obligations.length);
}

/**
 * Show what the search actually looked for.
 *
 * Search is keyword matching over stemmed words, and when it goes wrong it usually
 * goes wrong for a legible reason: one unusual word dominated, or a word nobody in
 * the corpus uses matched nothing at all. A tester asking about "test and learn
 * accelerators" got the Treasury's accelerated-approvals process at the top and
 * reasonably concluded the tool had nothing useful. Seeing that "accelerators"
 * matched 7 sections, while "test" and "learn" matched hundreds, explains it in a
 * glance and suggests the fix - drop the word.
 */
function queryExplainer(question) {
  const terms = explainQuery(index, question);
  if (terms.length === 0) return "";

  const RARE = Math.max(5, Math.round(sections.length * 0.004)); // ~0.4% of the corpus

  const chips = terms.map((t) => {
    if (!t.matched) return `<span class="term none" title="No section in the corpus contains this word">${esc(t.raw)} &mdash; no matches</span>`;
    if (t.docs <= RARE) return `<span class="term rare" title="Rare words carry a lot of weight and can pull results off-topic">${esc(t.raw)} &mdash; ${t.docs} section${t.docs === 1 ? "" : "s"}</span>`;
    return `<span class="term">${esc(t.raw)}</span>`;
  }).join(" ");

  const odd = terms.filter((t) => !t.matched || t.docs <= RARE);
  const note = odd.length
    ? `<p class="meta">Highlighted words are rare or absent in this corpus. They carry a lot of weight in the ranking, so if the results look off-topic, try the question without them.</p>`
    : "";

  return `<div class="explain"><strong>Searched for</strong> ${chips}${note}</div>`;
}

// --- feedback ----------------------------------------------------------------
// Two routes in, deliberately. The one-click rating catches the majority who will
// never fill in a form; the form at the foot of the page catches the minority whose
// answer is worth ten ratings.
function rateStrip() {
  return `<div class="rate" id="rate">
    <strong>Did that answer your question?</strong>
    <button data-useful="yes">Yes</button>
    <button data-useful="partly">Partly</button>
    <button data-useful="no">No</button>
  </div>`;
}

function wireRate() {
  const strip = $("#rate");
  if (!strip) return;
  strip.querySelectorAll("button").forEach((b) => b.addEventListener("click", async () => {
    const useful = b.dataset.useful;
    await send({ kind: "rating", useful, question: lastQuestion, surface: "ask" });
    strip.innerHTML = useful === "yes"
      ? '<span class="done">Noted &mdash; thank you.</span>'
      : '<span class="done">Noted, thank you.</span> <span>If you have a moment, <a href="#feedback">what were you looking for?</a></span>';
  }));
}

/**
 * Record the question and how much came back.
 *
 * Search now runs in the browser, so unless this is sent explicitly the single most
 * useful signal — which questions returned nothing — would never leave the tab.
 *
 * Questions are buffered and sent in per-session batches rather than one submission
 * each. The hosting allows 100 form submissions a month; one engaged tester asking
 * twenty questions would otherwise eat a fifth of that in a sitting, and the batch
 * preserves the denominator (how many questions were asked at all), which is what
 * makes a zero-result count interpretable.
 */
const queryLog = [];
let flushedCount = 0;

function logQuery(question, hits, obligations) {
  queryLog.push({ q: question, hits, obligations, at: new Date().toISOString() });
  // Flush periodically so a tab closed by force-quit still reports most of a session.
  if (queryLog.length - flushedCount >= 10) flushQueries();
}

function flushQueries({ beacon = false } = {}) {
  if (queryLog.length === flushedCount) return;
  flushedCount = queryLog.length;
  const body = encode({
    "form-name": "compass-queries",
    session: SESSION,
    count: String(queryLog.length),
    zeroResults: String(queryLog.filter((q) => q.hits === 0).length),
    queries: JSON.stringify(queryLog),
    at: new Date().toISOString(),
  });
  // sendBeacon survives the page going away, which plain fetch does not.
  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon("/", new Blob([body], { type: "application/x-www-form-urlencoded" }));
    return;
  }
  fetch("/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }).catch(() => {});
}

// visibilitychange is the reliable moment to flush; beforeunload is not fired on
// mobile and is unreliable when a tab is discarded.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushQueries({ beacon: true });
});

function encode(data) {
  return Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

/** Ratings and comments go immediately — they are low-volume and high-value. */
async function send(payload) {
  try {
    const r = await fetch("/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: encode({ "form-name": "compass-feedback", session: SESSION, at: new Date().toISOString(), ...payload }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

$("#fb-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("#fb-status");
  const comment = $("#fb-comment").value.trim();
  if (!comment) return;
  status.className = "status";
  status.textContent = "Sending…";
  const ok = await send({
    kind: "comment",
    surface,
    comment,
    question: lastQuestion || null,
    role: $("#fb-role").value.trim() || null,
    contact: $("#fb-contact").value.trim() || null,
  });
  status.className = ok ? "status ok" : "status bad";
  status.textContent = ok
    ? "Thank you — that has been recorded."
    : "That did not send. Worth trying again, or telling me directly.";
  if (ok) $("#fb-comment").value = "";
});

/**
 * Hovering or focusing a node fades everything it is not connected to.
 *
 * With 26 edges over 41 nodes the middle of the diagram is busy, and the question a
 * reader actually has is "what does THIS one touch" — which is unanswerable by eye
 * and trivial to answer by dimming.
 */
function wireGraph() {
  const svg = document.querySelector(".graph svg");
  if (!svg) return;
  const nodes = [...svg.querySelectorAll(".g-node")];
  const edges = [...svg.querySelectorAll(".g-edge")];

  const focus = (id) => {
    if (!id) {
      svg.classList.remove("focused");
      nodes.forEach((n) => n.classList.remove("on", "off"));
      edges.forEach((e) => e.classList.remove("on", "off"));
      return;
    }
    const near = new Set([id]);
    edges.forEach((e) => {
      const hit = e.dataset.from === id || e.dataset.to === id;
      e.classList.toggle("on", hit);
      e.classList.toggle("off", !hit);
      if (hit) { near.add(e.dataset.from); near.add(e.dataset.to); }
    });
    svg.classList.add("focused");
    nodes.forEach((n) => {
      const hit = near.has(n.dataset.id);
      n.classList.toggle("on", hit);
      n.classList.toggle("off", !hit);
    });
  };

  for (const n of nodes) {
    n.addEventListener("mouseenter", () => focus(n.dataset.id));
    n.addEventListener("focus", () => focus(n.dataset.id));
    n.addEventListener("mouseleave", () => focus(null));
    n.addEventListener("blur", () => focus(null));
  }
  svg.addEventListener("mouseleave", () => focus(null));
}

// --- map and watch -----------------------------------------------------------
const LOADERS = {
  async map() {
    const { nodes, edges } = await loadJson("map.json");
    const byBody = new Map();
    for (const n of nodes) byBody.set(n.body, [...(byBody.get(n.body) ?? []), n]);

    // The drawing first, because the fragmentation is the thing worth seeing; the
    // lists below remain the accessible, complete rendering of the same data.
    let html = renderGraph(nodes, edges);
    html += `<h2>Who owns what</h2><p class="lede">${byBody.size} different bodies publish the guidance a delivery team is expected to follow.</p>`;
    for (const [body, ns] of [...byBody].sort((a, b) => b[1].length - a[1].length)) {
      html += `<div class="body-group"><h3>${esc(body)} <span class="meta">(${ns.length})</span></h3><ul>`;
      for (const n of ns.sort((a, b) => a.title.localeCompare(b.title))) {
        html += `<li><span class="tag ${n.authority}">${esc(n.authority)}</span> ${esc(n.title)}
          <span class="meta">&middot; ${
            n.contentStatus === "full"
              ? `${n.sections.toLocaleString()} section${n.sections === 1 ? "" : "s"} indexed`
              : n.contentStatus === "metadata_only"
                ? "landing page only &mdash; substance is a PDF or off-platform"
                : "not indexed"
          }</span></li>`;
      }
      html += `</ul></div>`;
    }

    const byType = new Map();
    for (const e of edges) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
    html += `<h2>How it connects</h2><p class="lede">Every edge is a curation judgement. GOV.UK models documents, not the relationships between them.</p>`;
    for (const [type, es] of [...byType].sort()) {
      html += `<div class="body-group"><h3>${esc(type)}</h3>`;
      for (const e of es) {
        html += `<div class="edge">${e.severity === "high" ? '<strong class="alert">! </strong>' : ""}${esc(e.from)} &rarr; ${esc(e.to)}${e.scope ? ` <span class="meta">${esc(e.scope)}</span>` : ""}</div>`;
      }
      html += `</div>`;
    }
    render("#map-results", html);
    wireGraph();
  },

  async watch() {
    const events = await loadJson("watch.json");
    let html = `<table><thead><tr><th>Date</th><th>Source</th><th>What the publisher said</th></tr></thead><tbody>`;
    for (const e of events) {
      html += `<tr><td>${date(e.timestamp)}</td>
        <td><strong>${esc(e.sourceTitle)}</strong><br><span class="meta">${esc(e.body)}</span></td>
        <td>${esc(e.note)}</td></tr>`;
    }
    html += `</tbody></table>`;
    render("#watch-results", events.length ? html : '<div class="empty">No change notes recorded.</div>');
  },
};

boot();
