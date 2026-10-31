# Delivery Compass

A prototype navigator for UK government delivery guidance: ask a question and get a
cited, current answer; see how the pieces relate; and be told when something changes.

UK delivery guidance is maintained by ten different bodies with no central
coordination — HM Treasury, NISTA, GDS, CDDO, DSIT, DBT, the Evaluation Task Force,
DHSC, the NAO and individual departments. Delivery teams are expected to comply with
all of it, find it themselves, and notice when it moves.

## Out of scope (by design)

This library covers UK central government delivery guidance. It does not include:

- NHS-specific guidance (for example DTAC, DCB0129, DCB0160, the NHS service standard)
- Guidance from the governments of Scotland, Wales or Northern Ireland
- Procurement law, including Procurement Act 2023 guidance
- Government functional standards other than GovS 002 (Project Delivery) and GovS 005 (Digital)

If your question is about one of these subjects, no result from this library does not
mean that no rule applies.

The MCP server's `coverage` tool shows the same list (`OUT_OF_SCOPE` in
`netlify/functions/mcp/core.mjs`); `test/mcp.test.ts` fails if the two differ.

## Quick start

Requires Node 24 (uses built-in `node:sqlite` and native TypeScript execution — no
native modules, no build step).

```bash
npm install
```

```bash
npm run refresh
```

```bash
npm run serve
```

Then open http://localhost:3000.

To put it somewhere other people can reach it, see **[DEPLOY.md](DEPLOY.md)** — one
hosted instance behind a shared passcode, with feedback capture, deployable with
`fly deploy` and no local Docker.

## Commands

| Command | What it does |
| --- | --- |
| `compass ingest [id\|spine]` | Fetch and index guidance into SQLite |
| `compass ask "<question>"` | Cited, extractive answer |
| `compass watch [days]` | Poll sources and show what changed |
| `compass map` | Who owns what, and how it connects |
| `compass list` | The source registry |
| `compass conflicts [n]` | Ranked candidate conflicts for human review |
| `compass expand <slug>` | Expand a GOV.UK collection into member documents |
| `compass verify` | Assert the corpus is healthy enough to serve (exit 1 if not) |
| `compass feedback [csv\|queries]` | What users of a deployed instance said, and what they asked that missed |

Run as `npm run compass -- <command>`, or directly with
`node --experimental-strip-types pipeline/cli.ts <command>`.

## How it works

**Built on live sources, not the PDFs.** The seed folder proved why: several of
those PDFs are CID-encoded and extract as garbage, and two are browser print-outs of
web pages. Meanwhile GOV.UK's Content API (`/api/content/<path>`) returns clean HTML
bodies with stable heading anchors, plus `public_updated_at` and human-authored
`change_history` notes. Ingestion is HTML-first; a source with no HTML edition is
skipped and reported rather than silently ingested as noise. The one exception is
the Teal Book, which is not on GOV.UK and is read from its publisher's nightly PDF;
CLAUDE.md says why that one is safe.

**The registry is the real asset.** `sources/*.yaml` holds 42 curated entries across
six spines, each with its canonical slug, owning body and licence.
`compass expand <collection-slug>` discovers a collection's member documents for
curation — one call on the Green Book collection surfaces 27 of them — but that's a
manual discovery step, not something ingestion does automatically; most members turn
out to be PDF/DOCX forms and templates rather than guidance worth registering.

**Relationships are hand-curated.** `sources/relations.yaml` holds 26 edges
(`requires`, `gates`, `supersedes`, `conflicts`, …). GOV.UK models documents, not
the relationships between them, so nothing here can be derived automatically. This
is the layer that answers "how does it all fit together" — and the layer that catches
one source being overtaken by another.

**Change detection is a timestamp poll.** No need to download and diff content just
to learn nothing moved. Where something did move, the publisher usually explains why
in their own words, which beats any machine diff.

## The three surfaces

- **Ask** — hybrid FTS5 retrieval with title-affinity boosting. Extractive by
  design: mandatory requirements are quoted verbatim, never paraphrased, and every
  claim carries a deep link to the exact heading. No citation, no claim.
