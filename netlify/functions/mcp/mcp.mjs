/**
 * The MCP endpoint over HTTP: Streamable HTTP transport, stateless, JSON responses.
 *
 * Reached at /mcp through a rewrite in netlify.toml (registered there, not by an
 * inline `export const config`, for the same reason as the Basic Auth edge function).
 * The edge function lets /mcp through, because assistants cannot answer a browser
 * password prompt, so this function checks a key of its own instead.
 *
 * Stateless by design: no session id is issued and nothing is kept between
 * requests, which is what the hosting allows. GET (a server-to-client event stream)
 * is not offered; the spec allows a 405 for that.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { handleMessage } from "./core.mjs";

// The shared access key for invited testers. Only its SHA-256 lives here, so the
// repo never holds a usable credential; the key itself is in the gitignored .env of
// whoever set it up. To rotate: generate a new key, put its hash here, push.
// MCP_KEY in the environment (Netlify, or the tests) replaces it outright.
const KEY_SHA256 = "74f1c86242bfe56662c6d2e1eea814777b0d1b7887864d1b62832b9d2b61bc10";

// The public trial, 3 November to 3 December 2026. Its key is printed on /trial, so it is not a
// secret: what makes publishing it safe is that it stops answering at TRIAL_ENDS.
// TRIAL_KEY and TRIAL_ENDS in the Netlify environment override both, so the trial can
// be extended or ended from the dashboard without a push.
const TRIAL_KEY = process.env.TRIAL_KEY || "gdl-trial-2026";
const TRIAL_ENDS = Date.parse(process.env.TRIAL_ENDS || "2026-12-04T00:00:00Z"); // the end of 3 December, UK time

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id",
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS, ...extra } });

/**
 * Accepts the key as a bearer token or as ?key=, because not every client can set headers.
 * Returns who is asking, "tester" or "trial", or null for a missing or wrong key.
 */
function access(req) {
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : new URL(req.url).searchParams.get("key");
  if (!given) return null;
  const hashed = Buffer.from(sha256(given));
  const expected = process.env.MCP_KEY ? sha256(process.env.MCP_KEY) : KEY_SHA256;
  if (timingSafeEqual(hashed, Buffer.from(expected))) return "tester";
  if (timingSafeEqual(hashed, Buffer.from(sha256(TRIAL_KEY)))) return "trial";
  return null;
}

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

/**
 * One log line per tool call: the search text and arguments only, never anything else
 * from the conversation. Netlify keeps function logs briefly, so this is a short window
 * onto what people ask, not a dataset. /trial tells people it happens.
 */
function logCall(msg, who) {
  if (msg?.method !== "tools/call") return;
  console.log(JSON.stringify({ at: new Date().toISOString(), access: who, tool: msg.params?.name, args: msg.params?.arguments ?? {} }));
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const who = access(req);
  if (!who) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Missing or wrong key. Add ?key=YOUR_KEY to the end of the connector URL, or send it as a Bearer token." } }, 401);
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST", ...CORS } });

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  // Batches were dropped from the spec in 2025-06-18 but older clients may send them.
  const ended = who === "trial" && Date.now() >= TRIAL_ENDS;
  const answer = (m) => {
    logCall(m, who);
    return (ended && trialOver(m)) || handleMessage(m);
  };

  if (Array.isArray(body)) {
    const out = body.map(answer).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const res = answer(body);
  return res ? json(res) : new Response(null, { status: 202, headers: CORS });
};
