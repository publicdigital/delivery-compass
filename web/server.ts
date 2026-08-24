import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { openDb } from "../pipeline/db.ts";
import { findAllConflictEvidence, type ConflictEvidence } from "../pipeline/conflicts.ts";
import { buildGraph, caveatsFor, loadRelations, type Relation } from "../pipeline/graph.ts";
import { loadRegistry } from "../pipeline/registry.ts";
import { citationUrl, obligationsForSections, searchSections } from "../pipeline/search.ts";
import { recentPublishedChanges } from "../pipeline/watch.ts";
import { checkCorpus } from "../pipeline/verify.ts";
import { feedbackSummary, listFeedback, openFeedbackDb, queryReport, recordFeedback, recordQuery, toCsv } from "../pipeline/feedback.ts";

const PORT = Number(process.env.PORT ?? 3000);
/** 0.0.0.0 by default: a container that binds only to loopback is unreachable from
 *  the platform's proxy, which presents as a deploy that "works locally". */
const HOST = process.env.HOST ?? "0.0.0.0";

/** Shared passcode. Unset means the instance is open to anyone with the URL. */
const ACCESS_CODE = process.env.ACCESS_CODE?.trim() || null;
/** Guards the feedback export. Unset means no /admin at all, rather than an open one. */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN?.trim() || null;
/** Signs the access cookie. Derived from the passcode if unset, so sessions survive a
 *  restart; set it explicitly to survive a passcode rotation instead. */
const SESSION_SECRET = process.env.SESSION_SECRET?.trim()
  || (ACCESS_CODE ? createHmac("sha256", "delivery-compass").update(ACCESS_CODE).digest("hex") : randomBytes(32).toString("hex"));
const SESSION_DAYS = 30;
const COOKIE = "dc_access";

/** Generous enough that the ~90th-percentile section (1.8KB) is never cut; guards only against the rare multi-thousand-word outlier. */
const SECTION_TEXT_CAP = 3000;
const INDEX_HTML = readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");

const db = openDb();
const registry = loadRegistry();
const relations = loadRelations();
const byId = new Map(registry.map((s) => [s.id, s]));
openFeedbackDb(); // fail at boot, not on the first person who tries to leave feedback

// Confirmed conflicts, keyed by the superseded/losing side's source id - a human has
// judged these (relations.yaml), so an obligation from that source is flagged
// wherever it appears, not only when both sides happen to be cited together.
const confirmedBySource = new Map<string, Relation[]>();
for (const r of relations) {
  if (r.type !== "supersedes" && r.type !== "conflicts") continue;
  confirmedBySource.set(r.to, [...(confirmedBySource.get(r.to) ?? []), r]);
}

// Unconfirmed candidates from the sweep (pipeline/conflicts.ts), keyed per obligation
// (source + exact sentence) rather than per source-pair, so a specific quote in the
// Ask panel can be marked "possible conflict" - the "underline poor grammar" surface
// this exists for. Computed once at startup; the sweep is a full-corpus scan and this
// is a UI page load, not the place to repeat it per request.
const candidatesByObligation = new Map<string, ConflictEvidence[]>();
function obligationKey(sourceId: string, sentence: string): string {
  return `${sourceId}::${sentence}`;
}
for (const e of findAllConflictEvidence(db)) {
  const keyA = obligationKey(e.a.sourceId, e.a.sentence);
  const keyB = obligationKey(e.b.sourceId, e.b.sentence);
  candidatesByObligation.set(keyA, [...(candidatesByObligation.get(keyA) ?? []), e]);
  candidatesByObligation.set(keyB, [...(candidatesByObligation.get(keyB) ?? []), e]);
}

