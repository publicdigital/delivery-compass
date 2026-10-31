/**
 * The MCP endpoint over HTTP: Streamable HTTP transport, stateless, JSON responses.
 *
 * Reached at /mcp through a rewrite in netlify.toml (registered there, not by an
 * inline `export const config`, for the same reason as the Basic Auth edge function).
 * The edge function lets /mcp through, because assistants cannot answer a browser
 * password prompt, so this function checks a key of its own instead.
 *
 * Stateless by design: nothing is kept between requests, which is what the hosting
 * allows. A session id is issued on initialize all the same, and clients send it back on
 * every later request; it is random, never stored, never checked, and exists only so
 * the log can group one connection's requests (the trial's adoption number is how
 * many connections go on to call a tool). GET (a server-to-client event stream) is not
 * offered; the spec allows a 405 for that, and for DELETE.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { handleMessage } from "./core.mjs";
import { redact } from "./redact.mjs";
import { blobsContext, eventKey, put } from "./searchlog.mjs";

// Keys, each mapped to a label naming the group of people who hold it. MCP_KEYS in the
// Netlify environment is the source of truth: a JSON object of key to label, such as
// {"<key>":"trial","<key>":"oli-test"}. The label is what the request log records, so
// each group can be given its own key and told apart. The label "trial" is special:
// those keys stop answering tool calls at TRIAL_ENDS.
//
// Without MCP_KEYS, the two keys below still work, so nothing breaks before it is set.
// The testers' key is held only as its SHA-256, so the repo never holds a usable
// credential; MCP_KEY in the environment (or the tests) replaces it outright.
const KEY_SHA256 = "74f1c86242bfe56662c6d2e1eea814777b0d1b7887864d1b62832b9d2b61bc10";

// The public trial, 3 November to 3 December 2026. Its key is printed on /trial, so it is not a
// secret: what makes publishing it safe is that it stops answering at TRIAL_ENDS.
// TRIAL_KEY and TRIAL_ENDS in the Netlify environment override both, so the trial can
// be extended or ended from the dashboard without a push.
const TRIAL_KEY = process.env.TRIAL_KEY || "gdl-trial-2026";
const TRIAL_ENDS = Date.parse(process.env.TRIAL_ENDS || "2026-12-04T00:00:00Z"); // the end of 3 December, UK time

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// Only hashes are kept in memory, so every comparison is between strings of one length.
function loadKeys() {
  if (process.env.MCP_KEYS) {
    try {
      const keys = Object.entries(JSON.parse(process.env.MCP_KEYS)).map(([key, label]) => ({ hash: sha256(key), label: String(label) }));
      if (keys.length) return keys;
    } catch {}
    // Never echo the variable: it holds the keys.
    console.error("MCP_KEYS is not a JSON object of key to label; using the built-in keys instead.");
  }
  return [
    { hash: process.env.MCP_KEY ? sha256(process.env.MCP_KEY) : KEY_SHA256, label: "tester" },
    { hash: sha256(TRIAL_KEY), label: "trial" },
  ];
}
const KEYS = loadKeys();

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id",
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS, ...extra } });

/**
 * Accepts the key as a bearer token or as ?key=, because not every client can set headers
 * (Claude's custom connectors cannot). The header wins if both are sent. Returns how the
 * key arrived and, if it matched, the label of the group that holds it.
 */
function access(req) {
  const bearer = /^Bearer (.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  const given = bearer ?? new URL(req.url).searchParams.get("key");
  const via = bearer ? "header" : given ? "query" : "none";
  if (!given) return { via, label: null };
  const hashed = Buffer.from(sha256(given));
  let label = null;
  // Check every key, not just up to the first match, so the time taken says nothing.
  for (const k of KEYS) if (timingSafeEqual(hashed, Buffer.from(k.hash)) && label === null) label = k.label;
  return { via, label };
}

// One message for a missing key and a wrong one, so the response says nothing about which.
// No WWW-Authenticate header: some clients take it as a cue to start an OAuth flow.
const UNAUTHORIZED = {
  jsonrpc: "2.0",
  id: null,
  error: {
    code: -32001,
    message: "Unauthorized. Send your access key as an 'Authorization: Bearer <key>' header, or add '?key=<key>' to the connector URL. Ask the service owner for a key.",
  },
};

// For a person who opens the URL in a browser. MCP clients probe GET too, but they ask
// for an event stream, and they still get the 405 the spec expects.
const HELP = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gov Delivery Library: MCP server</title></head>
<body>
<h1>Gov Delivery Library: MCP server</h1>
<p>This address is an MCP server, for AI assistants rather than browsers. It serves UK government delivery guidance from GOV.UK and the Government Project Delivery website. It is unofficial.</p>
<h2>Connect it</h2>
<ol>
<li>In your assistant, add a custom connector (in Claude: Settings, Connectors, Add custom connector).</li>
<li>Use this address with your access key on the end: <code>/mcp?key=&lt;key&gt;</code>. If your client can set headers, send <code>Authorization: Bearer &lt;key&gt;</code> instead.</li>
</ol>
<p>Ask the service owner for a key. During the public trial, to 3 December 2026, the setup steps and a key are on <a href="/trial/">the trial page</a>.</p>
</body></html>
`;

const wantsHelpPage = (req) => {
  const accept = req.headers.get("accept") ?? "";
  return req.method === "GET" && accept.includes("text/html") && !accept.includes("text/event-stream");
};

const TRIAL_OVER =
  "The public trial of the Gov Delivery Library ended on 3 December 2026, so this connector no longer answers questions. " +
  "Thank you for trying it. You can remove the connector in your assistant's settings.";

/**
 * Once the trial ends, trial-key tool calls get a readable result saying so, rather than
 * an auth error the assistant would report as a fault. Everything else still answers,
 * so the client stays connected long enough to show the message.
 */
function trialOver(msg) {
  if (msg?.method !== "tools/call" || msg.id === undefined || msg.id === null) return null;
  return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: TRIAL_OVER }], isError: true } };
}

// Tool arguments that are never free text, so they can be logged as they are. Anything
// else an assistant sends (a future argument, an extra field) is left out.
const SAFE_ARGS = ["source_id", "limit", "days"];

/**
 * What the log keeps about one message: method and tool for all of them, and for a tool
 * call the redacted search, the safe arguments, and what came back (how many results,
 * the top three sources, whether it was a gap). Search results are read back from the
 * result text, whose "Source: ... (`id`)" lines test/searchlog.test.ts pins down.
 */
function describe(msg, response) {
  const d = { method: msg?.method ?? null, tool: msg?.method === "tools/call" ? msg.params?.name ?? null : null };
  if (d.method !== "tools/call") return d;
  const args = msg.params?.arguments ?? {};
  if (d.tool === "search_guidance") d.query = redact(args.question);
  d.args = {};
  for (const k of SAFE_ARGS) {
    if (args[k] !== undefined) d.args[k] = typeof args[k] === "number" ? args[k] : redact(args[k]).slice(0, 60);
  }
  const result = response?.result;
  if (result?.isError || response?.error) d.error = true;
  else if (d.tool === "search_guidance") {
    const sources = [...(result?.content?.[0]?.text ?? "").matchAll(/^Source: .*?\(`([^`]+)`\)/gm)].map((m) => m[1]);
    d.results = sources.length;
    d.top = [...new Set(sources)].slice(0, 3);
    d.empty = sources.length === 0;
  }
  return d;
}

