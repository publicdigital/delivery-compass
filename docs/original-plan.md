<!--
Preserved for the record: the plan approved at the start of the first session,
2026-08-21. Two of its claims did not survive contact with the corpus - see
section 5 of ../HANDOVER.md. Notably it names the IPA as the owner of GovS 002;
the IPA was replaced by NISTA on 2025-04-01, which the plan itself did not catch.
Do not treat this file as current. HANDOVER.md is the live document.
-->

# Delivery Compass — a navigator for UK government delivery guidance

## Context

UK government delivery guidance is maintained by many bodies with no central coordination: HM Treasury (Green Book, Orange Book, Magenta Book, Better Business Cases), the Infrastructure and Projects Authority (GovS 002), GDS/DSIT (Service Standard, Service Manual, spend controls), the Evaluation Task Force, the Government Risk Profession, the RPC, and the NAO. Delivery people are expected to comply with all of it, find it themselves, and notice when it changes.

The folder contains 15 PDFs as a seed corpus. Investigating them surfaced the problem concretely:

- **The local Magenta Book is superseded.** It is the March 2020 edition. GOV.UK replaced the Magenta Book on 2026-05-14 and has since added *Transparency in Government Evaluation Research (TIGER)* and *Test and Learn*.
- **A major control has been abolished and nothing local reflects it.** The Service Manual now states: *"Digital and technology spend controls were replaced on 1 April 2026… departments are responsible for making most of their own digital and technology spending decisions."*
- **`Project_Business_Case_2018.pdf` is duplicated** (identical byte size to `Project_Business_Case_2018 (2).pdf`) — the classic symptom of a folder used as a guidance store.
- **The corpus covers only one half of "delivery".** These 15 are the HMT/IPA funding-and-assurance spine. The GDS digital spine that delivery teams hit more often is entirely absent.
- **The canonical GovS 002 file no longer lives on GOV.UK** — it redirects to `projectdelivery.gov.uk`. Even the hosting is fragmented.

The outcome: a tool that lets a delivery person ask a question and get a cited, current answer; see how the pieces relate; and be told when something they rely on changes.

**Decisions taken:** thin versions of all three surfaces on one shared pipeline; corpus covering both spines plus the oversight layer; a working local prototype (no infra, no auth, no hosting).

---

## Verified findings that shape the design

These were confirmed against the live APIs during planning, not assumed.

| Finding | Consequence |
|---|---|
| `GET /api/content/<path>` returns `public_updated_at`, `first_published_at`, `details.change_history`, `details.attachments`, `links` | Change detection is a cheap timestamp poll, and GOV.UK gives us **human-authored change notes**. Far better than diffing PDFs. |
| `details.change_history` is rich and real (GovS 002 has 4 entries back to 2018, including a detailed v2.1 note) | The Watch surface can quote the publisher's own words about what changed. |
| `document_type: "redirect"` is returned explicitly for moved pages | Link rot is machine-detectable and is itself a trackable change event. |
| `/api/search.json?filter_organisations=…` works and returns 262 IPA items | Useful for corpus *discovery*, not for retrieval — its relevance ranking is poor (a query for "orange book management of risk" returned "Book your driving test"). Curate the registry; don't search it live. |
| Service Manual guides expose full HTML in `details.body` | The digital spine ingests cleanly with no PDF parsing at all. |
| `nao.org.uk/wp-json/wp/v2/report` exists, with `department`/`topic`/`report_type` taxonomies | The oversight tier is reachable, via a separate fetcher. |
| Naive zlib PDF extraction fails badly on CID-encoded fonts (Magenta Book, Portfolio Risk, policy_appraisal all produced garbage); GOV.UK "print to PDF" files extract as ligature soup | **HTML-first ingestion is mandatory.** PDF is the fallback, and needs a real library. |
| Most of these publications now have official HTML versions | The fallback is rarely needed — prefer HTML wherever the API offers it. |

The single most important architectural consequence: **do not build on the PDFs.** Build on the canonical live sources, and keep the 15 local files as an offline seed and a provenance record.

---

## Architecture

Zero-infra by design: one repo, one SQLite file, no services to run.

```
delivery-compass/
  sources/                  # the curated registry — the real intellectual asset
    funding.yaml            # Green Book, BBC, TAP, Managing Public Money
    assurance.yaml          # GovS 002, IPA assurance, gateway reviews
    risk.yaml               # Orange Book, portfolio annex, risk reporting
    evaluation.yaml         # Magenta Book + supplementary guides
    digital.yaml            # Service Standard, Service Manual, TCoP, Secure by Design, AI Playbook, PSBAR
    oversight.yaml          # NAO, PAC, IPA annual report
    relations.yaml          # hand-curated semantic edges between sources
  pipeline/
    fetchers/               # one module per source type (see below)
    extract.ts              # HTML-first; PDF fallback
    normalise.ts            # → Markdown with stable heading anchors
    classify.ts             # obligation strength, role, lifecycle stage
    graph.ts                # build the relation graph
    snapshot.ts             # hash, store, diff, summarise
    cli.ts                  # compass ingest | index | check | report
  web/                      # Vite + React SPA + thin Hono API
  data/corpus.db            # SQLite: sources, sections, obligations, edges, snapshots
```

**Stack:** Node 24 + TypeScript (already installed). `better-sqlite3` with FTS5 for keyword search. Embeddings stored as blobs with brute-force cosine — at the expected few-thousand-chunk scale this is fast and avoids a native vector extension, preserving the zero-infra promise. Claude API: `claude-opus-5` for answer synthesis, `claude-haiku-4-5` for high-volume classification. GOV.UK Frontend for the UI, because credibility with this audience is part of the product.

**Do not install** PyMuPDF/Python for PDF work — use `pdfjs-dist` in Node to keep one toolchain. It handles the CID-encoded fonts that broke naive extraction.

