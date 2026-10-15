# WP0: Discovery

Done 2026-10-15 on branch `go-live-sources`, for [go-live-plan.md](go-live-plan.md).
No code changed. Every fact about a source below was read from the GOV.UK Content API
or the publisher's site on that date.

**Headline:** most of the plan is ready to build. One "must do" item is blocked
(GovS 002), and five facts in the plan differ from the live sources. The questions
for Oli are at the end.

---

## 1. Where things are

| Plan asks | Where it is |
|---|---|
| Source registry | `sources/*.yaml`, one list per spine (`assurance`, `digital`, `evaluation`, `funding`, `oversight`, `risk`). Fields: `id`, `title`, `body` (owner), `spine`, `authority`, `fetcher`, `slug`, `licence`, plus optional `endpoint`, `pdf`, `parent`, `external_attachment`, `declares_convention`, `withdrawn_*`. Loaded by `pipeline/registry.ts`. Spine names are a type in `pipeline/types.ts`. |
| GOV.UK HTML adapter | `pipeline/ingest.ts` (`resolveDocs`), over `pipeline/fetchers/govuk.ts` (Content API, 150ms between calls). A publication's HTML attachments are each ingested; PDF-only publications become `metadata_only`. |
| Teal Book PDF adapter | `pipeline/fetchers/projectdelivery.ts`, called from `ingest.ts` for `fetcher: projectdelivery_pdf`. **It is specific to that one PDF** (see §3). |
| "Not indexed" reasons | Not stored per source. `notIndexedReason()` in `netlify/functions/mcp/core.mjs` (line 186) derives the reason from the `fetcher` and from `content_status` (`metadata_only`, set in `ingest.ts`). So the reason for `secure-by-design` is generic text for every `off_platform` source. |
| Curated relationships | `sources/relations.yaml`. Types: `requires`, `feeds`, `assured_by`, `gates`, `supersedes`, `conflicts`, `elaborates`. Each carries an `evidence` quote. 27 today. |
| `coverage` output | `coverage()` in `core.mjs` (line 251): headline counts, then one section per spine, then "No curated relationships" (line 275). The out-of-scope section goes between those two. |
| `recent_changes` | Reads `assets/data/watch.json`, built by `pipeline/export-static.ts` from the latest snapshot's `change_history` per source. GOV.UK sources: the publisher's change notes. Teal Book: our own notes from `data/offsite-state.json`. |
| Tests | `npm test`: CSP check, golden retrieval set (`test/golden.test.ts`), MCP contract (`test/mcp.test.ts`). `npm run typecheck`. |
| Weekly refresh | `.github/workflows/refresh.yml`, Mondays 06:17 UTC: `npm run refresh` (ingest, watch, export, test), commits `assets/data` and `data/offsite-state.json`, **then deploys**, and opens a curator issue if anything needs a person. Locally: `npm run refresh`. |
| Deploy | `.github/workflows/deploy.yml` calls the org's reusable Netlify workflow on every push to `main`. **A push to `main` is a deploy**, so this work stays on the branch until Oli merges. |

## 2. Baseline

Tests: all pass. Golden set 29/29 on the shipping engine; the non-gating sqlite
reference engine 28/29. MCP contract passes (40 mandatory quotes verbatim). CSP clean.

`coverage` on 2026-10-15:

| | |
|---|---|
| Registered sources | 42 |
| Indexed | 31 |
| Sections | 4,182 |
| Obligations | 6,229 (611 mandatory) |
| Curated relationships | 27 |
| Sources with no curated relationship | 13 |