async function handle(req, who, meta) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (wantsHelpPage(req)) return new Response(HELP, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...CORS } });
  if (!who.label) return json(UNAUTHORIZED, 401);
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST", ...CORS } });

  let body;
  try {
    body = await req.json();
  } catch {
    meta.calls = [];
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  // Batches were dropped from the spec in 2025-06-18 but older clients may send them.
  const messages = Array.isArray(body) ? body : [body];
  const ended = who.label === "trial" && Date.now() >= TRIAL_ENDS;
  meta.calls = [];
  const out = messages.map((m) => {
    const res = (ended && trialOver(m)) || handleMessage(m);
    meta.calls.push(describe(m, res));
    return res;
  });
  meta.client = messages.find((m) => m?.method === "initialize")?.params?.clientInfo ?? null;
  const headers = {};
  if (meta.client && !req.headers.get("mcp-session-id")) headers["mcp-session-id"] = meta.issued = randomUUID().replace(/-/g, "");

  const answers = out.filter(Boolean);
  if (!answers.length) return new Response(null, { status: 202, headers: { ...CORS, ...headers } });
  return json(Array.isArray(body) ? answers : answers[0], 200, headers);
}

/** Testers' own key, and scripts rather than assistants, are left out of the trial's numbers. */
const isInternal = (who, ua) => who.label === "tester" || /^(node|curl|undici)\b/i.test(ua);

/**
 * One line per request, because Netlify's own request log cannot see past the URL to
 * which tool was called, and the URL is the one thing it must not record here (it can
 * hold the key). So: methods and tool names, the redacted search and what it found, the
 * key's label, how it arrived, the session, and the client's name. Never the key, the
 * URL, the Authorization header, an IP address, or any search before redaction.
 */
async function logRequest(copy, req, who, meta, res, started) {
  const ms = Date.now() - started;
  let calls = meta.calls;
  if (!calls) {
    // Not handled as JSON-RPC (a refused key, a GET): name the methods, nothing more.
    let messages = [];
    try {
      const body = await copy.json();
      messages = Array.isArray(body) ? body : [body];
    } catch {}
    calls = messages.map((m) => ({ method: m?.method ?? null, tool: m?.method === "tools/call" ? m.params?.name ?? null : null }));
  }
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 80);
  const at = new Date(started).toISOString();
  const session = String(req.headers.get("mcp-session-id") ?? meta.issued ??
    // A client that never sends the id back: the nearest thing to a session that
    // identifies nobody, the key's group and client within the hour.
    `h-${sha256(`${who.label}|${ua}|${at.slice(0, 13)}`).slice(0, 12)}`).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
  const internal = isInternal(who, ua);
  const line = {
    event: "mcp",
    calls,
    key: who.label,
    auth: who.via,
    status: res.status,
    ms,
    ua,
    client: meta.client ? { name: meta.client.name ?? null, version: meta.client.version ?? null } : null,
    session,
    internal,
  };
  console.log(JSON.stringify(line));

  // Kept past Netlify's 7 days: connections, and tool calls with what they found.
  const ctx = who.label && blobsContext();
  if (!ctx) return null;
  const writes = [];
  if (meta.client) writes.push(put(ctx, eventKey({ at, internal, session, kind: "init" }), { at, key: who.label, client: line.client }));
  for (const call of calls.filter((c) => c.method === "tools/call")) {
    writes.push(put(ctx, eventKey({ at, internal, session, kind: "call" }), { at, key: who.label, ...call }));
  }
  return Promise.all(writes);
}

export default async (req, context) => {
  const started = Date.now();
  const copy = req.clone();
  const who = access(req);
  const meta = {};
  const res = await handle(req, who, meta);
  try {
    // The answer does not wait for the store: waitUntil lets the write finish after the
    // response has gone, and a failed write is dropped, never the request.
    const stored = (await logRequest(copy, req, who, meta, res, started))?.catch(() => {});
    if (stored) context?.waitUntil ? context.waitUntil(stored) : await stored;
  } catch {}
  return res;
};
