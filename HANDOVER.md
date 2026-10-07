# Delivery Compass — handover

Written 2026-08-21, across three sessions the same day, so a fresh session can pick
this up cold; kept current since. Read this first, then [README.md](README.md) for how
to run it, or [DEPLOY.md](DEPLOY.md) for how it is hosted for testers.

The open decision that dominated §7 for five sessions is **answered** as of
2026-08-24: one hosted instance, shared passcode, invited testers. See §6.5 and §7.

---

## 1. The original brief

Verbatim, as given at the start of the first session:

> Uk Government delivery rules and regulations are complex and interdependent. They
> are maintained by several bodies and shared openly. But not centrally co-ordinated.
> I have included offline versions of these in the folder as examples.
>
> I want to build a tool that helps delivery people in government navigate the up to
> date guidance, and to stay on top of the changes. My vision is something like an
> expert helper. That they can use to access advice. But I am also interested in
> things like simplifyiing guiandce to show people how it all fits together

Three things are asked for: **navigate current guidance**, **stay on top of changes**,
and **simplify / show how it fits together**. The build addresses all three.

The "offline versions" are the 15 PDFs in the parent folder. They are a seed and a
provenance record — deliberately *not* the thing the tool is built on. See §4.

## 2. Decisions taken

Asked and answered at the planning stage. Revisit these before changing direction.

| Question | Chosen |
| --- | --- |
| Which surface first? | **Thin versions of all three** (Ask, Map, Watch), on one shared pipeline |
| How wide should the corpus go? | **Both spines plus oversight** — HMT/NISTA funding-and-assurance *and* the GDS digital spine, plus NAO/PAC/annual-report scrutiny |
| What is this meant to become? | **Working prototype** — runs locally, no infra, no auth, no hosting |

A fourth surface, **Your folder**, was added unprompted because it is the most direct
demonstration of the problem. Removed 2026-08-21 once §7 was resolved — see the
progress log entry below.

## 3. Where it got to

Working end to end. 41 registered sources, 29 ingested, 3,286 sections, 4,461
obligations, 26 curated relationships. One runtime dependency (`yaml`), Node 24
built-ins for everything else, 7MB SQLite file, no build step, no API key.

```
sources/*.yaml        the curated registry — the real intellectual asset
sources/relations.yaml hand-curated edges between sources
pipeline/             fetch, normalise, classify, index, search, watch, graph, conflicts
web/                  server + single-page UI (Ask / Map / Watch)
test/golden.test.ts   21 hand-marked questions; 21/21 retrieval, 5/5 caveats
```

Verification status: typecheck clean, golden set passing, redirect-following tested
against a known-dead URL, classifier precision spot-checked by hand.

## 4. What we learned about the domain

These are the findings that shaped the design. They are not derivable from the code,
and re-deriving them costs a lot of tokens.

**Do not build on the PDFs.** Several are CID-encoded and extract as garbage (Magenta
Book, Portfolio Risk annex, policy_appraisal_and_health). Two are browser print-outs
of web pages and extract as ligature soup. Meanwhile GOV.UK publishes clean HTML for
nearly everything, with stable heading anchors. Ingestion is HTML-first; PDF-only
sources are skipped and reported rather than guessed at.

**The GOV.UK Content API is the whole substrate.** `GET /api/content/<path>` returns
`public_updated_at`, `first_published_at`, `details.change_history` (human-authored
notes!), `details.attachments`, and `links`. Change detection is a cheap timestamp
poll. `document_type: "redirect"` is returned explicitly, so link rot is detectable.
Collections expand via `links.documents` — one registry entry for the Green Book
collection yields 27 documents. Service manual topics expose guides via
`links.linked_items`, not `children`. But expansion is a *discovery* tool for a human
curating the registry (`compass expand <slug>`), not something the ingest pipeline
does automatically — a collection source only ever ingests its own thin landing-page
blurb. Most collection members turn out to be PDF/DOCX forms and templates anyway;
see §6.2.

