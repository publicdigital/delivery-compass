# Delivery Compass

A prototype navigator for UK government delivery guidance: ask a question and get a
cited, current answer; see how the pieces relate; be told when something changes.

**Read [HANDOVER.md](HANDOVER.md) before doing anything substantive.** It carries the
original brief, the decisions taken, what we learned about the domain, corrections to
the original plan, the progress log, and the open decision on making this useful for
others (§7). Re-deriving that context is expensive.

## Running it

Node 24 only — uses built-in `node:sqlite` and native TypeScript execution. One
runtime dependency (`yaml`). No build step, no API key.

```bash
npm install && npm run compass -- ingest
```

```bash
npm run web
```

Deploying it for other people: **[DEPLOY.md](DEPLOY.md)**. One hosted instance behind
a shared passcode, corpus baked into the image at build time, feedback on a volume.

```bash
npm run verify   # corpus health; the deploy build gates on this
npm run feedback # what users said, and what they asked that returned nothing
```

`npm run compass -- <ingest|ask|watch|map|list|conflicts|expand>`

Tests: `node --experimental-strip-types test/golden.test.ts`

## Rules that matter

**Never paraphrase a mandatory requirement.** Quote it verbatim with a citation to the
exact heading. Answers are extractive by design — that satisfies the rule by
construction. No citation, no claim.

**Never imply currency the tool cannot vouch for.** Page-update dates are indicative,
not proof — the staleness badge on every obligation/section card says so explicitly,
even on fresh pages, rather than letting an absent badge read as "checked, fine".

**No GOV.UK branding.** This does not run on a GOV.UK domain, so no crown, no
logotype, no GDS Transport, no GOV.UK brand palette. It was built that way once and
had to be de-branded. The UI carries an explicit "Unofficial" disclaimer — keep it.

**Feedback is the one irreplaceable thing here.** It lives in its own database
(`pipeline/feedback.ts`, `FEEDBACK_DB`), never in `corpus.db` — the corpus is a build
artefact thrown away on every deploy. Every write is also mirrored to stdout as a JSON
line so a lost volume is not a lost study. Do not merge the two databases.

**A deployed instance must fail loudly, not quietly.** `compass verify` asserts corpus
floors and that the FTS index is populated; the Docker build runs it and fails the
deploy, and `/healthz` returns 503 on the same condition. The failure this exists to
catch is a GOV.UK fetch that has silently started returning less — which otherwise
looks like a healthy service that just answers fewer questions.

**No inline `style=` attributes in `web/index.html`.** The server sends a nonce-based
CSP, and a nonce cannot whitelist a style attribute. Inline styles are silently
dropped in the browser; use a class. This was a real bug, caught only by reading the
console.

**HTML-first ingestion.** Never parse the seed PDFs into the corpus. Several are
CID-encoded and extract as garbage; two are print-outs of web pages. A source with no
HTML edition is skipped and reported, not guessed at.

**Be polite to GOV.UK.** 150ms between API calls. It is a public good.

**NAO content is not OGL.** Link it, never redistribute extracted text.

## Architecture in one paragraph

`sources/*.yaml` is a curated registry of 41 sources across six spines; it is the real
intellectual asset. `sources/relations.yaml` holds hand-curated edges between them —
GOV.UK models documents, not relationships, so nothing there is derivable. The
pipeline fetches HTML via the GOV.UK Content API, splits on headings into anchored
sections, extracts obligations by modal verb, and stores everything in one SQLite file
with FTS5. `pipeline/conflicts.ts` proposes candidate cross-source conflicts for human
review (`compass conflicts`); it does not curate them itself. The web UI serves three
surfaces: Ask, Map, and Watch — all reading from the live-ingested corpus, nothing
reads from a local file. (A fourth surface, "Your folder", compared the seed PDFs
against live GOV.UK; removed 2026-08-21 once the tool's aim settled on serving other
people from live guidance, not comparing one person's local downloads. See
HANDOVER.md §7.)

## The thing to be careful about

Cross-source supersession warnings are the tool's most valuable feature and its
sharpest failure mode. They currently fire on two hand-curated conflicts plus whatever
`compass conflicts` output has been triaged into `relations.yaml` — as of the last
session, still nothing; the sweep proposes candidates but nobody has confirmed one
yet. Because the UI shows warnings, a reader infers that no warning means no conflict
— an inference not fully earned. A staleness badge on every obligation (age of the
source page) now covers the same worry for currency specifically. Do not add features
that deepen the "silence means checked" impression before the conflict-sweep triage
described in HANDOVER.md §7.
