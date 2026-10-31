/**
 * The search log: redaction, the per-request log line, what is stored in Netlify Blobs,
 * and the report and purge that read it back.
 *
 * Blobs is faked with a Map behind a stubbed fetch that answers the same URLs the real
 * store does (see netlify/functions/mcp/searchlog.mjs), so the handler and the report
 * run unchanged.
 */
// @ts-expect-error - plain ES module, deliberately untyped: the deploy has no build step
const { redact, MAX_QUERY } = await import("../netlify/functions/mcp/redact.mjs");

const failures: string[] = [];
const check = (ok: unknown, what: string) => { if (!ok) failures.push(what); };

// --- redaction ------------------------------------------------------------------------
const cases: [string, string][] = [
  ["Do I need a business case for a £3m digital project in 2026?", "Do I need a business case for a £3m digital project in 2026?"],
  ["GovS 002 gate review 2 and ISO 27001", "GovS 002 gate review 2 and ISO 27001"],
  ["email jo.bloggs@example.gov.uk about it", "email [redacted] about it"],
  ["call 07700 900123 or +44 20 7946 0018 today", "call [redacted] or [redacted] today"],
  ["NI number QQ 12 34 56 C and AB123456D", "NI number [redacted] and [redacted]"],
  ["our office is SW1A 2AA, theirs M1 1AE", "our office is [redacted], theirs [redacted]"],
  ["case 12345678, card 4111 1111 1111 1111", "case [redacted], card [redacted]"],
  ["see https://x.example/p?token=abc and https://www.gov.uk/guidance/x", "see [redacted] and https://www.gov.uk/guidance/x"],
];
for (const [given, want] of cases) check(redact(given) === want, `redact(${JSON.stringify(given)}) gave ${JSON.stringify(redact(given))}`);
check(redact("x".repeat(500)).length === MAX_QUERY, "a search is cut to the maximum length");
check(redact(undefined) === "", "a missing search redacts to empty");

// --- a fake Blobs store ------------------------------------------------------------------
const store = new Map<string, string>();
const BASE = "https://blobs.test/site-1/site:search-log";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
  const u = new URL(String(input));
  const auth = new Headers(init.headers).get("authorization");
  if (auth !== "Bearer blob-token") return new Response("no", { status: 401 });
  const path = decodeURIComponent(u.pathname);
  const prefix = "/site-1/site:search-log";
  if (!path.startsWith(prefix)) return new Response("wrong store", { status: 404 });
  const key = path.slice(prefix.length + 1);
  const method = init.method ?? "GET";
  if (!key && method === "GET") {
    const p = u.searchParams.get("prefix") ?? "";
    return Response.json({ blobs: [...store.keys()].filter((k) => k.startsWith(p)).map((k) => ({ key: k, etag: "e" })) });
  }
  if (method === "PUT") { store.set(key, String(init.body)); return new Response(null, { status: 200 }); }
  if (method === "DELETE") { store.delete(key); return new Response(null, { status: 204 }); }
  return store.has(key) ? new Response(store.get(key)) : new Response("missing", { status: 404 });
}) as typeof fetch;

process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: "https://blobs.test", siteID: "site-1", token: "blob-token" })).toString("base64");
process.env.MCP_KEYS = JSON.stringify({ "k-trial": "trial", "k-tester": "tester" });
process.env.TRIAL_ENDS = "2999-01-01T00:00:00Z";
// @ts-expect-error - as above
const { default: http } = await import("../netlify/functions/mcp/mcp.mjs?searchlog");

const logged: string[] = [];
const quiet = console.log;
console.log = (...a: unknown[]) => { logged.push(a.join(" ")); };
const lastLog = () => JSON.parse(logged.at(-1) ?? "{}");
const pending: Promise<unknown>[] = [];
const context = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
const send = async (body: unknown, key = "k-trial", headers: Record<string, string> = {}) => {
  const res = await http(new Request(`https://x/mcp?key=${key}`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Claude-User", ...headers }, body: JSON.stringify(body) }), context);
  await Promise.all(pending.splice(0));
  return res;
};

// A connection: initialize issues a session id, and is stored as an "init" event.
const init = await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } } });
const session = init.headers.get("mcp-session-id") ?? "";
check(/^[a-f0-9]{32}$/.test(session), "initialize should issue a session id");
check(lastLog().session === session && lastLog().internal === false, "the log line should carry the issued session, not internal");
check([...store.keys()].some((k) => k.includes(`/real/${session}/init-`)), "a connection should be stored as an init event");

