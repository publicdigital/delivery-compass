# Delivery Compass

A prototype navigator for UK government delivery guidance: ask a question and get a
cited, current answer; see how the pieces relate; be told when something changes.

**Read [HANDOVER.md](HANDOVER.md) before doing anything substantive.** It carries the
original brief, the decisions taken, what we learned about the domain, corrections to
the original plan, the progress log, and the open decision on making this useful for
others (§7). Re-deriving that context is expensive.

## Running it

Node 24 only — uses built-in `node:sqlite` and native TypeScript execution. Two
dependencies, both pipeline-only: `yaml`, and `pdfjs-dist` for the Teal Book. Nothing
the browser or the MCP function loads uses either. No build step, no API key.

```bash
npm install && npm run refresh
```

`refresh` = ingest, watch, export, test. Then preview the actual static site:

```bash
npm run serve
```

Deploying: **[DEPLOY.md](DEPLOY.md)**. Static files on Netlify behind HTTP Basic Auth,
via the `publicdigital` prototype pathway. Pushing to `main` is the deploy.

```bash
npm test                                   # golden suite, both search engines
npm run compass -- feedback import <csv>   # load a Netlify Forms export, then report
```

`npm run compass -- <ingest|ask|watch|map|list|conflicts|verify|feedback|expand>`

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

**Feedback is the one irreplaceable thing here.** On the hosted instance it goes to
Netlify Forms (two forms, declared as hidden markup in `index.html` — Netlify finds
them by parsing deployed HTML, so they must stay real elements). `compass feedback
import` pulls a CSV export back into the local database so the reporting works on it.
Never put feedback in `corpus.db`: the corpus is regenerated on every refresh.

**Questions are batched per session, not sent one by one.** The free tier allows 100
form submissions a month. Batching keeps the denominator — how many questions were
asked at all — which is what makes a zero-result count mean anything.

**There is no build step on the deploy.** The org workflow runs `netlify deploy --dir=.`
over the repo as-is. That is why `assets/data/*.json` is committed, why the client is
plain `.js` rather than TypeScript, and why the export refuses to write a corpus below
its floors — that check is now the last line of defence, with no `/healthz` behind it.

**One search implementation, not two.** `assets/search.js` is loaded unchanged by the
browser, imported by the golden test in Node, and imported by the MCP function. `pipeline/search.ts` is kept only as
the reference the suite compares against. Do not let them drift into two live engines.

**No inline `style=` attributes or inline `<script>`/`<style>` in anything the browser
loads.** The CSP in `netlify.toml` forbids both, and a nonce cannot whitelist a style
attribute in any case. They render perfectly against the local dev server, which sends
no CSP, and are silently dropped in production — the map's legend swatches shipped grey
this way. Broken twice now, so `test/csp.test.ts` checks `index.html` and every file
in `assets/` on each `npm test`. Use a class.

**HTML-first ingestion.** Never parse the seed PDFs into the corpus. Several are
CID-encoded and extract as garbage; two are print-outs of web pages. A source with no
HTML edition is skipped and reported, not guessed at.

**Committed snapshots, as a last resort** (`snapshot_pdf`, files in `data/snapshots/`).
For a document that is public but that no script can fetch: GovS 002 and its CIAF,
whose only download link is behind the Cloudflare challenge. Oli downloads the PDF by
hand; it is committed and read like any checked PDF. It does **not** update itself, so
the registry keeps its GOV.UK `slug`: a new version noted there raises the weekly
curator issue, and someone downloads it again and bumps `snapshot.version` and
`snapshot.taken`. Never use this for a document a script can fetch, and never for one
that is not public.

**PDFs, where they have been checked.** All PDF reading goes through one reader,
`pipeline/fetchers/pdf.ts`, with two callers: the Teal Book (below) and `govuk_pdf`
(`fetchers/govuk-pdf.ts`), for GOV.UK publications whose only edition is a PDF. A PDF
is registered only after checking by hand that it extracts as clean text
(`docs/wp0-discovery.md` §3 shows how). `govuk_pdf` takes whichever PDF the landing
page carries on each run, so new versions arrive by themselves; citations link to the
PDF at `#page=N`. Do not add a second PDF pipeline: extend this one.

**The Teal Book** (`teal-book`, `pipeline/fetchers/projectdelivery.ts`).
It is not on GOV.UK, and projectdelivery.gov.uk answers non-browser requests for its
pages with a Cloudflare challenge. **Never try to get past that challenge** (a browser
user agent, a headless browser, a solver): it is the publisher saying no. What it does
serve openly is a PDF of the whole book, regenerated nightly from the web pages by
wkhtmltopdf, with a full heading outline. That PDF extracts cleanly, which is the
thing the rule above protects. Citations go to the chapter web pages with a
`#:~:text=` fragment, never to the PDF. Its change detection is a hash of the text,
kept in the committed `data/offsite-state.json`, because the runner starts with an
empty database and the PDF's own date moves every night.

**Be polite to GOV.UK.** 150ms between API calls. It is a public good.

**NAO content is not OGL.** Link it, never redistribute extracted text.

## Architecture in one paragraph

`sources/*.yaml` is a curated registry of 42 sources across six spines; it is the real
intellectual asset. `sources/relations.yaml` holds hand-curated edges between them —
GOV.UK models documents, not relationships, so nothing there is derivable. The
pipeline fetches HTML via the GOV.UK Content API, splits on headings into anchored
sections, extracts obligations by modal verb, and stores everything in one SQLite file
with FTS5. `pipeline/conflicts.ts` proposes candidate cross-source conflicts for human
review (`compass conflicts`); it does not curate them itself. `pipeline/export-static.ts`
then flattens all of it — including every query-independent enrichment — into
`assets/data/*.json`, which is what the deployed site actually reads. The UI serves
three surfaces: Ask, Map, and Watch. (A fourth surface, "Your folder", compared the seed PDFs
against live GOV.UK; removed 2026-08-21 once the tool's aim settled on serving other
people from live guidance, not comparing one person's local downloads. See
HANDOVER.md §7.)

## The MCP server

`netlify/functions/mcp/` serves the same corpus to other people's assistants (Claude,
Copilot, ChatGPT and anything else that speaks MCP) at `/mcp`. Design and reasoning:
[docs/mcp-and-notebooks.md](docs/mcp-and-notebooks.md). Four read-only tools:
`search_guidance`, `get_source`, `coverage`, `recent_changes`.

- **Plain JS, no packages.** The deploy installs nothing, so the protocol is
  hand-written in `core.mjs` (JSON-RPC: initialize, ping, tools/list, tools/call) and
  the function reads `assets/data/*.json` via `included_files`.
- **The model writes the answer now, not us.** So the honesty rules are enforced on
  what goes *in*: warnings travel in the same result as the text they apply to, every
  result is dated, MANDATORY lines are verbatim, empty means "gap". `test/mcp.test.ts`
  checks each of these. Do not add a tool that returns text without its warnings.
- **Own auth.** The Basic Auth edge function lets `/mcp` through (assistants cannot
  answer a password prompt) and the function checks its own key, as `?key=` or a
  Bearer token. Keys and their group labels live in the `MCP_KEYS` environment
  variable; without it, `mcp.mjs` falls back to the testers' key (as a SHA-256 only)
  and the published trial key. Never commit a key: a push of one was blocked once
  already. The per-request log line must never carry a key, the URL or tool arguments.
- Locally, `npm run serve` routes `/mcp` to the real handler.

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
