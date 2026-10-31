/**
 * The trial report, at /report: who connected, who went on to search, what they asked,
 * and what the library could not answer. Reads the search log the MCP function writes
 * to Netlify Blobs (netlify/functions/mcp/searchlog.mjs).
 *
 * Behind the site's Basic Auth password like every page except /trial and /mcp, so it
 * needs no key of its own. It also holds the one-button purge the trial page promises:
 * "kept for no longer than the trial".
 *
 * Plain HTML with GOV.UK Frontend's stylesheet from /trial/vendor; no inline style or
 * script, so it is fine under the site's CSP.
 */
import { blobsContext, get, list, purge } from "../mcp/searchlog.mjs";

const TRIAL_START = "2026-10-28";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "") && !Number.isNaN(Date.parse(s));

function days(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`) && out.length < 62; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Key shape: day/(real|internal)/session/(init|call)-time-rand */
function parseKey(key) {
  const [day, group, session, rest] = key.split("/");
  return { key, day, internal: group === "internal", session, kind: rest?.split("-")[0] };
}

async function inBatches(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  return out;
}

const count = (values) => {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
};

const table = (caption, head, rows) => rows.length
  ? `<table class="govuk-table"><caption class="govuk-table__caption govuk-table__caption--m">${esc(caption)}</caption>
<thead class="govuk-table__head"><tr class="govuk-table__row">${head.map((h) => `<th scope="col" class="govuk-table__header">${esc(h)}</th>`).join("")}</tr></thead>
<tbody class="govuk-table__body">${rows.map((r) => `<tr class="govuk-table__row">${r.map((c) => `<td class="govuk-table__cell">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
  : `<h2 class="govuk-heading-m">${esc(caption)}</h2><p class="govuk-body">None in this period.</p>`;

const page = (body) => new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Gov Delivery Library: trial report</title>
<link rel="stylesheet" href="/trial/vendor/govuk-frontend.css"></head>
<body class="govuk-template__body"><div class="govuk-width-container"><main class="govuk-main-wrapper">
${body}
</main></div></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

export default async (req) => {
  const ctx = blobsContext();
  if (!ctx) return page(`<h1 class="govuk-heading-l">Trial report</h1><p class="govuk-body">The search log is not available here. It only exists on the deployed site.</p>`);

  if (req.method === "POST") {
    const form = await req.formData();
    if (form.get("confirm") !== "delete") {
      return page(`<h1 class="govuk-heading-l">Nothing deleted</h1><p class="govuk-body">Type <b>delete</b> in the box to confirm. <a class="govuk-link" href="/report">Back to the report</a>.</p>`);
    }
    const n = await purge(ctx);
    return page(`<h1 class="govuk-heading-l">Search log deleted</h1><p class="govuk-body">${n} stored events were deleted. <a class="govuk-link" href="/report">Back to the report</a>.</p>`);
  }

  const q = new URL(req.url).searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = isDay(q.get("from")) ? q.get("from") : TRIAL_START;
  const to = isDay(q.get("to")) ? q.get("to") : today;
  const range = days(from, to);

  const keys = (await inBatches(range, 10, (d) => list(ctx, `${d}/`))).flat().map(parseKey);
  const real = keys.filter((k) => !k.internal);
  const sessions = new Set(real.map((k) => k.session));
  const searched = new Set(real.filter((k) => k.kind === "call").map((k) => k.session));
  const calls = (await inBatches(real.filter((k) => k.kind === "call"), 25, (k) => get(ctx, k.key))).filter(Boolean);
  const searches = calls.filter((c) => c.tool === "search_guidance" && !c.error);
  const internalCalls = keys.filter((k) => k.internal && k.kind === "call").length;

  const perDay = range.map((d) => [d,
    new Set(real.filter((k) => k.day === d).map((k) => k.session)).size,
    real.filter((k) => k.day === d && k.kind === "call").length,
    searches.filter((c) => c.at.slice(0, 10) === d).length]).filter((r) => r[1] || r[2]);
  const share = sessions.size ? Math.round((searched.size / sessions.size) * 100) : 0;
  const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

  return page(`
<span class="govuk-caption-l">Gov Delivery Library</span>
<h1 class="govuk-heading-l">Trial report</h1>
<form method="get" action="/report" class="govuk-!-margin-bottom-6">
  <label class="govuk-label" for="from">From</label><input class="govuk-input govuk-input--width-10" id="from" name="from" type="date" value="${esc(from)}">
  <label class="govuk-label" for="to">To</label><input class="govuk-input govuk-input--width-10" id="to" name="to" type="date" value="${esc(to)}">
  <button class="govuk-button govuk-button--secondary">Show</button>
</form>

<h2 class="govuk-heading-m">Adoption</h2>
<p class="govuk-body-l"><b>${searched.size} of ${sessions.size}</b> connections went on to use a tool (${share}%).</p>
<p class="govuk-body">A connection is one assistant session: Claude.ai opens one for most new chats, whether or not the chat is about delivery. ${calls.length} tool calls, ${searches.length} of them searches. Your own testing (the tester key, scripts) is left out: ${internalCalls} tool calls.</p>

${table("By day", ["Day", "Connections", "Tool calls", "Searches"], perDay)}
${table("Gaps: searches that found nothing", ["When", "Search"], searches.filter((c) => c.empty).map((c) => [c.at.slice(0, 16).replace("T", " "), c.query]))}
${table("Most common searches", ["Search", "Times"], count(searches.map((c) => norm(c.query))).slice(0, 30))}
${table("Sources most often in the top three", ["Source", "Times"], count(searches.flatMap((c) => c.top ?? [])).slice(0, 20))}
${table("Tools used", ["Tool", "Times"], count(calls.map((c) => c.tool)))}
${table("Every search", ["When", "Search", "Results", "Filters"], searches.map((c) => [c.at.slice(0, 16).replace("T", " "), c.query, c.results, Object.entries(c.args ?? {}).map(([k, v]) => `${k}=${v}`).join(" ")]))}

<h2 class="govuk-heading-m">When the trial ends</h2>
<p class="govuk-body">The trial page promises searches are kept for no longer than the trial. This deletes every stored event, for all dates. It cannot be undone.</p>
<form method="post" action="/report">
  <label class="govuk-label" for="confirm">Type <b>delete</b> to confirm</label>
  <input class="govuk-input govuk-input--width-10" id="confirm" name="confirm" autocomplete="off">
  <button class="govuk-button govuk-button--warning">Delete the search log</button>
</form>
<p class="govuk-body-s">Searches are redacted before they are stored: email addresses, phone numbers, National Insurance numbers, postcodes, long numbers and links with query strings become [redacted].</p>
`);
};
