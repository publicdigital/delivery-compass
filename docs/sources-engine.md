# Keeping the sources complete and current

Written 2026-10-07, after the prototype went live and before any testing feedback had
come back. A plan, not a decision — nothing here is built.

The question behind it: if the demo proves handy, what would it take to have an engine
that keeps the corpus comprehensive and fresh, rather than a snapshot that rots?

These are two different problems. One is nearly solved and needs automating. The other
cannot be solved as stated and needs reframing.

---

## 1. Freshness

### What already exists

- `compass watch` polls `public_updated_at` for all 41 registered sources and reads
  GOV.UK's own `change_history` notes.
- `compass ingest` follows redirects, reports moves, and exits non-zero when a source
  that should carry prose returns none.
- `compass verify` enforces corpus floors; `npm run export` refuses to write below them.
- The golden suite gates retrieval quality.

The mechanism is there. The gap is that it only runs when a human runs it.

### The engine

A scheduled GitHub Action. No new infrastructure, no new accounts.

**Daily — the cheap poll only.** 41 requests against `public_updated_at`. If nothing
moved, nothing happens. This is deliberately not a full crawl: GOV.UK is a public good
and there is no reason to re-fetch 3,300 sections to learn that nothing changed.

**On change, or weekly regardless — the full chain.** ingest → watch → export → golden
suite → commit → push. The push is the deploy, which already works.

### Graduated response, not all-or-nothing

What the run does with its result matters more than the schedule. Split it:

| Outcome | Action |
| --- | --- |
| **Routine** — content changed, tests pass, counts within tolerance | Commit and deploy automatically |
| **Notable** — a source empties, sections drop >10%, a slug redirects, something is withdrawn, new conflict candidates appear | Do not deploy. Open an issue with the detail |

The reason for the split is the failure mode this project keeps hitting: the silent
one. A hollowed-out corpus that still passes its floors looks exactly like a healthy
service that happens to answer fewer questions. The Green Book emptied itself in
October 2026 and nothing said so. An unattended refresh that ships that quietly is
worse than one that stops and complains.

### Open questions

- Auto-commit to `main` versus opening a PR. Auto-commit keeps it fresh but puts an
  unreviewed corpus change live; a PR gets reviewed until the week nobody reviews it.
  The graduated split above is an attempt to get both, but the tolerance thresholds are
  guesses until there is a few months of real variance to look at.
- Whether a redirect should auto-update the registry slug or only report it.
  Auto-updating is safe for an exact redirect and saves a round trip; it also means the
  registry changes without anyone deciding to change it.

---

## 2. Completeness

### Why "complete" is the wrong target

The tool's central safety property is that **if it finds nothing, that is a gap in this
corpus, not evidence that no rule exists**. Every disclaimer in the interface rests on
it. Chasing completeness erodes it: the closer the claim gets to "comprehensive", the
more reasonable it becomes for a reader to treat silence as an answer.

What is achievable, and more useful, is **a defined scope, measured coverage against
it, and a published gap list**.

### Three discovery routes

**a. The corpus already knows what it is missing.** Guidance cites guidance. Anything
this corpus repeatedly points at but does not contain is a gap it is reporting itself.

Measured on 2026-10-07 by harvesting outbound GOV.UK links from **9 sampled sources**:

- 177 distinct GOV.UK pages linked
- **146 of them not covered by any registry slug**

Top of that list, ranked by how often the corpus cites them:

| Cites | Page |
| --- | --- |
| 8 | Business case guidance for projects and programmes |
| 7 | Business regulation: producing post-implementation reviews |
| 6 | Algorithmic Transparency Recording Standard hub |
| 5 | Guidelines for AI procurement |
| 4 | Generative AI Framework for HMG |
| 4 | Government social research publication protocols |
| 3 | Public Sector Equality Duty |
| 3 | The Digital, Data and Technology Playbook |
| 3 | Knowledge asset management in government |
| 2 | Reforming the spending control and accountability framework |