### Registry entry shape

```yaml
- id: govs-002
  title: Government Functional Standard GovS 002 — Project Delivery
  body: Infrastructure and Projects Authority
  spine: assurance
  authority: mandatory
  fetcher: govuk_publication
  slug: /government/publications/project-delivery-functional-standard
  prefer: html
  local_seed: "Government-Functional-Standard-GovS-002-version-2-1-Formatted.pdf"
  licence: OGL-v3
```

### Fetchers (one interface, `fetch(source) → RawDoc[]`)

- `govuk_content` — `/api/content/<path>`. **Must** handle `document_type: "redirect"`: follow it, record the move as a change event, and update the registry slug.
- `govuk_publication` — content API plus attachment download, preferring HTML attachments over PDF.
- `govuk_collection` — expands a collection into its members. This is how the ~20 Green Book supplementary guides arrive without hand-listing them.
- `service_manual` — Service Standard index plus child guides; `details.body` is real HTML.
- `nao_wp` — `nao.org.uk/wp-json/wp/v2/report`.
- `http_pdf` — bare PDF on a non-GOV.UK host (e.g. `projectdelivery.gov.uk`).
- `local_seed` — the 15 PDFs, for offline fallback and provenance.

### The classification step is the differentiator

The Orange Book and GovS 002 **define their own RFC-2119-style convention in their front matter** — confirmed in the extracted text: *"shall denotes a requirement: a mandatory element; should denotes a recommendation; may denotes approval."*

So obligation strength is a high-precision **regex** extraction against a convention the documents themselves publish — not an LLM guess. That is what lets every answer state plainly whether something is mandatory or advisory, which is the single most useful thing this tool can do and the main guard against giving someone confidently wrong compliance advice.

Use Haiku only for the genuinely fuzzy fields (applicable role, lifecycle stage, thresholds), and store a confidence flag so the UI can hedge appropriately.

---

## The three surfaces

**Ask** — hybrid retrieval (FTS5 + cosine), synthesis with hard citations. Every claim cites `source → section anchor → live URL`, shows mandatory vs advisory, and carries an "as at" date. No citation, no claim. Refuse and say so when the corpus does not cover the question, rather than guessing.

**Map** — the same graph rendered two ways. *By body*: who owns what, which makes the fragmentation visible and is the honest picture of the landscape. *By lifecycle stage*: what bites when, which is the answer to "how does it all fit together". Click a node to see its obligations and sources.

**Watch** — reverse-chronological feed of detected changes, filterable by spine, body and role. Each entry pairs the publisher's own change note with the machine diff. Also flags withdrawals, redirects and new attachments.

### Correctness rules, non-negotiable for this domain

Wrong advice about a mandatory control is the failure mode that would kill trust in this tool.

- Quote mandatory requirements verbatim; never paraphrase them.
- Every answer cites, or declines.
- Show the indexed-at date, and warn when a source has changed since indexing.
- Frame plainly as an aid, not an authority; always link out to the source.
- Log unanswered questions — that log is the roadmap.

---

## Build order

Each phase ends with something demonstrable.

1. **Registry and ingestion.** Fetchers, HTML-first extraction, PDF fallback. Seed with the 15 local files plus ~25 tier-1 sources across both spines. *Demo: a report of what's in the corpus and which local PDFs are stale.*
2. **Index and Ask.** Normalise, chunk by heading, classify `shall`/`should`/`may`, load SQLite, hybrid retrieval, cited answers. *Demo: ask a real question, get a cited answer with mandatory flags.*
3. **Relations and Map.** Curate `relations.yaml`, build the graph, both views. *Demo: the landscape on one screen.*
4. **Snapshots and Watch.** Timestamp polling, diffing, change summarisation. *Demo: the Magenta Book and spend controls changes, found automatically.*
5. **Widen.** Oversight tier (NAO, PAC, IPA annual report), remaining supplementary guidance.

Phases 1–2 are the point of maximum learning. Do not over-invest in 3–5 before putting Ask in front of a real delivery person.

---

## Verification

- **Golden question set** (~20 Q&A with known-correct citations), covering both spines and including at least one question whose answer *changed recently* — "who approves a £50m digital programme?" is the sharpest, because the honest answer changed on 1 April 2026.
- **Retrieval eval:** for each golden question, is the correct section in the top 5?
- **Obligation extraction:** spot-check the `shall`/`should`/`may` classifier against a hand-marked sample of GovS 002 and the Orange Book; precision matters far more than recall here.
- **Change pipeline replay:** run against a known-changed source (Magenta Book, 2026-05-14) and confirm it flags it with the right change note.
- **Redirect handling:** point a fetcher at the known-dead spend-controls URL and confirm it follows, records the move, and ingests the new page.
- **Acceptance demo:** run the tool against this very folder and have it report which of the 15 PDFs are superseded, and what replaced them.

## Risks and honest caveats

- **Corpus breadth versus prototype ambition are in tension.** "Both spines plus oversight" is 60+ sources and real curation work. Mitigation: the registry is designed so adding a source is one YAML entry, and the build order front-loads a tier-1 subset. Expect the oversight tier to remain incomplete at prototype stage.
- **Licensing is not uniform.** GOV.UK content is OGL v3 (confirmed on the Green Book) and safe to reuse. NAO content is not automatically OGL — check before redistributing text rather than linking. Record `licence` per source in the registry from the start.
- **No API is guaranteed stable.** The GOV.UK Content API is documented and stable; NAO's `wp-json` is an undocumented implementation detail that could vanish. Isolate that risk in its own fetcher.
- **This tool cannot be authoritative and should not try to be.** Its value is navigation, currency and cross-referencing — pointing accurately at the source, not replacing it.