Not indexed today (11): `govs-002`, `agile-assurance`, `integrated-assurance`,
`benefits-assurance`, `business-cases`, `green-book-health` (all "only a landing
page"), `secure-by-design` (off platform), `nao-reports` (not OGL),
`uc-lessons-learned` (local only), `portfolio-risk-annex`, `risk-reporting-guide`
(withdrawn).

## 3. The PDF adapter needs generalising, not just reusing

Rule 3 says to use the Teal Book method for every new PDF. The method carries over;
the code does not, as it stands. The Teal Book reader depends on three things only
that PDF has: it is generated from web pages, it has a complete heading outline, and
every chapter has a web page to cite. I downloaded and tested all five GOV.UK PDFs in
scope:

| Source | Pages | Made with | Outline | Text |
|---|---:|---|---|---|
| `business-cases` | 98 | InDesign | 112 entries; good once Table/Box/Figure bookmarks are skipped | clean |
| `agile-assurance` | 30 | Word | 23 entries | clean |
| `benefits-assurance` | 31 | Word | 13 entries (coarse: one per gate) | clean |
| `consultancy-playbook` | 46 | InDesign | 24 entries | clean |
| `integrated-assurance` | 14 | Word | **none** | clean |

None show the encoding problem that made the seed PDFs unusable. So the plan is to
turn `projectdelivery.ts` into one shared PDF reader with two profiles, not to write
a second pipeline:

- **Shared:** outline to section boundaries, lines to paragraphs, header and footer
  stripping, hashing.
- **Teal Book profile:** as now (chapter URLs, text-fragment anchors).
- **GOV.UK PDF profile:** a new `govuk_pdf` fetcher that reads the registry's GOV.UK
  `slug`, takes the current PDF attachment from the landing page **on every run**
  (so a new version replaces the old one automatically, and old versions are never
  indexed), skips Table/Figure/Box bookmarks, strips lines repeated in the margins
  (page numbers, "OFFICIAL"), and falls back to font-size headings when there is no
  outline (`integrated-assurance`). Citations link to the PDF at the right page
  (`…pdf#page=12`). Change detection needs nothing new: the landing page still gives
  GOV.UK's date and change notes, exactly as for HTML sources.

## 4. Source by source

### WP1

| Source | Finding | Proposed action |
|---|---|---|
| `govs-002` | **Blocked.** GOV.UK lists it only as an external link. The file lives at `projectdelivery.gov.uk/download/66847/` (v2.1, Sept 2025, 2.2MB PDF), and that URL returns the Cloudflare 403 to any script; only a browser gets the file. There is also an HTML edition there, also behind the challenge. No openly served copy, unlike the Teal Book's PDF. | Cannot index without getting past the bot check, which we don't do. See question 1. |
| `business-cases` | **The plan is right; HANDOVER.md §4 is wrong.** One combined PDF, "Guidance on developing business cases for projects and programmes", 98 pages, published 2026-06-30. The change note says the two guides "have been combined into a single document". | Index via `govuk_pdf`. Correct the handover. |
| `secure-by-design` | Still off GOV.UK at security.gov.uk, which blocks scripts. | Link only (D1). Needs a per-source reason field, since reasons are generic today. |

### WP2

| Source | Finding |
|---|---|
| `agile-assurance` | PDF URL matches the plan exactly. August 2026 version only; no old versions attached. |
| `integrated-assurance` | Matches the plan. No outline, so needs the font-size fallback. |
| `benefits-assurance` | Matches the plan. Coarse outline. |

### WP3

| Source | Finding |
|---|---|
| `govs-005` | Updated **2026-10-01** (plan says September). The HTML edition was updated the same day and contains the v2.2 changes (the "government digital and data" wording, 69 times; AI references), so **the HTML is current: use HTML, no PDF needed.** The publication also has the Continuous Improvement Assessment Framework as HTML, which would be ingested too; the plan's acceptance search ("digital and data continuous improvement") suggests that is wanted. |
| `ddat-playbook` | HTML edition exists. **Two HTML copies of the playbook itself** are attached (265k and 218k characters), plus Contracting for Agile and IPR guidance notes. Ingesting all four would index the playbook twice. GOV.UK owner is the **Digital, Data and Technology Profession**, not Cabinet Office. Last updated 2023-06-20. |
| `sourcing-playbook` | HTML exists. GOV.UK owner is the **Government Commercial Agency** and Government Commercial Function. Updated 2026-09-30. The publication carries 15 companion guidance notes, 5 of them HTML; those would be ingested too unless excluded. |
| `consultancy-playbook` | **Not in the Sourcing Playbook's publication** (plan says it is). It has its own: `/government/publications/the-consultancy-playbook`, v1.1, Sept 2022, **PDF only**, clean, 24-entry outline. |
| `nista-par` | Title on GOV.UK is "Project **assurance** review guidance and template". **Word documents only** (.docx). |
| `nista-action-plan` | **Word documents only** (.docx). |
| `aqua-book` | `/guidance/the-aqua-book`, HTML, 122k characters. Owners on GOV.UK: Government Analysis Function, Government Operational Research Service, GAD, ONS, **not HM Treasury** (plan says HM Treasury). |
| `rose-book` | The plan's path does not exist. It is at `/government/publications/knowledge-asset-management-in-government`, 2024 edition, HTML plus annexes A–E. Owner: **Government Office for Technology Transfer** / DSIT, **not HM Treasury**. |
| `atrs` | Guidance at `/government/publications/guidance-for-organisations-using-the-algorithmic-transparency-recording-standard`, HTML (D4 satisfied), GDS, updated 2025-05-08. Whether it is mandatory to be confirmed from the text at ingest. |

Licences: all GOV.UK-hosted, so OGL v3 unless a page says otherwise; checked again
per source at ingest.

### WP5

| Item | Finding |
|---|---|
| `data-ethics` | GOV.UK lists only Government Digital Service. Change the owner. |
| `tcop` | GOV.UK lists **both** Government Digital Service and Central Digital and Data Office. Under the plan's rule this keeps CDDO. See question 4. |
| `secure-by-design` | Off GOV.UK; its site cannot be read by a script, so its current owner cannot be confirmed from GOV.UK. |
| `gmpp` | **Already current.** It indexes the April 2026 data (81 projects, one row each) and the landing page's own statement that the portfolio went "from over 200 projects to 81". No change needed. |
| Other "CDDO" uses | `sources/relations.yaml:45`, inside an evidence quote (historical, leave as is). README and two docs name CDDO in a list of bodies (prose, leave as is; Oli to decide). |

### Not in the plan, noticed

- `green-book-health` is also "not indexed". Its main document, `policy_appraisal_and_health.pdf` (2013), is one of the seed PDFs that extracts as garbage. Leave as is, with a better reason.
- WP8 search #10 ("NHS clinical safety DCB0129" → no indexed result) will probably fail as written: keyword search almost always finds something for "clinical safety". Suggest "no NHS-specific source in the top 3, and the out-of-scope note is visible".

## 5. Questions for Oli before WP1

1. **GovS 002.** It can't be indexed without the bot check letting us through.
   Options: (a) keep it "not indexed" with a clear reason, and point to the Teal Book,
   which elaborates it; (b) also ask Government Project Delivery for an openly served
   copy, as they already offer for the Teal Book; (c) commit a copy downloaded by
   hand (it would not stay current, which breaks the library's main promise).
   Recommended: (a) now, plus (b).
2. **Word-only sources (PAR, action plan).** Register them "not indexed: Word
   document only", or add a .docx reader (a new adapter, which rule 3 discourages).
   Recommended: register with the reason.
3. **Companion documents.** For the DDaT and Sourcing publications, index the
   playbook only, or the playbook plus its HTML guidance notes? Recommended: the
   playbook plus the notes, with the duplicate DDaT HTML excluded.
4. **TCoP owner.** GOV.UK lists GDS first and still lists CDDO. Change it to GDS (the
   lead organisation) or keep CDDO per the rule? Recommended: GDS.
5. **Owners that differ from the plan.** Use GOV.UK's owners (DDaT Profession,
   Government Commercial Agency, Analysis Function, GOTT) rather than the plan's?
   Recommended: yes, per rule 2.
