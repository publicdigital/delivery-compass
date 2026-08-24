# Deploying Delivery Compass

This turns the local prototype into one hosted instance that a handful of delivery
people can open in a browser, use, and leave feedback on. It is deliberately a
research instance, not a service: one machine, a shared passcode, and a bias towards
learning whether Ask/Map/Watch are the right three surfaces at all
(HANDOVER.md §7, step 1).

## What gets deployed, and what does not

- **The corpus is baked into the container image**, re-ingested from GOV.UK during the
  build. Nothing is fetched on boot, so a cold start is fast and a new machine does
  not re-hammer the Content API. The build runs `compass verify` and **fails** if the
  corpus comes out below its floors — a GOV.UK fetch that has silently started failing
  breaks the deploy instead of quietly shipping half a corpus.
- **Feedback lives on a mounted volume**, in its own `feedback.db`, separate from the
  corpus. A redeploy replaces the corpus and leaves the feedback alone. Every
  submission is also written to the platform log as a JSON line, so there are two
  copies of the one thing here that cannot be regenerated.
- **No seed PDFs, no local files.** Nothing served depends on anything on your laptop.
- **No analytics, no third-party anything.** The container talks to GOV.UK at build
  time and to nobody at run time.

## Prerequisites

Just the Fly CLI — the build happens on Fly's remote builder, so you do not need
Docker locally.

```bash
brew install flyctl && fly auth signup
```

## First deploy

Pick your own app name first: they are globally unique, so `delivery-compass` is
probably taken. Edit `app = "..."` in `fly.toml`, then:

```bash
fly launch --no-deploy --copy-config --name your-app-name --region lhr
```

Create the volume the feedback database sits on (1GB is far more than enough; it is
the smallest size Fly sells):

```bash
fly volumes create compass_data --region lhr --size 1
```

Set the secrets. Generate real random values rather than choosing memorable ones —
the passcode is the only thing between the instance and the open internet:

```bash
fly secrets set ACCESS_CODE="$(openssl rand -base64 12)" ADMIN_TOKEN="$(openssl rand -hex 24)" SESSION_SECRET="$(openssl rand -hex 32)"
```

Read them back, because you need to hand the passcode to your testers and keep the
admin token to yourself:

```bash
fly ssh console -C "printenv ACCESS_CODE ADMIN_TOKEN"
```

Deploy, with a fresh corpus:

```bash
fly deploy --build-arg CORPUS_REFRESH="$(date -u +%FT%H%M)"
```

Then check it came up healthy before you send the link to anyone:

```bash
curl -s https://your-app-name.fly.dev/healthz | python3 -m json.tool
```

`"ok": true` means the corpus cleared its floors and the search index is populated.
A 503 means the process is serving but the corpus is thin — read `failures` in the
response, and do not share the link yet.

## Environment variables

| Variable | Effect if unset | Notes |
| --- | --- | --- |
| `ACCESS_CODE` | **Instance is open to anyone with the URL** | Shared passcode. Set it. |
| `ADMIN_TOKEN` | `/admin` returns 404 and no export exists | Long random string. Never share it with testers. |
| `SESSION_SECRET` | Derived from `ACCESS_CODE` | Set it explicitly so rotating the passcode does not sign everyone out mid-session. |
| `FEEDBACK_DB` | `data/feedback.db` inside the app directory | Point at the volume (`/data/feedback.db`) or feedback dies with the container. |
| `COMPASS_DB` | the corpus in the image | Only needed to serve a corpus from somewhere other than the image. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Fly sets these via `fly.toml`. |

The `/healthz` and `/robots.txt` endpoints are deliberately outside the passcode gate;
`/admin` is deliberately outside it too, because a tester holding the passcode is not
an administrator. `/admin` returns 404 rather than 401 for a bad token, so its
existence is not advertised.

## Refreshing the corpus

The deployed corpus is only as current as the last build. To refresh it, rebuild:

```bash
fly deploy --build-arg CORPUS_REFRESH="$(date -u +%FT%H%M)"
```

