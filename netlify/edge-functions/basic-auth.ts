// Enforces HTTP Basic-Auth on every request to this prototype.
//
// Netlify's declarative `_headers` file `Basic-Auth` directive
// (https://docs.netlify.com/manage/domains-https/basic-auth/) is the
// simpler way to do this, but it silently no-ops on Free-plan Netlify
// accounts created in 2026 or later — confirmed against a live prototype,
// not just read in the docs. This Edge Function is the Free-tier
// equivalent: Edge Functions run on every Netlify plan.
//
// compass and q6IrR1zm1R9mA2cpei0uCH are replaced by the `new-prototype` skill
// with a freshly generated, unique-per-prototype random username and
// password at scaffolding time. Do not commit real placeholder text here —
// if you ever see the literal tokens below in a deployed repo, generation
// was skipped and this prototype has NO effective password (verify before
// sharing the URL).
//
// Registered via the `[[edge_functions]]` block in netlify.toml, not the
// inline `export const config` convention — a bare `netlify deploy` (no
// connected Netlify Build) was confirmed to silently upload this file as a
// plain static asset instead of bundling it as an Edge Function when it
// relied on inline config alone with no netlify.toml present at all.

// /mcp is the one exception. MCP clients (Claude, Copilot, ChatGPT) cannot answer a
// Basic Auth challenge, so the MCP function checks a key of its own instead
// (netlify/functions/mcp/mcp.mjs). Matched exactly, so nothing else slips through.
const OWN_AUTH = new Set(["/mcp", "/.netlify/functions/mcp"]);

// /trial/ is the public page for the trial of 3 November to 3 December 2026: how to
// connect, plus the corpus visual. Everything it loads lives under /trial/ too, so
// opening this one prefix exposes nothing else. robots.txt is public too, so crawlers
// fetching a link preview read its "Allow: /trial/" rather than a 401. Remove the
// /trial part when the trial ends.
//
// /.well-known/ is public so it can say "nothing here". Before connecting, Claude's
// custom-connector dialog asks /.well-known/oauth-protected-resource and friends whether
// the server needs OAuth. A 401 from this password reads as "yes", and Claude then fails
// with "Couldn't register with ... sign-in service". A plain 404 (there are no such
// files) tells it there is no OAuth, so it connects with the ?key= in the URL.
const isPublic = (path: string) =>
  path === "/robots.txt" || path.startsWith("/.well-known/") || path === "/trial" || path.startsWith("/trial/");

export default async (request: Request, context: Netlify.Context) => {
  const path = new URL(request.url).pathname;
  if (OWN_AUTH.has(path) || isPublic(path)) return context.next();

  const expected = "Basic " + btoa("compass:q6IrR1zm1R9mA2cpei0uCH");

  if (request.headers.get("authorization") === expected) {
    return context.next();
  }

  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Prototype"' },
  });
};