**Free-text search on the API is unusable for retrieval.** A query for "orange book
management of risk" returned "Book your driving test". It degrades to popularity
ranking on long queries. Use `filter_organisations` for *discovery*; curate the
registry by hand. `pipeline/find-slug.ts` and `pipeline/list-org.ts` exist for this.

**The IPA no longer exists.** NISTA (National Infrastructure and Service
Transformation Authority) replaced it on 2025-04-01. The IPA organisation page has
not been updated since. The registry uses NISTA.

**Digital and technology spend controls were abolished on 2026-04-01.** Departments
now make most of their own digital and technology spending decisions. The Service
Manual reflects this. **The Technology Code of Practice does not** — it still tells
readers to follow the Cabinet Office spend control process and email the GDS
Assurance team. Two current government sources contradict each other. This is the
worked example the whole tool is built around.

**Two of the seed PDFs were deleted from GOV.UK on 2026-07-29** — the Portfolio Risk
Management Annex and the Good Practice Guide: Risk Reporting. HMT's own words: "out
of date, contained links to superseded guidance and no longer fully reflect the
current Risk Centre of Excellence thinking and practice." No public replacement; the
material moved to the OneFinance intranet. Guidance going behind the firewall is
itself a finding.

**Business case guidance was rewritten on 2026-06-30** following the 2025 Green Book
Review, splitting into separate project and programme guides. The 2018 PDFs in the
folder are superseded.

**Page-update dates mislead; filename matching does not.** GOV.UK asset URLs embed
the original filename, so an exact match against a live attachment is a *definitive*
currency verdict. A page can update while its attached PDF stays the same — this
happened with the Better Regulation Framework, where an early read of the page date
wrongly suggested the local copy was stale. Verdicts carry a confidence flag for
exactly this reason.

**A source's own hyperlinks are more reliable than its registry slug.** Found by
tracing where the AI Playbook's citation for "Secure by Design principles" actually
pointed (§6.2) — the answer was a completely different, correct URL from the one
already registered under that name. When a registry entry looks thin or wrong,
checking what other sources link to it is a cheap, decisive way to verify.

## 5. Corrections to the original plan

The approved plan is preserved at [docs/original-plan.md](docs/original-plan.md).
Two of its claims did not survive contact with the corpus.

**The RFC-2119 convention is not the differentiator.** The plan leaned heavily on
"shall denotes a requirement" being a documented, machine-detectable convention. It
is documented — but the Orange Book is the *only* ingested source that uses `shall`
at all, 15 times. Every other source expresses requirements with `must`, in ordinary
English. Worse, the convention table lives only in PDF front matter; the HTML
editions drop it, so it cannot be auto-detected. `declares_convention` is now a
curated registry field (true for `orange-book` and `govs-002`), and "must" is flagged
as informal phrasing *only inside* documents that declare the convention. Outside
them, flagging it would be noise. Distinguishing mandatory from advisory is still the
most valuable feature; it just rests on ordinary modal verbs.

**The most valuable feature was not in the plan at all.** Cross-source supersession
detection — warning that one source has been overtaken by another — emerged from
testing. It is now the thing that most justifies the tool existing.

Also worth recording: **the prototype was initially styled to look like GOV.UK** and
had to be de-branded. It does not run on a GOV.UK domain, so it must not use the
crown, the logotype, GDS Transport, or the GOV.UK brand palette. It now carries an
explicit "Unofficial" disclaimer. Do not reintroduce the branding.

## 6. Progress log

### 6.1 Staleness badge and conflict discovery sweep (session 2)

Motivation: the tool warned on two conflicts, both found by hand. Once a UI shows
SUPERSEDED banners, readers infer that no banner means no conflict — an inference
that hadn't been earned. Exposure at the time: 73% of indexed pages (159 of 219) were
last updated before 2025, and the Service Manual alone carried 218 mandatory
obligations across pages dating back to 2016 — 40% of every mandatory obligation in
the corpus.