// A search, sent back on that session, with personal details in it.
await send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_guidance", arguments: { question: "spend control process, email jo@example.com", limit: 4, extra: "not logged" } } }, "k-trial", { "mcp-session-id": session });
const call = lastLog().calls?.[0] ?? {};
check(call.query === "spend control process, email [redacted]", `the logged search should be redacted, got ${JSON.stringify(call.query)}`);
check(call.args?.limit === 4 && !("extra" in (call.args ?? {})) && !("question" in (call.args ?? {})), "only the safe arguments should be logged");
check(call.results > 0 && call.results <= 4 && call.empty === false, "the log should count the results");
check(Array.isArray(call.top) && call.top.length >= 1 && call.top.length <= 3 && call.top.every((t: string) => /^[a-z0-9-]+$/.test(t)), "the log should name up to three top sources by id");
check(lastLog().session === session, "a request carrying the session id should log under it");
const stored = [...store.entries()].find(([k]) => k.includes(`/real/${session}/call-`));
check(stored && JSON.parse(stored[1]).query === call.query, "the tool call should be stored with the redacted search");

// A gap.
await send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_guidance", arguments: { question: "zzqxv flibbertigibbet" } } }, "k-trial", { "mcp-session-id": session });
check(lastLog().calls?.[0]?.empty === true && lastLog().calls?.[0]?.results === 0, "a search with no results should be logged as empty");

// Other tools: arguments kept, no results counted.
await send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_source", arguments: { source_id: "tcop" } } }, "k-trial", { "mcp-session-id": session });
check(lastLog().calls?.[0]?.args?.source_id === "tcop" && !("results" in lastLog().calls[0]), "get_source should log its source id");

// The testers' key and scripts are internal.
await send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "coverage", arguments: {} } }, "k-tester");
check(lastLog().internal === true && [...store.keys()].some((k) => k.includes("/internal/")), "the testers' key should be stored as internal");
await send({ jsonrpc: "2.0", id: 6, method: "ping" }, "k-trial", { "user-agent": "curl/8.7.1" });
check(lastLog().internal === true, "curl should count as internal");

// A connection that never sends the id back still gets a stable, anonymous session.
await send({ jsonrpc: "2.0", id: 7, method: "ping" });
const s1 = lastLog().session;
await send({ jsonrpc: "2.0", id: 8, method: "ping" });
check(/^h-[a-f0-9]{12}$/.test(s1) && lastLog().session === s1, "without a session id, requests in the same hour should share a hashed session");

// A refused key: logged, nothing stored, and no detail from the body.
const before = store.size;
await send({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "search_guidance", arguments: { question: "secret words" } } }, "wrong");
check(lastLog().status === 401 && store.size === before, "a refused request should be logged but not stored");
check(!("query" in (lastLog().calls?.[0] ?? {})), "a refused request should not log the search");

// Nothing secret anywhere in the log output.
const all = logged.join("\n");
check(!/k-trial|k-tester|blob-token|jo@example\.com|secret words|not logged/.test(all), "log output must not hold keys, the store token, raw searches or unlisted arguments");

// --- the report and the purge -------------------------------------------------------
// @ts-expect-error - as above
const { default: report } = await import("../netlify/functions/report/report.mjs");
const today = new Date().toISOString().slice(0, 10);
const html = await (await report(new Request(`https://x/report?from=${today}&to=${today}`))).text();
// Only connections (initialize) and tool calls are stored, so the pings above count for
// nothing here, and the testers' call is left out as internal.
check(/<b>1 of 1<\/b> connections went on to use a tool/.test(html), "the report should count real connections that used a tool");
check(/left out: 1 tool calls/.test(html), "the report should say how many internal calls it left out");
check(html.includes("spend control process, email [redacted]"), "the report should list the redacted search");
check(/Gaps: searches that found nothing[\s\S]*zzqxv flibbertigibbet/.test(html), "the report should list searches that found nothing");
check(!/style=|<script/.test(html), "the report must not need inline style or script (the CSP forbids both)");

const refused = await (await report(new Request("https://x/report", { method: "POST", body: new URLSearchParams({ confirm: "yes" }) }))).text();
check(/Nothing deleted/.test(refused) && store.size > 0, "the purge should need the word delete");
const purged = await (await report(new Request("https://x/report", { method: "POST", body: new URLSearchParams({ confirm: "delete" }) }))).text();
check(/stored events were deleted/.test(purged) && store.size === 0, "the purge should delete everything");

console.log = quiet;
globalThis.fetch = realFetch;
if (failures.length) {
  console.error(`Search log: ${failures.length} failure(s)\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Search log: redaction, log line, Blobs storage, report and purge checks passed.");