- **Map** — who publishes what, and the curated relationship graph.
- **Watch** — change notes in the publisher's own words, newest first.

All three read from the live-ingested corpus — nothing in the running tool depends on
a local file. (An earlier fourth surface, "Your folder", compared the seed PDFs in
this repo against live GOV.UK; it was removed once the tool's direction settled on
serving other people from live guidance rather than auditing one person's downloads.
The findings it turned up are recorded in HANDOVER.md §4 as domain knowledge, since
they're still true — e.g. two risk documents were withdrawn from GOV.UK on
2026-07-29, and business case guidance was rewritten 2026-06-30.)

Two structural domain changes worth knowing regardless:

- **The IPA no longer exists.** NISTA replaced it on 2025-04-01.
- **Digital and technology spend controls were abolished on 2026-04-01.** Departments
  now make most of their own digital spending decisions.

## Verification

```bash
node --experimental-strip-types test/golden.test.ts
```

21 hand-marked questions across both spines. Currently 21/21 for retrieval and 5/5
for supersession warnings. The test asserts only that the right *source* appears in
the top 5 — ranking within a document is not what this tool must get right. What it
must get right is never presenting superseded guidance without a warning, so those
assertions are strict, and the suite fails if no caveat assertion runs at all.

```bash
node --experimental-strip-types test/classify.test.ts
```

## Honest limitations

- **The RFC-2119 convention is narrower than it looks.** The Orange Book and GovS 002
  declare "shall denotes a requirement" in their front matter, but the Orange Book is
  the *only* ingested source that uses `shall` at all — 15 times. Every other source
  expresses requirements with `must`, in its ordinary sense. So obligation strength
  rests on ordinary modal verbs, not a special scheme. The `declares_convention` flag
  is curated per source, and "must" is flagged as informal phrasing only inside
  documents that declare the convention.
- **Obligation extraction is regex, tuned for precision over recall.** A missed
  obligation is a gap; a false "mandatory" is actively misleading.
- **Actor extraction is best-effort** and returns null rather than guessing.
- **Seven sources are metadata-only** — GOV.UK exposes just a landing-page summary
  because the substance is a PDF with no HTML edition. They are excluded from
  retrieval so a one-line blurb can never be returned as though it were guidance.
  A further five are registered but never ingested (not OGL, no public canonical,
  withdrawn, or off-platform) — every one checked and explained, none a guess.
- **The oversight tier is thin.** NAO content is not OGL, so it is linked, never
  redistributed.
- **Answers are extractive, not synthesised.** No LLM is required or used. Given the
  rule "quote mandatory requirements verbatim", extraction satisfies it by
  construction; synthesis would be an optional layer, not a prerequisite.
- **This is a navigation aid, not an authority.** Its value is currency and
  cross-referencing — pointing accurately at the source, not replacing it.

## Licence and reuse

GOV.UK content is Crown copyright under the Open Government Licence v3.0. Each
registry entry records its own `licence`; NAO material is marked
`redistribute: false` and is linked only.

## What this is and why it is built this way

**[docs/what-we-built-and-why.md](docs/what-we-built-and-why.md)** is the written-up
account: the problem, the architecture, the design rules and the reasoning behind
them, what the tool found about the domain, and what the exercise taught us about
building a navigator for any fragmented body of rules. Section 7 is the part that
transfers to a different corpus.

## Hosted instance

Deployed through the `publicdigital` prototype pathway: static files on Netlify behind
HTTP Basic Auth, with feedback in Netlify Forms. Pushing to `main` is the deploy.
There is no build step, so the exported corpus under `assets/data/` is committed.

Full detail, including how to refresh the corpus and read the feedback:
**[DEPLOY.md](DEPLOY.md)**. Switch-off date: **2027-01-15**.

**When the trial ends (3 December 2026):** open `/report` on the hosted site and use
"Delete the search log" at the bottom. The trial page promises that searches are kept
for no longer than the trial. DEPLOY.md has the rest of the end-of-trial list.