**Staleness badge — shipped.** Every obligation and section card in the Ask panel
carries an explicit age tag (fresh / 1-3y / 3y+ "verify currency" / date unknown),
computed client-side in [web/index.html](web/index.html) from `updatedAt`. That field
didn't exist on obligations before — `ObligationHit` in
[pipeline/search.ts](pipeline/search.ts) only carried section and source dates, not a
per-obligation one — so it had to be added to the SQL and threaded through `/api/ask`
in [web/server.ts](web/server.ts). No obligation card can now imply currency by
default the way it did before.

**Conflict discovery sweep — shipped.** [pipeline/conflicts.ts](pipeline/conflicts.ts)
buckets mandatory/recommended obligations by normalised actor, pairs obligations
across sources within a bucket that share ≥2 non-boilerplate content words and are
≥1 year apart in page date, and scores each source pair by
`age gap (days) × shared-word count × mandatory weight`. Pairs already present in
`relations.yaml` are excluded, since a human has already judged those. Run it with
`compass conflicts [n]`. **This proposes, it does not judge** — the actor extraction
it depends on is best-effort (§8), and roughly a third of what it surfaces is
boilerplate-phrase overlap ("your team should…") rather than a real divergence.
**It has not yet been used to add a new curated conflict** — nobody has read the
top candidates and decided whether they're real. That's still open; see §7.

Runner-up considered and deferred at the time: tuning the conflict sweep's thresholds
further before triaging its output. Rejected as guessing twice — triage first, let
false positives found by hand drive the next tuning pass.

### 6.2 Coverage-gap fill (session 3, same day)

Asked to make the corpus "fully populated" before deciding what's next. Went through
every registered source that wasn't `full` and checked *why* against the live GOV.UK
Content API, rather than assuming the existing `metadata_only`/skip label was still
correct. Found two real bugs, not just missing coverage:

**`ai-evaluation` was a real pipeline gap, not a design constraint.** Its
`fetcher: govuk_attachment` was never actually implemented in `pipeline/ingest.ts` —
only `pipeline/fetchers/govuk.ts`'s currency-checker knew how to resolve it. The
result: its content (the AI evaluation guide, a real HTML attachment on the Magenta
Book) was silently absorbed into `magenta-book`'s own sections, misattributed to HM
Treasury/mandatory instead of the Evaluation Task Force/advisory. Fixed by
implementing `resolveAttachmentDoc` in `ingest.ts` and excluding matched attachments
from the parent's own ingestion. The golden test's expected sources for "how should
we evaluate an AI intervention" had to be updated to include `ai-evaluation` — the old
expectation (`magenta-book`) was correct only because of the bug.

**`secure-by-design` was registered against the wrong document entirely.** The
registry pointed at `/government/collections/secure-by-design`, and it dutifully
ingested as `metadata_only` — but that GOV.UK collection is DSIT's *consumer IoT
product security* regime (PSTI Act, smart devices), unrelated to CDDO's software
"Secure by Design" framework that the AI Playbook and other sources actually cite.
Checked what the AI Playbook's own hyperlink for "Secure by Design principles" points
to: `https://www.security.gov.uk/guidance/secure-by-design/`, entirely off GOV.UK, and
it 403s non-browser requests (CloudFront). A plausible-looking wrong source is worse
than a visible gap, so this needed a new category: added `off_platform` to
`FetcherName` — a real canonical source exists, it's just not fetchable — distinct
from `local_only` (no public canonical at all). The curated relation
`tcop -> secure-by-design` was already conceptually correct; only the underlying
registry entry was wrong.

**Three new sources added**, found via `compass expand` on the Green Book collection
(27 members) and the NISTA assurance toolkit collection (16 members): most members of
both are PDF/DOCX-only forms and templates (checked individually, left unregistered —
registering pure admin templates would be noise, not guidance). Three had real HTML
editions and clear delivery-governance relevance: `green-book-environment` (climate
change and environmental valuation), `green-book-mcda` (multi-criteria decision
analysis in options appraisal), and `publishing-business-cases` (HMT transparency
guidance). Two more with HTML editions — `economic-and-social-cost-of-fire` and
`...-costs-of-crime` — were deliberately left out: narrow valuation reference data,
not guidance a delivery person would ask about. That's a curation judgement, not a
technical gap; noted here so it isn't re-litigated by accident.

