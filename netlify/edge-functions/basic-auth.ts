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

export default async (request: Request, context: Netlify.Context) => {
  const expected = "Basic " + btoa("compass:q6IrR1zm1R9mA2cpei0uCH");

  if (request.headers.get("authorization") === expected) {
    return context.next();
  }

  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Prototype"' },
  });
};