Without that build arg Docker will reuse the cached corpus layer and you will
redeploy the same corpus you already had. The build re-runs `ingest`, `watch` and
`verify`, so a refresh also updates the Watch surface and re-checks corpus health.

Worth doing weekly at most while this is under test. Every build is a full polite
crawl of GOV.UK; there is no value in hammering it for a prototype nobody is
depending on yet.

## Reading the feedback

Three routes to the same data, in order of convenience:

1. **In a browser**: `https://your-app-name.fly.dev/admin?token=<ADMIN_TOKEN>` — a
   private page with the counts, the comments, and the questions that came back with
   nothing. Two CSV download links on it.
2. **On the command line**, against the live instance:

```bash
fly ssh console -C "sh -c 'cd /app && node --experimental-strip-types pipeline/cli.ts feedback'"
```

3. **Pull the database down** and query it locally, which is what you want before
   writing anything up:

```bash
fly ssh sftp get /data/feedback.db ./feedback.db
```

```bash
FEEDBACK_DB=./feedback.db npm run compass -- feedback
```

**What to look at first.** Not the ratings. The **questions that returned nothing**,
and the **questions rated "no" or "partly"** with the comment attached. Those are the
registry's to-do list written by the people you are trying to serve, and they are the
evidence for whether Ask/Map/Watch are the right surfaces. A search returning
*something* is weak evidence it returned the *right* thing — FTS matches on any term,
so a nonsense question can still find six sections.

## What to tell the people you invite

Say all four of these, because the interface only says the first three:

- It is unofficial, unfinished, and quotes guidance verbatim rather than interpreting it.
- If it finds nothing, that is a gap in a curated corpus of 41 sources — not evidence
  that no rule exists.
- The absence of a conflict warning does not mean two documents agree. Conflict
  curation is incomplete and known to be.
- **The questions they type are recorded**, along with anything they write in the
  form. That is the point of the instance. Nothing else is: no accounts, no analytics,
  no IP addresses stored, and the only cookie is the one that gets them past the
  passcode.

## Data protection

Personal data is collected only where someone volunteers it: the optional role and
contact fields. Questions and comments are free text, so treat the database as
capable of containing anything a user chose to type. It is stored on a single
encrypted-at-rest Fly volume in London, reachable only with the admin token, and
there is no export to anywhere else. If you widen this beyond a handful of invited
testers, that is the point at which it needs a retention period and a line in a
privacy notice rather than a paragraph here.

## Cost

Roughly the price of a coffee per month. A `shared-cpu-1x` 512MB machine that scales
to zero between visits plus a 1GB volume lands in low single-digit dollars while a
prototype is being tested by a handful of people. Fly's current pricing is the
authority, not this file.

## Alternatives

- **Render**: `render.yaml` is included. The persistent disk needs a paid instance
  type; on the free tier the feedback database is wiped on every deploy.
- **Any VPS or container host**: `docker build . && docker run -p 8080:8080 -v ...`
  works with the same environment variables. Terminate TLS in front of it — the
  access cookie is only marked `Secure` when the proxy sets `X-Forwarded-Proto: https`.

## Troubleshooting

**The build fails at `compass verify`.** That is the check doing its job. Read the
ingest output above it: a source that used to return HTML and now returns a PDF, or a
Content API response shape that has changed. Fix the registry or the fetcher; do not
lower the floors in `pipeline/verify.ts` to get a green build.

**`/healthz` returns 503 but the site loads.** The corpus is below its floors. The app
serves anyway rather than showing nothing, but it will answer fewer questions than it
should.

**Feedback disappears after a deploy.** `FEEDBACK_DB` is not pointing at the volume,
or the volume did not mount. Check `fly volumes list` and the `[[mounts]]` block. The
log-mirrored copies are your fallback: `fly logs | grep '"evt":"feedback"'`.

**Testers are asked for the passcode repeatedly.** `SESSION_SECRET` is unset and the
passcode changed, or the machine restarted with a derived secret. Set it explicitly.

**Everyone gets 404 on `/admin`.** `ADMIN_TOKEN` is unset, or the token in the URL
does not match. Both look identical from outside, on purpose.