Net effect: 25/38 registered sources indexed → 29/41. Every remaining gap is now a
checked, explained absence rather than an assumption (§8).

### 6.3 "Your folder" removed, personal-file dependency retired (session 4, 2026-08-21)

Asked whether "Your folder" would still serve a purpose once the tool is published for
others. First answer floated "colleagues running it locally" as one audience where the
feature still made sense — each person bringing their own folder of saved guidance.
That was a misreading: colleagues would only ever test on the builder's own machine,
not run their own copy with their own files. There is no audience for which "compare
the PDFs sitting in *this* folder" generalises.

That settled a narrower but real question left open in §7: whatever "useful for
others" ends up meaning, every surface the tool presents must be grounded in live
guidance, not one person's local downloads. So the feature came out entirely, not just
hidden:

- **Web:** the "Your folder" tab, its panel, and the `/api/currency` endpoint
  ([server.ts](web/server.ts), [index.html](web/index.html)).
- **CLI:** `compass check`, which did the identical comparison from the terminal for
  the maintainer rather than an end user — asked separately, and also removed rather
  than kept as a maintainer-only tool, since it depends on exactly the same personal
  seed folder.
- **Pipeline:** `pipeline/currency.ts` in full (`assessSeed`, `findDuplicates`), plus
  `seedIndex` and the `localSeed` field in `pipeline/registry.ts`/`types.ts`.
- **Registry data:** the `local_seed:` key removed from all 13 entries that carried
  one, across six `sources/*.yaml` files. Comments explaining *why* a source is
  registered stayed untouched — only the seed-filename pointers went.

`checkSource` in `pipeline/fetchers/govuk.ts` and the `SourceState` type were **not**
touched — Watch depends on them for live change-detection, which is unrelated to
comparing against local files. Typecheck and the golden suite (21/21, 5/5) both pass
after the removal.

The seed PDFs themselves stay in the parent folder as the original provenance record
per §1 — only the code path that read and compared them at runtime is gone. The
domain findings that comparison surfaced (two withdrawals, the Magenta Book
supersession, the rewritten business-case guidance) are not lost; they were already
written up in §4 as things learned about the domain, independent of the feature that
found them.

### 6.4 Watch baseline recorded, two false-signal bugs in `watch` fixed (session 5, 2026-08-24)

The corpus was re-ingested against live GOV.UK and `compass watch` was run to give the
Watch surface a baseline it did not have. The `snapshots` table had **zero rows** —
the surface was wired up and working, but had nothing to compare against, so it would
have shown a demo reader nothing at all. 41 sources now have snapshots.

Re-ingest produced identical totals to 2026-08-21 (29 full, 3,286 sections, 4,461
obligations, golden suite 21/21 and 5/5), so nothing upstream moved in the three days
between. Running `watch` surfaced two bugs, both of which put *wrong* things in front
of a reader rather than merely missing right ones:

**`govuk_attachment` sources could never be checked.** `poll()` in
[pipeline/watch.ts](pipeline/watch.ts) called `checkSource(source)` with no second
argument, but `checkSource` needs the parent's slug for an attachment source — an
attachment has no slug of its own (§6.2). So `ai-evaluation` errored on every poll
with "govuk_attachment source has no resolvable parent". The registry already carried
`parent: magenta-book`; `poll()` just never resolved it. Fixed by building a
`slugById` map from the sources being polled and passing the parent's slug through.

**Any dateless source reported a phantom update on every poll.** The date comparison
was `prior.public_updated_at !== state.publicUpdatedAt` — SQLite returns `null`, the
checker returns `undefined`, so the two never matched for a source with no date. The
`off_platform` source `secure-by-design` duly emitted `date-moved: "Updated unknown to
unknown with no published note"` every single run. Fixed by normalising both sides
with `?? null`. This one matters more than it looks: a Watch feed that cries change
where there is none trains a reader to ignore it, which is the same failure mode as
§6.1's silence-implies-checked, pointed the other way.

