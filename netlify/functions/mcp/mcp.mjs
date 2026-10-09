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

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id",
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS, ...extra } });

/** Accepts the key as a bearer token or as ?key=, because not every client can set headers. */
function authorised(req) {
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : new URL(req.url).searchParams.get("key");
  if (!given) return false;
  const expected = process.env.MCP_KEY ? sha256(process.env.MCP_KEY) : KEY_SHA256;
  return timingSafeEqual(Buffer.from(sha256(given)), Buffer.from(expected));
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!authorised(req)) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Missing or wrong key. Use ?key= or a Bearer token." } }, 401);
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST", ...CORS } });

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  // Batches were dropped from the spec in 2025-06-18 but older clients may send them.
  if (Array.isArray(body)) {
    const out = body.map((m) => handleMessage(m)).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const res = handleMessage(body);
  return res ? json(res) : new Response(null, { status: 202, headers: CORS });
};
