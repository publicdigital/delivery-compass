# Deploying Delivery Compass

One hosted instance, behind a password, for a handful of invited delivery people to
use and leave feedback on. It is a research instance, not a service.

It is deployed through the `publicdigital` prototype pathway: a repo with the
`claude-prototype` topic, a GitHub Action that publishes to Netlify on every push to
`main`, and HTTP Basic Auth on every request.

## How it is put together

The site is **static files plus Netlify Forms**. There is no server.

That is a deliberate consequence of the hosting, not a preference. The org's
prototype hosting is a static site plus short-lived serverless functions — no
persistent process, no server-side sessions, no database inside the prototype. The
original build was a Node server with SQLite and FTS5, so moving here meant:

| Was | Now |
| --- | --- |
| FTS5 search in SQLite, per request | The corpus ships as JSON; the search index is built in the browser on load (~400ms) and queries run in under a millisecond |
| Corpus baked into a container at build time | Corpus exported to `assets/data/` and **committed to the repo** — the deploy has no build step |
| Signed session cookie behind a shared passcode | HTTP Basic Auth in a Netlify Edge Function |
| Feedback in its own SQLite database on a volume | Netlify Forms, pulled back out as CSV |
| `/healthz` returning 503 on a thin corpus | `npm run export` refuses to write a corpus below its floors |

The retrieval rewrite is the part worth knowing about. `assets/search.js` reimplements
BM25 with the same field weights and the same title-affinity blend, and the golden
suite runs **both** engines so a divergence shows up in a test rather than in front of
a user. See "Checking retrieval still holds" below.

## Refreshing the corpus

The deployed corpus is only as current as the last commit. There is no build step on
the deploy, so refreshing it is a local job:

```bash
npm run refresh
```

That runs ingest, watch, export and the golden suite in order. Then commit the changed
JSON under `assets/data/` and push — the push is the deploy.

```bash
git add assets/data && git commit -m "Refresh corpus" && git push
```

Worth doing weekly at most while this is under test. Every ingest is a full polite
crawl of GOV.UK; there is no value in hammering it for a prototype nobody depends on.

If `npm run export` refuses to write, that is the floors check doing its job — read
the ingest output above it for a source that has started returning something other
than HTML. Do not lower the floors in `pipeline/verify.ts` to get a clean export.

## Reading the feedback

Two forms collect it, and both are in the Netlify dashboard under **Forms**:

- **`compass-feedback`** — one row per rating or written comment.
- **`compass-queries`** — one row per session, holding a JSON array of every question
  asked and how many results each returned. Questions are batched per session rather
  than sent one at a time because the free tier allows 100 submissions a month; one
  engaged tester would otherwise spend a fifth of that in a single sitting.

Export both as CSV, then load them into the local database so the analysis commands
work on them:

```bash
npm run compass -- feedback import ~/Downloads/compass-queries.csv
```

Re-importing a later export is safe — only new rows are added.

**What to look at first.** Not the ratings. The **questions that returned nothing**,
and the **questions rated "no" or "partly"** with the comment attached. Those are the
registry's to-do list written by the people you are trying to serve. A search
returning *something* is weak evidence it returned the *right* thing.

## Checking retrieval still holds

```bash
npm test
```

Runs 21 hand-marked questions against the engine that ships, and — when `data/corpus.db`
is present — against the original SQLite engine too, reporting how much the two agree.
Only the shipping engine gates the result. Agreement sat at 51% when the engines were
swapped: they rank differently, and on spot checks the browser engine was the better
of the two, so the number is reported rather than asserted. A sudden collapse in it is
still worth a look.

## What to tell the people you invite

Say all four of these, because the interface only says the first three:

- It is unofficial, unfinished, and quotes guidance verbatim rather than interpreting it.
- If it finds nothing, that is a gap in a curated corpus — not evidence that no rule exists.
- The absence of a conflict warning does not mean two documents agree. Conflict
  curation is incomplete and known to be.
- **The questions they type are recorded**, along with anything they write in the
  form. That is the point of the instance. Nothing else is: no accounts, no analytics,
  no IP addresses stored, and no cookies.

## Data protection

Personal data is collected only where someone volunteers it: the optional role and
contact fields. Questions and comments are free text, so treat the stored submissions
as capable of containing anything a user chose to type. They sit in Netlify Forms
under the Public Digital team, reachable by whoever can see that Netlify account.

Note the change from the previous design: feedback used to live on a single volume
reachable only with an admin token. It is now held by Netlify. That is a wider blast
radius for the same data, and it is the price of this hosting. If this widens beyond a
handful of invited testers, that is the point at which it needs a retention period and
a line in a privacy notice rather than a paragraph here.

## Switch-off

`PROTOTYPE.yml` records a switch-off date of **2027-01-15**, 100 days after creation
and the org maximum. A daily org-wide audit reports prototypes that are due or
overdue. It does not disable anything — it is a commitment to go and turn this off:
delete the Netlify site, and archive or delete the repo.

## First deploy, and the one thing that is not automatic

Pushing to `main` triggers `.github/workflows/deploy.yml`, which calls the org's
reusable workflow. On the very first run it creates the Netlify site, then commits
`.netlify/state.json` back so later deploys reuse it.

That workflow needs a `NETLIFY_AUTH_TOKEN` repository secret, which is normally pushed
in automatically by the `provision-prototype-secret.yml` bridge in
`publicdigital/claude-prototype-deploy`. **Dispatching that bridge needs admin rights
on that repo**, which the author of this prototype does not have, so it could not be
triggered here. Until the secret exists, the deploy workflow fails at the Netlify step.

Either:

1. Ask an admin to run the bridge — in `claude-prototype-deploy`, Actions →
   "Provision prototype secret" → Run workflow, with `repo` set to `delivery-compass`
   (the bare name, no `publicdigital/` prefix); or
2. Add the secret by hand — create a Netlify personal access token (Netlify → User
   settings → Applications → Personal access tokens) and add it to this repo as
   `NETLIFY_AUTH_TOKEN` under Settings → Secrets and variables → Actions.

Then re-run the failed job, or Actions → Deploy → Run workflow. No new commit is needed.

Two further things to check on that first deploy, both known failure modes of this
pathway rather than of this prototype:

- If the site loads but shows Netlify's own "sign in" gate instead of a browser
  password box, that is Netlify's Project visibility feature sitting in front of the
  Edge Function. Fix it once in Project configuration → General → Visitor access.
- If the site loads with **no** password prompt at all, check the deploy log for a
  "Bundling edge functions" line. Its absence means `netlify.toml` did not reach the
  repo root, and the auth function deployed as an inert static file.

## Credentials

Generated per prototype and stored nowhere else — see the session that created this
repo, or reset them by editing `netlify/edge-functions/basic-auth.ts` and pushing.