None of these is marginal. This is the highest-precision route and the cheapest.

It needs one small change: `pipeline/normalise.ts` strips tags, so links are discarded
at ingest. They would need capturing alongside section text.

A side-finding worth keeping: the pre-October Green Book URL appears in that uncovered
list, because other government documents still link to the old address. Government's
own cross-references go stale too, which is more material for the Watch surface.

**b. Organisation sweeps** give recall where the link graph gives precision.
`filter_organisations` plus guidance-shaped document types, measured the same day:

| Body | All items | Guidance-shaped |
| --- | --- | --- |
| Cabinet Office | 7,792 | 967 |
| Department for Business and Trade | 3,823 | 876 |
| HM Treasury | 9,833 | 653 |
| DSIT | 2,834 | 384 |
| Government Digital Service | 1,458 | 297 |
| Central Digital and Data Office | 176 | 135 |
| NISTA | 60 | 35 |

~3,350 candidates across seven bodies. Too many to read, but NISTA and CDDO are small
enough to sweep exhaustively now, and the rest can be filtered against the link graph
first and classified with a cheap model, human-confirmed.

**c. Collections and families.** Subscribing to a publisher-maintained collection
inherits their completeness: when they add a document, we get it. Already used for the
Green Book collection (28 members from one registry entry). The same applies to
enumerable families — gate reviews 0–5, the Service Standard's fourteen points, the
functional standards series.

### The mechanism that makes it sustainable

A `compass discover` command producing **one ranked triage queue** from all four
signals — link graph, org sweep, collection membership, and users' zero-result
questions — where each candidate carries why it surfaced and how strongly.

A human accepts or declines each. Accepted entries go into the registry.

**Declined entries go into `sources/not-in-scope.yaml`, with a reason.** That file is
as valuable as the registry: it stops the same candidate being re-reviewed every
quarter, and it is what converts "incomplete" into a boundary that can be stated out
loud. A short coverage statement per spine — what is in, what is deliberately out, why
— is more honest and more useful to a reader than any completeness claim, and it is
what would make this handoverable to someone else.

---

## 3. Two constraints to decide before investing

### There is an architectural ceiling

Client-side search was the right answer for the current size. It does not scale
indefinitely.

| Corpus | Payload (gzipped) | Browser index build |
| --- | --- | --- |
| Today — 3,306 sections | 1.2 MB | ~370 ms |
| Taking the obvious gaps — ~7,000 | ~2.5 MB | ~800 ms |
| ~10,000 sections | ~3.5 MB | ~1.2 s |
| Beyond that | uncomfortable on mobile | — |

Around 10,000 sections the approach needs changing: a prebuilt index shipped instead of
built on load, per-spine lazy loading, or search back on a server — which would mean
leaving the org's static prototype hosting. Worth choosing the trigger point
deliberately rather than discovering it when a tester on a train gives up waiting.

### Curation is the real cost, and it needs an owner

Automation makes freshness nearly free. Completeness is recurring human judgement. The
registry is the asset, and it currently exists because two of us made it over seven
sessions. The question that matters if this proves useful is not technical: **who
maintains this in six months?** The declined list and the coverage statement are what
would let that be someone else, or let it be opened to contributions.

---

## Suggested sequence

1. **Freshness engine** — about a day. Immediate value, takes a human out of the loop.
2. **Link-graph gap finder** — cheap, and 146 candidates are already waiting.
3. **Triage queue and declined list** — makes human time efficient and scope explicit.
4. **Org sweeps** — once triage exists to absorb the volume.

## The assumption underneath all of this

This plan assumes breadth is what testers turn out to want. At the time of writing,
**no feedback had been received** — the instance was live but Netlify form detection
was still switched off, so nothing was being recorded. Their zero-result questions are
the one signal that says what "in scope" should mean, and they may point somewhere the
link graph does not. Worth having them before investing heavily in breadth.