After both fixes the feed is clean — the only standing entries are the two genuine
HMT withdrawals from 2026-07-29. Typecheck and both test files pass.

**Noted, not fixed:** an attachment source now inherits its parent's entire change
history, so `ai-evaluation` re-reports the Magenta Book's published notes under its
own title. Correct per the attachment model (its state *is* the parent's), but it
reads as duplication in the feed. Whether an attachment should show its parent's notes
is a judgement call, not a bug — left for whoever decides §7.

### 6.5 Deployable instance, feedback capture, git (session 6, 2026-08-24)

The §7 fork was answered by the brief for this session: **one hosted instance, behind
a shared passcode, for invited testers.** Not public, not open-source — those stay
open, and nothing here forecloses them. This is the cheapest way to do §7 step 1
(get it in front of 3-5 real delivery people), which everything else in §7 was
waiting on.

**Now under version control** (§7 step 3, previously a listed gap). `git init`, one
commit covering the whole prototype plus this session's work.

**Deployment.** `Dockerfile` + `fly.toml` (primary) + `render.yaml` (alternative),
procedure in [DEPLOY.md](DEPLOY.md). Two decisions worth not re-litigating:

- **The corpus is baked into the image at build time, not fetched on boot.** A cold
  start would otherwise make the first visitor wait a minute, and every new machine
  would re-crawl GOV.UK. The consequence is that refreshing the corpus means
  redeploying — `fly deploy --build-arg CORPUS_REFRESH=$(date -u +%FT%H%M)`, where
  the build arg exists solely to stop Docker serving a cached corpus layer.
- **The build gates on `compass verify`** (new: `pipeline/verify.ts`), which asserts
  corpus floors and that the FTS index is populated. `/healthz` returns 503 on the
  same condition. This is §7 step 4's "notice a GOV.UK fetch silently starting to
  fail", done as cheaply as it can be done: the failure mode it catches is a deploy
  that looks completely healthy and just answers fewer questions.

**Feedback** (`pipeline/feedback.ts`). Two routes in, because the majority who will
never fill in a form still tell you something with one click: a **yes/partly/no strip
on every answer**, and a **form at the foot of the page** for the minority whose
comment is worth ten ratings. Plus **every question is logged with its hit count** —
no user action required, and the most useful thing recorded. Read it at
`/admin?token=…`, via `compass feedback`, or as CSV.

The feedback database is deliberately **separate from `corpus.db`**: the corpus is a
build artefact replaced on every deploy, and feedback is the only thing in this system
that cannot be regenerated. It sits on a mounted volume, and every write is mirrored
to stdout as a JSON line so a misconfigured volume is not a lost study.

**Server hardening**, since it is now on the open internet: shared-passcode gate with
an HMAC-signed cookie and a rate limit on the attempt (brute-forcing one shared
passcode is the only real attack here), nonce-based CSP, `noindex` plus
`robots.txt` (an unofficial tool quoting government guidance should not turn up in
search results looking like an authority), body-size caps, per-client rate limits,
gzip, graceful SIGTERM. `/admin` returns **404** for a bad token, not 401, so its
existence is not advertised — and it sits outside the passcode gate, because a tester
holding the passcode is not an administrator.

**UI changes for an audience of strangers.** The limitations are now stated up front
in an open `<details>` block rather than only in the footer small print, including
explicitly that *the absence of a conflict warning does not mean two documents agree*
— the inference CLAUDE.md warns about, which matters much more now that people who
did not build it are reading it. The privacy line says plainly that typed questions
are recorded.

**One real bug caught in the browser:** a nonce-based CSP cannot whitelist inline
`style=` attributes (nonces do not apply to them), so every generated answer card
silently lost its paragraph spacing. All inline styles are now classes, and CLAUDE.md
carries the rule. Only the console showed it; the page looked plausible.

**Verified end to end** before writing this: gate blocks and admits, wrong passcode
rejected, `/api/*` 401 unauthenticated, admin 404 without the token and 200 with it,
CSV export correct, a rating and a form submission made in a real browser and read
back out through the CLI, `/healthz` green, zero-hit queries recorded as such.
Typecheck and the golden suite pass. Resident memory with the corpus loaded and the
conflict sweep computed: ~60MB, which is what sized the 512MB machine.

**Not done, deliberately:** the conflict-sweep triage (§7 step 2) is still untriaged.
It was second in the recommended order and remains so — but it is a curation job
needing a human reading evidence, and it does not block getting the thing in front of
people. It does get more urgent the moment somebody relies on the tool's silence.

## 7. Answered: hosted instance for invited testers

**Decided 2026-08-24 (session 6).** "Others" means **a handful of invited delivery
people using one hosted instance behind a shared passcode.** Not a department-wide
service, and not public or open-source. Both of those remain live options and nothing
built for this closes them off — but neither is worth paying for before anyone has
told us whether Ask/Map/Watch are the right three surfaces.

What that ruled in, and what it cost, is in §6.5. What it ruled out for now:

- **Public / open-source.** Would need a licence for the code (OGL already covers the
  ingested content) and a maintenance plan for who keeps the registry current once it
  is not one person. Revisit if the invited round says the thing is worth widening.
- **Department-scale hosting.** Light access control turned out to mean one shared
  passcode; anything beyond that (SSO, per-user accounts, multiple machines) is
  unjustified for five testers and would have forced the feedback store off SQLite.

**Where the recommended order now stands:**

1. ~~Put it in front of 3-5 real delivery people.~~ **Unblocked, not done.** The
   instance is deployable and collects feedback; nobody has been invited yet. This is
   the next action, and it is the builder's, not a coding task.
2. **Triage the conflict sweep into `relations.yaml`** (`compass conflicts 20`).
   Still outstanding, still second. More urgent once people who did not build this are
   relying on the absence of a warning meaning something.
3. ~~`git init`.~~ **Done** (§6.5).
4. **Harden further only if the invited round justifies it** — scheduled re-ingest
   instead of a manual redeploy, alerting off `/healthz` rather than reading it by
   hand, a real access model. All cheap to add later; all pointless if the surfaces
   turn out to be wrong.

The reasoning that produced this order has not changed: the hand-curated registry is
the real asset, and scaling distribution before validating the content just scales
whatever is wrong faster.

## 8. Known gaps and cautions

- Seven sources are metadata-only — GOV.UK exposes only a landing-page summary, PDF
  attachments only, no HTML edition. They are excluded from retrieval so a blurb can
  never surface as guidance. Checked source-by-source against the live GOV.UK
  Content API on 2026-08-21 (§6.2) — all seven are genuine PDF-only dead ends under
  the HTML-first rule, not pipeline bugs.
- Five sources are registered but never ingested, each for a distinct, correct
  reason: `nao-reports` (not OGL, link only), `uc-lessons-learned` (no public
  canonical), `portfolio-risk-annex` and `risk-reporting-guide` (withdrawn by HMT),
  `secure-by-design` (`off_platform` — §6.2, real content exists but isn't
  fetchable). Every one of the 12 non-full sources now has a checked, honest reason;
  none are silent guesses.
- Obligation extraction is regex, tuned for precision over recall. A false "mandatory"
  is worse than a missed one.
- Actor extraction is best-effort and returns null rather than guessing. This is the
  ceiling on the conflict discovery sweep's precision (§6.1).
- The oversight tier is thin, as the plan predicted.
- NAO content is **not** OGL. It is linked, never redistributed (`redistribute: false`).
- Answers are extractive, not synthesised. No LLM is used or required. Given the rule
  "quote mandatory requirements verbatim", extraction satisfies it by construction.
- Registry entries legitimately overlap (the Service Manual crawl reaches the
  spend-controls guide). A page explicitly registered as its own source is never also
  ingested under a parent — see `explicitlyClaimedPaths` in `pipeline/ingest.ts`.
  Getting this wrong makes attribution non-deterministic, which silently breaks the
  supersession warnings.
- **Deployment-specific cautions** are in [DEPLOY.md](DEPLOY.md), not here. The two
  worth knowing from this file: the deployed corpus is only as current as the last
  build (refresh means redeploy), and an FTS match is weak evidence of a *good* match
  — a nonsense question can still return six sections, so "the search found
  something" is not a success metric when reading feedback.

## 9. Re-running from cold

```bash
cd delivery-compass && npm install
```

```bash
npm run compass -- ingest && npm run compass -- watch
```

Ingest takes about a minute and is polite to GOV.UK (150ms between calls). `watch`
records the snapshot baseline that the Watch surface reads from.

If serving through this repo's dev-preview tooling rather than a plain terminal:
`.claude/launch.json` (one level up, in the parent folder) points at an absolute path
deliberately — a relative path made Node call `process.cwd()` during module
resolution, which some sandboxes deny. `pipeline/cli.ts` and `web/server.ts` compute
their seed-folder default the same cwd-free way, via `import.meta.url`.

---

## Session 7 — 2026-10-07 — moved to hosting for user testing

The ask: get this somewhere standalone so real people can test it.

**Decision taken: reshape for the org's Netlify pathway**, rather than deploy the Node
server as built on Fly. Both were offered. The Fly route was ready — Dockerfile,
fly.toml and a written DEPLOY.md — but Netlify won on being the org standard, free,
zero local tooling, auto-deploying on push, and inside the prototype fleet audit
alongside Contract Radar. Switch-off date set to the 100-day maximum, 2027-01-15.

The cost of that choice was real and was paid in this session: the org's hosting is
static files plus short-lived functions, and Delivery Compass was a persistent Node
server with SQLite, FTS5, a signed session cookie and a feedback database. Three of the
five rows in the org's "doesn't work" table.

### What changed

- **Retrieval moved into the browser.** `assets/search.js` is a plain ES module
  implementing a Porter stemmer, BM25 with the same field weights (heading ×3, text ×1)
  and the same title-affinity blend (×8) as the FTS5 version. It is loaded unchanged by
  the browser *and* imported by the golden test, so the suite exercises what ships.
  Index build is ~370ms over 3,279 sections; a query is ~0.4ms.
- **The corpus is committed as JSON.** `pipeline/export-static.ts` flattens SQLite into
  `assets/data/` (1.2MB gzipped), precomputing everything that does not depend on the
  question: confirmed conflicts per source, candidate conflicts per obligation, section
  formatting, the map graph, the change feed. The deploy has no build step —
  `netlify deploy --dir=.` publishes the repo as-is — so this had to be in git.
- **Feedback moved to Netlify Forms.** No functions: the deploy never runs `npm install`,
  so a function importing `@netlify/blobs` would not bundle. Questions are batched per
  session because the free tier allows 100 submissions a month.
  `compass feedback import <csv>` loads an export back into the local database so the
  existing analysis commands still work.
- **Removed**: `web/server.ts`, `web/index.html`, `Dockerfile`, `fly.toml`,
  `render.yaml`, `docker/`. All recoverable at commit `9bc13f8` if the Fly route is
  ever wanted back.

### Did the rewrite damage retrieval?

No. Both engines pass 21/21 on the golden set. They agree on only 51% of returned
sources, which sounds alarming and is not: spot-checking showed the browser engine
returning a *better* top hit twice (asked for "theory of change" it returns the section
titled "Theory of change"; SQLite returned a climate-appraisal page) and spreading
across more relevant sources where SQLite returned the same source four times. The
suite now runs both and reports agreement rather than asserting it.

### What is NOT done

- **The deploy has not succeeded yet.** The workflow needs a `NETLIFY_AUTH_TOKEN`
  repository secret, pushed in by a bridge workflow in `claude-prototype-deploy` that
  requires admin rights on that repo. `olilovell` has read access only, so the dispatch
  returned 403. One admin action unblocks it — see the end of DEPLOY.md for the exact
  ask and the manual alternative. Until then every push fails at the Netlify step.
- **Nobody has been invited.** Same as after session 6. That remains Oli's to do.
- **The conflict sweep is still untriaged.** `compass conflicts 20` proposes candidates;
  none have been confirmed into `relations.yaml` in seven sessions. It matters more now
  that strangers will read the tool's silence as meaning something.

### Judgement worth keeping

Feedback now sits with Netlify rather than on a single volume reachable only with an
admin token. That is a wider blast radius for free-text written by government staff,
and it is the price of this hosting rather than an improvement. It is fine at the scale
agreed — a handful of invited testers — and is flagged in DEPLOY.md as the thing to
revisit if this widens.

### Two bugs found while verifying the move, both fixed

**A "should" was being labelled MANDATORY.** `is/are required to` was in the mandatory
modal list, and English overloads "required": "departments are required to register
their evaluations" is an obligation, but "ongoing dialogue is required to ensure
quality" means *needed*. Roughly seven in ten of the 23 obligations it produced were
the second kind — and because the modal list is ordered strongest-first, it also
promoted whole sentences whose real modal was "should" to a red MANDATORY label. One
was on the default "risk appetite" example, so it would have been among the first
things a tester saw. The modal has been removed: precision over recall is the rule,
and the genuine cases are nearly all restatements of a "must" caught elsewhere.

**The Green Book had silently emptied itself.** GOV.UK moved it on 2026-10-06 —
`/government/publications/the-green-book-appraisal-and-evaluation-in-central-government`
now redirects to `/government/publications/the-green-book--2`, and the collection moved
too. `checkSource` followed redirects; `resolveDocs` did not, so ingest reported "no
body content", the previous run's rows stayed in the database, and `compass verify`
still passed its floors. A central source was gone and nothing said so.

Both halves are fixed: the ingester now follows one redirect and reports the move so
the registry can be updated, and `compass ingest` exits non-zero when a source that
should carry prose returns none. Since `npm run refresh` chains with `&&`, that now
stops a hollowed-out corpus reaching the exporter. The registry slugs were updated.

The corpus was also refreshed in passing — it had been six weeks stale.

### Deployed 2026-10-07

Live at **https://publicdigital-delivery-compass.netlify.app**, behind HTTP Basic
Auth. James Stewart provisioned the `NETLIFY_AUTH_TOKEN` secret; the deploy pathway
uses his Netlify account without sharing credentials, which also means the Forms
dashboard is not reachable by the prototype's author.

Four things were wrong on the first deploys and were caught by checking the live site
rather than by any test:

- **Form detection is off by default on new Netlify sites.** Every submission returned
  404, including a control POST to a form name that does not exist. Had this not been
  tested, the user study would have collected nothing while appearing to work. Needs
  one dashboard toggle plus a redeploy; still outstanding at time of writing.
- **The hidden Netlify form declarations rendered as stray empty input boxes** below
  the footer, because the stylesheet's bare `form{display:flex}` overrode the `hidden`
  attribute. Fixed with an explicit `[hidden]` rule placed before it.
- **Two redirect rules failed silently.** Netlify serves an existing static file in
  preference to a redirect unless `force = true`, so the rules meant to hide
  `/pipeline/*` and friends returned 200. Separately, `/.netlify/*` is reserved and
  cannot be redirected, and Netlify only supports a trailing splat so `/*.md` matched
  nothing.
- **Netlify injects a HUD script** whose inline styles and scripts the CSP blocks,
  leaving four console errors that belong to Netlify rather than the app. Not fixable
  from the repo; recorded in DEPLOY.md so it is not chased again.

Verified on the live site: 401 without the password and 200 with it, all app assets
and corpus files served, source paths and working notes 404, Brotli bringing the 5MB
corpus down to ~895KB, and a search returning the supersession warning, the conflict
warning, ten obligation cards and six section cards.