// --- transport helpers ------------------------------------------------------

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function baseHeaders(nonce?: string): Record<string, string> {
  const h: Record<string, string> = {
    // Unofficial tool quoting government guidance: it should not turn up in search
    // results looking like an authority. Belt (header) and braces (robots.txt).
    "x-robots-tag": "noindex, nofollow",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
  };
  if (nonce) {
    // The UI is one file with inline <style> and one inline module, so a nonce is the
    // way to keep a real CSP rather than falling back to 'unsafe-inline'.
    h["content-security-policy"] = [
      "default-src 'self'",
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
      "img-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ].join("; ");
  }
  return h;
}

function send(res: ServerResponse, req: IncomingMessage, status: number, type: string, body: string, extra: Record<string, string> = {}): void {
  const headers: Record<string, string> = { "content-type": type, ...extra };
  let payload: Buffer | string = body;
  if (/\bgzip\b/.test(req.headers["accept-encoding"] as string ?? "") && Buffer.byteLength(body) > 1024) {
    payload = gzipSync(body);
    headers["content-encoding"] = "gzip";
    headers["vary"] = "accept-encoding";
  }
  headers["content-length"] = String(Buffer.byteLength(payload));
  res.writeHead(status, headers);
  res.end(payload);
}

function json(res: ServerResponse, req: IncomingMessage, data: unknown, status = 200): void {
  send(res, req, status, "application/json; charset=utf-8", JSON.stringify(data), { ...baseHeaders(), "cache-control": "no-store" });
}

/** First hop of X-Forwarded-For, used only for in-memory rate limiting. Never stored. */
function clientKey(req: IncomingMessage): string {
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return fwd || req.socket.remoteAddress || "unknown";
}

const MAX_BODY = 16 * 1024;
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// --- rate limiting ----------------------------------------------------------
// A fixed-window counter per client per bucket. Crude on purpose: this is one process
// with a read-mostly corpus, and the point is to stop a script hammering the passcode
// or filling the feedback table, not to police legitimate use.
const windows = new Map<string, { count: number; resetAt: number }>();
function overLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now > w.resetAt) { windows.set(key, { count: 1, resetAt: now + windowMs }); return false; }
  w.count++;
  return w.count > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, w] of windows) if (now > w.resetAt) windows.delete(k);
}, 60_000).unref();

// --- access gate ------------------------------------------------------------

function sign(expiresAt: number): string {
  return createHmac("sha256", SESSION_SECRET).update(String(expiresAt)).digest("base64url");
}

