/**
 * The search log: what people asked during the trial, kept in Netlify Blobs because
 * Netlify keeps function logs for only 7 days and the trial runs for a month.
 *
 * Plain fetch, no packages: the deploy installs nothing, so @netlify/blobs cannot be
 * imported. The requests follow what that library (v11) sends from inside a function:
 * the runtime puts a base64 JSON context (edgeURL, siteID, token) in
 * NETLIFY_BLOBS_CONTEXT, and a site-wide store is addressed as
 * `${edgeURL}/${siteID}/site:${store}/${key}` with the token as a bearer.
 *
 * One blob per event rather than a file per day: blobs cannot be appended to, and two
 * requests rewriting the same daily file at once would lose one of them. Keys carry
 * what the adoption count needs, so it can be worked out from a listing alone:
 *
 *   2026-11-04/real/<session>/init-<time>-<rand>        a client connected
 *   2026-11-04/internal/<session>/call-<time>-<rand>    a tool call (body: the event)
 *
 * The trial page promises searches are kept no longer than the trial: purge() deletes
 * the lot, and the report page has the button.
 */
const STORE = "search-log";

export function blobsContext() {
  const raw = globalThis.netlifyBlobsContext ?? process.env.NETLIFY_BLOBS_CONTEXT;
  if (!raw) return null; // locally and in tests: nothing is stored
  try {
    const ctx = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    return ctx.edgeURL && ctx.siteID && ctx.token ? ctx : null;
  } catch {
    return null;
  }
}

const url = (ctx, path = "", params = {}) => {
  const u = new URL(`/${ctx.siteID}/site:${STORE}${path ? `/${path}` : ""}`, ctx.edgeURL);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u;
};
const auth = (ctx) => ({ authorization: `Bearer ${ctx.token}` });

/** Key for one event. Only characters the store accepts without encoding. */
export function eventKey({ at, internal, session, kind }) {
  const day = at.slice(0, 10);
  const safe = String(session).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40) || "none";
  const rand = Math.random().toString(36).slice(2, 8);
  return `${day}/${internal ? "internal" : "real"}/${safe}/${kind}-${Date.parse(at)}-${rand}`;
}

export async function put(ctx, key, value, fetcher = fetch) {
  const res = await fetcher(url(ctx, key), {
    method: "PUT",
    headers: { ...auth(ctx), "cache-control": "max-age=0, stale-while-revalidate=60" },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`search log write failed: ${res.status}`);
}

export async function get(ctx, key, fetcher = fetch) {
  const res = await fetcher(url(ctx, key), { headers: auth(ctx) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`search log read failed: ${res.status}`);
  return res.json();
}

/** Every key under a prefix, following the store's cursor. */
export async function list(ctx, prefix, fetcher = fetch) {
  const keys = [];
  let cursor;
  do {
    const res = await fetcher(url(ctx, "", { prefix, cursor }), { headers: auth(ctx) });
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`search log list failed: ${res.status}`);
    const page = await res.json();
    for (const b of page.blobs ?? []) if (b.key) keys.push(b.key);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return keys;
}

/** Deletes every event. Returns how many went. */
export async function purge(ctx, fetcher = fetch) {
  const keys = await list(ctx, undefined, fetcher);
  for (let i = 0; i < keys.length; i += 20) {
    await Promise.all(keys.slice(i, i + 20).map(async (key) => {
      const res = await fetcher(url(ctx, key), { method: "DELETE", headers: auth(ctx) });
      if (![200, 204, 404].includes(res.status)) throw new Error(`search log delete failed: ${res.status}`);
    }));
  }
  return keys.length;
}