function cookieValid(req: IncomingMessage): boolean {
  const raw = (req.headers.cookie ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return false;
  const [expiry, mac] = decodeURIComponent(raw.slice(COOKIE.length + 1)).split(".");
  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !mac) return false;
  const expected = Buffer.from(sign(expiresAt));
  const got = Buffer.from(mac);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

function codeMatches(supplied: string): boolean {
  if (!ACCESS_CODE) return true;
  // Compare digests so the comparison is constant-time regardless of length.
  const a = createHmac("sha256", SESSION_SECRET).update(supplied).digest();
  const b = createHmac("sha256", SESSION_SECRET).update(ACCESS_CODE).digest();
  return timingSafeEqual(a, b);
}

function isSecure(req: IncomingMessage): boolean {
  return (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() === "https";
}

function gatePage(nonce: string, error?: string): string {
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Delivery Compass</title>
<style nonce="${nonce}">
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#14171a;background:#fff;line-height:1.45}
  .wrap{max-width:34rem;margin:0 auto;padding:48px 20px}
  h1{font-size:1.6rem;margin:0 0 6px}
  p{color:#5c666d;max-width:60ch}
  label{display:block;font-weight:700;margin:24px 0 6px;color:#14171a}
  input{width:100%;padding:10px;font-size:1.05rem;border:2px solid #14171a;font-family:inherit}
  input:focus{outline:3px solid #ffd23f}
  button{margin-top:16px;background:#1e6b3a;color:#fff;border:0;padding:10px 20px;font-size:1.05rem;cursor:pointer;font-family:inherit}
  .err{background:#fef7f7;border-left:5px solid #a8271b;padding:12px 16px;color:#a8271b;font-weight:700}
  .note{margin-top:36px;padding-top:16px;border-top:1px solid #c3c8cb;font-size:.85rem}
</style></head>
<body><div class="wrap">
  <h1>Delivery Compass</h1>
  <p>An unofficial navigator for UK government delivery guidance. This is a working prototype shared for feedback, so it is behind a passcode.</p>
  ${error ? `<p class="err">${esc(error)}</p>` : ""}
  <form method="post" action="/enter">
    <label for="code">Passcode</label>
    <input id="code" name="code" type="password" autocomplete="current-password" autofocus required>
    <button type="submit">Continue</button>
  </form>
  <p class="note"><strong>Unofficial.</strong> Not affiliated with, endorsed by, or published by GOV.UK or any government department. If you were not given a passcode, you were not meant to have one &mdash; nothing here is confidential, but it is unfinished.</p>
</div></body></html>`;
}

// --- answers ----------------------------------------------------------------

// Paragraph breaks in the source text are meaningful - collapsing them to one line
// is what forced the old 400-char excerpt to read as a fragment rather than a
// narrative. Keep them, just tidy the whitespace within each line.
function formatSectionText(raw: string): { text: string; truncated: boolean } {
  const paragraphs = raw.split(/\n+/).map((p) => p.trim().replace(/\s+/g, " ")).filter(Boolean);
  const full = paragraphs.join("\n");
  const truncated = full.length > SECTION_TEXT_CAP;
  return { text: truncated ? full.slice(0, SECTION_TEXT_CAP) : full, truncated };
}

function ask(question: string) {
  const hits = searchSections(db, question, 6);
  if (hits.length === 0) {
    return { question, found: false, caveats: [], obligations: [], sections: [] };
  }
  const obligations = obligationsForSections(db, hits.map((h) => h.sectionId));
  const caveats = caveatsFor([...new Set(hits.map((h) => h.sourceId))], relations).map((c) => ({
    ...c,
    supersededTitle: byId.get(c.supersededSourceId)?.title ?? c.supersededSourceId,
    byTitle: byId.get(c.bySourceId)?.title ?? c.bySourceId,
  }));

  return {
    question,
    found: true,
    caveats,
    obligations: obligations
      .filter((o) => o.strength === "mandatory" || o.strength === "recommended")
      .slice(0, 10)
      .map((o) => {
        // The obligation itself stays an isolated, verbatim-quoted sentence - that's
        // the "never paraphrase a mandatory requirement" rule. But shown with nothing
        // around it, a reader can't tell what it's actually about; context is the
        // rest of the section it came from.
        const { sectionText, ...rest } = o;
        const { text: context, truncated: contextTruncated } = formatSectionText(sectionText);

        // Confirmed: this obligation's own source is the losing side of a curated
        // supersedes/conflicts edge, regardless of what else the answer cites.
        const confirmed = confirmedBySource.get(o.sourceId)?.map((r) => ({
          type: r.type,
          byTitle: byId.get(r.from)?.title ?? r.from,
          scope: r.scope,
          effective: r.effective,
          guidance: r.guidance,
        })) ?? [];

        // Candidate: unverified overlap from the automatic sweep, strongest first,
        // capped so one heavily-bucketed obligation doesn't dominate the card.
        const candidates = (candidatesByObligation.get(obligationKey(o.sourceId, o.sentence)) ?? [])
          .map((e) => {
            const other = e.a.sourceId === o.sourceId ? e.b : e.a;
            return { sourceTitle: other.sourceTitle, sentence: other.sentence, url: other.url, ageGapDays: Math.round(e.ageGapDays), sharedWords: e.sharedWords };
          })
          .sort((a, b) => b.ageGapDays * b.sharedWords.length - a.ageGapDays * a.sharedWords.length)
          .slice(0, 2);

        return { ...rest, url: citationUrl(o), updatedAt: o.publicUpdatedAt, context, contextTruncated, confirmedConflicts: confirmed, candidateConflicts: candidates };
      }),
    sections: hits.map((h) => {
      const { text, truncated } = formatSectionText(h.text);
      return {
        heading: h.heading,
        headingPath: h.headingPath,
        sourceTitle: h.sourceTitle,
        body: h.body,
        spine: h.spine,
        authority: h.authority,
        text,
        truncated,
        url: citationUrl(h),
        updatedAt: h.publicUpdatedAt,
        indexedAt: h.indexedAt,
        staleIndex: Boolean(h.publicUpdatedAt && h.indexedAt && h.publicUpdatedAt > h.indexedAt),
      };
    }),
  };
}

// --- admin ------------------------------------------------------------------

function adminAuthorised(url: URL, req: IncomingMessage): boolean {
  if (!ADMIN_TOKEN) return false;
  const supplied = url.searchParams.get("token") ?? (req.headers.authorization as string | undefined)?.replace(/^Bearer\s+/i, "") ?? "";
  const a = createHmac("sha256", SESSION_SECRET).update(supplied).digest();
  const b = createHmac("sha256", SESSION_SECRET).update(ADMIN_TOKEN).digest();
  return timingSafeEqual(a, b);
}

function adminPage(nonce: string, token: string): string {
  const s = feedbackSummary();
  const rows = listFeedback(200);
  const gaps = queryReport(400).filter((q) => q.hits === 0).slice(0, 40);
  const served = queryReport(400).filter((q) => q.hits > 0).slice(0, 40);
  const q = encodeURIComponent(token);
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Delivery Compass &mdash; feedback</title>
<style nonce="${nonce}">
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#14171a;line-height:1.45}
  .wrap{max-width:1100px;margin:0 auto;padding:28px 20px 60px}
  h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:32px 0 8px}
  .stats{display:flex;gap:26px;flex-wrap:wrap;background:#f2f3f4;padding:14px 18px;margin:18px 0}
  .stats div span{display:block;font-size:1.5rem;font-weight:700}
  .stats div small{color:#5c666d;font-size:.8rem}
  table{border-collapse:collapse;width:100%;font-size:.9rem}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #c3c8cb;vertical-align:top}
  th{background:#f2f3f4}
  .meta{color:#5c666d;font-size:.85rem}
  a{color:#2b5f8f}
</style></head>
<body><div class="wrap">
  <h1>Feedback</h1>
  <p class="meta">Private. Reachable only with the admin token &mdash; keep the URL out of anything shared.</p>
  <div class="stats">
    <div><span>${s.feedback}</span><small>submissions</small></div>
    <div><span>${s.useful}/${s.partly}/${s.notUseful}</span><small>yes / partly / no</small></div>
    <div><span>${s.queries}</span><small>questions asked</small></div>
    <div><span>${s.emptyQueries}</span><small>returned nothing</small></div>
    <div><span>${s.people}</span><small>browser sessions</small></div>
    <div><span>${s.since ? esc(s.since.slice(0, 10)) : "&mdash;"}</span><small>first submission</small></div>
  </div>
  <p><a href="/admin/feedback.csv?token=${q}">Download feedback CSV</a> &middot; <a href="/admin/queries.csv?token=${q}">Download questions CSV</a></p>

  <h2>Asked, answered with nothing (${gaps.length})</h2>
  <p class="meta">The registry&rsquo;s to-do list, written by users. Several different browsers asking the same unanswered thing is the strongest signal here.</p>
  <table><thead><tr><th>Browsers</th><th>Times</th><th>Question</th><th>Last asked</th></tr></thead><tbody>
  ${gaps.map((g) => `<tr><td>${g.sessions}</td><td>${g.asks}</td><td>${esc(g.q)}</td><td class="meta">${esc(g.lastAt.slice(0, 16).replace("T", " "))}</td></tr>`).join("") || '<tr><td colspan="4" class="meta">Nothing yet.</td></tr>'}
  </tbody></table>

  <h2>Comments (${rows.filter((r) => r.comment).length})</h2>
  <table><thead><tr><th>When</th><th>Where</th><th>Useful</th><th>Comment</th><th>Role / contact</th></tr></thead><tbody>
  ${rows.map((r) => `<tr>
    <td class="meta">${esc(r.created_at.slice(0, 16).replace("T", " "))}</td>
    <td>${esc(r.surface)}${r.question ? `<br><span class="meta">asked: ${esc(r.question)}</span>` : ""}</td>
    <td>${esc(r.useful ?? "")}</td>
    <td>${esc(r.comment ?? "")}</td>
    <td class="meta">${esc(r.role ?? "")}${r.contact ? `<br>${esc(r.contact)}` : ""}</td>
  </tr>`).join("") || '<tr><td colspan="5" class="meta">Nothing yet.</td></tr>'}
  </tbody></table>

  <h2>Most-asked, answered (${served.length})</h2>
  <table><thead><tr><th>Browsers</th><th>Times</th><th>Question</th></tr></thead><tbody>
  ${served.map((g) => `<tr><td>${g.sessions}</td><td>${g.asks}</td><td>${esc(g.q)}</td></tr>`).join("") || '<tr><td colspan="3" class="meta">Nothing yet.</td></tr>'}
  </tbody></table>
</div></body></html>`;
}

// --- routing ----------------------------------------------------------------

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const nonce = randomBytes(16).toString("base64");

  const log = () => console.log(JSON.stringify({
    evt: "req", method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started,
  }));
  res.on("finish", log);

  try {
    if (url.pathname === "/robots.txt") {
      return send(res, req, 200, "text/plain; charset=utf-8", "User-agent: *\nDisallow: /\n", baseHeaders());
    }

    // Liveness/readiness in one: a process that is up but serving a half-ingested
    // corpus is not healthy, and the platform should be able to see that.
    if (url.pathname === "/healthz") {
      const health = checkCorpus(db);
      return json(res, req, health, health.ok ? 200 : 503);
    }

    // --- admin: token-gated, and never behind the shared passcode (a reviewer with
    // the passcode is not an administrator).
    if (url.pathname.startsWith("/admin")) {
      if (overLimit(`admin:${clientKey(req)}`, 30, 60_000)) return json(res, req, { error: "too many requests" }, 429);
      if (!adminAuthorised(url, req)) {
        return send(res, req, 404, "text/plain; charset=utf-8", "not found\n", baseHeaders());
      }
      const token = url.searchParams.get("token") ?? "";
      if (url.pathname === "/admin/feedback.csv") {
        return send(res, req, 200, "text/csv; charset=utf-8", toCsv(listFeedback(10_000) as unknown as Record<string, unknown>[]),
          { ...baseHeaders(), "content-disposition": 'attachment; filename="delivery-compass-feedback.csv"', "cache-control": "no-store" });
      }
      if (url.pathname === "/admin/queries.csv") {
        return send(res, req, 200, "text/csv; charset=utf-8", toCsv(queryReport(10_000) as unknown as Record<string, unknown>[]),
          { ...baseHeaders(), "content-disposition": 'attachment; filename="delivery-compass-questions.csv"', "cache-control": "no-store" });
      }
      return send(res, req, 200, "text/html; charset=utf-8", adminPage(nonce, token), { ...baseHeaders(nonce), "cache-control": "no-store" });
    }

    // --- the gate
    if (ACCESS_CODE) {
      if (url.pathname === "/enter" && req.method === "POST") {
        // Brute-forcing a shared passcode is the one real attack on this instance.
        if (overLimit(`enter:${clientKey(req)}`, 10, 10 * 60_000)) {
          return send(res, req, 429, "text/html; charset=utf-8", gatePage(nonce, "Too many attempts. Wait ten minutes and try again."), { ...baseHeaders(nonce), "cache-control": "no-store" });
        }
        const supplied = new URLSearchParams(await readBody(req)).get("code") ?? "";
        if (!codeMatches(supplied)) {
          return send(res, req, 401, "text/html; charset=utf-8", gatePage(nonce, "That passcode is not right."), { ...baseHeaders(nonce), "cache-control": "no-store" });
        }
        const expiresAt = Date.now() + SESSION_DAYS * 86_400_000;
        const value = encodeURIComponent(`${expiresAt}.${sign(expiresAt)}`);
        const attrs = [`${COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_DAYS * 86_400}`];
        if (isSecure(req)) attrs.push("Secure");
        res.writeHead(303, { location: "/", "set-cookie": attrs.join("; "), ...baseHeaders() });
        return res.end();
      }
      if (!cookieValid(req)) {
        const status = url.pathname.startsWith("/api/") ? 401 : 200;
        if (url.pathname.startsWith("/api/")) return json(res, req, { error: "not authenticated" }, status);
        return send(res, req, status, "text/html; charset=utf-8", gatePage(nonce), { ...baseHeaders(nonce), "cache-control": "no-store" });
      }
    }

    // --- the app
    if (url.pathname === "/") {
      const html = INDEX_HTML.replaceAll("__NONCE__", nonce);
      return send(res, req, 200, "text/html; charset=utf-8", html, { ...baseHeaders(nonce), "cache-control": "no-store" });
    }

    if (url.pathname.startsWith("/api/") && req.method === "GET" && overLimit(`api:${clientKey(req)}`, 240, 60_000)) {
      return json(res, req, { error: "too many requests" }, 429);
    }

    if (url.pathname === "/api/ask") {
      const q = url.searchParams.get("q")?.trim() ?? "";
      if (!q) return json(res, req, { error: "missing q" }, 400);
      const answer = ask(q);
      // Recorded so the questions people ask - especially the ones that come back
      // empty - are visible without anyone having to write feedback. The UI says
      // plainly that this happens.
      recordQuery(q, answer.sections.length, answer.obligations.length, url.searchParams.get("s"));
      return json(res, req, answer);
    }

    if (url.pathname === "/api/feedback" && req.method === "POST") {
      if (overLimit(`fb:${clientKey(req)}`, 20, 10 * 60_000)) return json(res, req, { error: "too many submissions" }, 429);
      let parsed: unknown;
      try { parsed = JSON.parse(await readBody(req)); } catch { return json(res, req, { error: "bad json" }, 400); }
      const result = recordFeedback(parsed as Record<string, unknown>);
      return json(res, req, result, result.ok ? 200 : 400);
    }

    if (url.pathname === "/api/map") {
      const { nodes, edges } = buildGraph();
      const counts = db.prepare(
        `SELECT sec.source_id AS sourceId, COUNT(*) AS sections, src.content_status AS status
         FROM sections sec JOIN sources src ON src.id = sec.source_id
         GROUP BY sec.source_id`,
      ).all() as unknown as { sourceId: string; sections: number; status: string }[];
      const stats = new Map(counts.map((c) => [c.sourceId, c]));
      return json(res, req, {
        nodes: nodes.map((n) => {
          const st = stats.get(n.id);
          return {
            ...n,
            sections: st?.status === "full" ? st.sections : 0,
            contentStatus: st?.status ?? "not_indexed",
          };
        }),
        edges,
      });
    }

    if (url.pathname === "/api/watch") {
      const days = Number(url.searchParams.get("days") ?? 365);
      return json(res, req, recentPublishedChanges(db, Number.isFinite(days) ? days : 365, 60));
    }

    if (url.pathname === "/api/stats") {
      const row = db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM sources WHERE content_status='full') AS sources,
           (SELECT COUNT(*) FROM sections) AS sections,
           (SELECT COUNT(*) FROM obligations) AS obligations,
           (SELECT COUNT(*) FROM obligations WHERE strength='mandatory') AS mandatory,
           (SELECT MAX(indexed_at) FROM sources) AS indexedAt`,
      ).get();
      return json(res, req, { ...row, registered: registry.length, relations: relations.length });
    }

    return send(res, req, 404, "text/plain; charset=utf-8", "not found\n", baseHeaders());
  } catch (e) {
    // The message is fine to return for the small, known set of throws here (bad JSON,
    // oversized body); anything unexpected is logged in full and generalised outward.
    console.error(JSON.stringify({ evt: "error", path: url.pathname, message: (e as Error).message, stack: (e as Error).stack }));
    if (!res.headersSent) json(res, req, { error: "server error" }, 500);
  }
});

server.listen(PORT, HOST, () => {
  const health = checkCorpus(db);
  console.log(`Delivery Compass listening on ${HOST}:${PORT}`);
  console.log(`  corpus: ${health.counts.sources} sources, ${health.counts.sections} sections, indexed ${health.indexedAt?.slice(0, 10) ?? "never"}`);
  if (!health.ok) console.warn(`  WARNING corpus below floor: ${health.failures.join("; ")} - /healthz will report 503`);
  console.log(`  access: ${ACCESS_CODE ? "passcode required" : "OPEN - anyone with the URL can use it"}`);
  console.log(`  admin:  ${ADMIN_TOKEN ? "/admin?token=..." : "disabled (set ADMIN_TOKEN to enable)"}`);
});

// Containers stop by SIGTERM. Without this the platform waits out its kill timeout on
// every deploy, and in-flight requests are cut rather than finished.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, closing`);
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
