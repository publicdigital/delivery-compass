# Gov Delivery Library: go-live delivery plan

Owner: Oli
Prepared: 15 October 2026
Executor: Claude Code
Status: decisions made 2026-10-15; work on branch `go-live-sources`

---

## 1. Purpose

This plan closes the source gaps in the Gov Delivery Library before it goes live.

When this plan is complete, every gap in the library must be one of these:

- a source that is indexed and searchable, or
- a source that is registered and "not indexed", with a correct reason, or
- a subject that the scope statement says is out of scope.

There must be no gap that the curator does not know about.

---

## 2. Decisions for Oli (complete before work starts)

Claude Code: do not start a work package that depends on an open decision. If a decision is empty, use the default and record that you used it.

| # | Decision | Default | Oli's choice |
|---|---|---|---|
| D1 | Secure by Design: keep as link only, or ingest? | Keep as link only. Update the reason text. | Link only (default). |
| D2 | Aqua Book: add the current edition now, or wait for the new edition? | Add now. Add a watch note for the new edition. | Add now, with a watch note (default). |
| D3 | Rose Book: include? | Include, advisory. | Include, advisory (default). |
| D4 | ATRS (Algorithmic Transparency Recording Standard): include? | Include, if GOV.UK has an HTML edition. | Include if GOV.UK has an HTML edition (default). |
| D5 | Commercial playbooks: which ones? | DDaT, Sourcing, Consultancy. Not Construction. | DDaT, Sourcing, Consultancy (default). |
| D6 | Authority label for the commercial playbooks ("comply or explain") | `mandatory`, with a note that it is "comply or explain". | `mandatory`, noted as comply or explain (default). |
| D7 | Spine for the commercial playbooks | New spine: `commercial`. | New `commercial` spine (default). |
| D8 | Spine for the Aqua Book | `evaluation`. | `evaluation` (default). |
| D9 | Out-of-scope list for the scope statement | NHS-specific guidance, devolved governments, procurement law, functional standards other than GovS 002 and GovS 005. | As drafted (default). |
| D10 | Who approves curated relationships? | Oli. Claude Code proposes only. | **Changed from default:** Claude Code adds a relationship directly when the source text states it outright, with the quote as evidence, and proposes the rest for Oli to approve. |

---

## 3. Rules for Claude Code

1. **Start with discovery (WP0).** Do not change code before you complete WP0.
2. **Do not guess URLs.** Get each document URL from its GOV.UK landing page or the GOV.UK Content API. The URLs in this plan were correct on 15 October 2026. Use them only to confirm.
3. **Use the existing patterns.** The Teal Book is ingested from a PDF. Use the same method for all new PDF sources. Do not write a second PDF pipeline.
4. **Make sure that the licence is OGL v3** before you index a source. If it is not OGL v3, register it as "not indexed" with the reason, as the library does for NAO reports.
5. **Do not invent curated relationships.** The registry is curated by hand. Write proposed relationships to a review file (see WP4). Add them to the registry only after Oli approves them.
6. **Do not change the obligation extraction** (MANDATORY / RECOMMENDED / PERMITTED / POSSIBLE) unless a test fails because of a new source.
7. **Make one commit for each work package.** Use a clear message, for example `WP2: index NISTA August 2026 assurance guides`.
8. **Do not deploy to production.** WP8 stops at the go-live gate. Oli makes the deploy.
   A push to `main` *is* a deploy (and the Monday refresh deploys whatever is on `main`),
   so all work is on the `go-live-sources` branch. At WP8 it becomes a PR; Oli merging
   it is the deploy. (Agreed 2026-10-15.)
9. **If a step fails, stop and report.** Do not use a workaround that changes the scope of the step.

---

## 4. Work packages

Order: WP0 → WP1 → WP2 → WP3 → WP4 → WP5 → WP6 → WP7 → WP8.
WP1, WP2 and WP3 can be done in any order after WP0, but do WP1 first if time is short.

Priority:
- **Must do before go-live:** WP0, WP1, WP3a, WP5, WP6, WP8
- **Should do before go-live:** WP2, WP3b, WP4
- **Can do after go-live:** WP3c, WP7

---

### WP0: Discovery (no changes)

**Goal:** understand the repository before any change.

**Steps:**

1. Find the source registry. Record its file path and format.
2. Find the ingest adapters. Identify:
   - the GOV.UK HTML adapter
   - the PDF adapter that the Teal Book uses (it reads the nightly PDF and links citations to the website chapters)
3. Find how each "not indexed" reason is stored and shown.
4. Find how curated relationships are stored.
5. Find how the `coverage` tool builds its output. Find where a scope section can go.
6. Find how `recent_changes` gets change notes.
7. Find the tests. Run them. Record the result.
8. Find the weekly refresh job and how to run it locally.
9. Find the deploy configuration (Netlify).

**Output:** a file `docs/wp0-discovery.md` with the findings above.

**Acceptance:**
- All tests run, and the baseline result is recorded.
- Oli can read the discovery file and understand where each change will go.

---

### WP1: Index the mandatory sources that are not searchable

**Goal:** make the mandatory sources searchable. These are the highest risk, because users expect answers from them.

| Source ID | Action | Notes |
|---|---|---|
| `govs-002` | Ingest from PDF | Use the Teal Book PDF method. Get the PDF from the GOV.UK landing page for GovS 002. Use the current version only. |
| `business-cases` | Ingest from PDF | HM Treasury combined the project and programme guides into one document on 30 June 2026. Ingest the combined document only. Landing page: https://www.gov.uk/government/publications/guidance-on-developing-business-cases |
| `secure-by-design` | Apply decision D1 | Default: keep as link only. Change the reason to a clear, short statement, for example "Published on the Secure by Design site, not GOV.UK. Linked, not reproduced." |

**Steps:**

1. For each source, get the current PDF URL from the landing page.
2. Ingest with the existing PDF adapter.
3. Make sure that section headings are correct and that citations link to a useful place (page anchor or landing page).
4. Make sure that the obligations are extracted. GovS 002 uses "shall" for mandatory requirements. Make sure that the extractor labels these as MANDATORY.
5. Change the status from "not indexed" to indexed.

**Acceptance:**
- `coverage` shows `govs-002` and `business-cases` as indexed, with a section count.
- A search for "senior responsible owner accountabilities" with `source_id: govs-002` returns GovS 002 sections.
- A search for "five case model" with `source_id: business-cases` returns sections from the combined 2026 guide.
- GovS 002 results include MANDATORY obligations.

---

### WP2: Index the NISTA guides updated in August 2026

**Goal:** index the three NISTA guides that were updated on 20 August 2026. The agile guide is the most relevant source for PD.

| Source ID | PDF found on 15 October 2026 (confirm from the landing page) |
|---|---|
| `agile-assurance` | https://assets.publishing.service.gov.uk/media/6a846dabc9205b515d421e3b/Guide_on_Assurance_for_Agile_Delivery_of_Digital_Services_August_2026.pdf |
| `integrated-assurance` | https://assets.publishing.service.gov.uk/media/6a857c3f54bcee010d51453c/Guide_to_implementing_integrated_assurance_V2.1_August2026.pdf |
| `benefits-assurance` | https://assets.publishing.service.gov.uk/media/6a832e841f783fe89daaa40f/Guide_on_Assurance_of_Benefits_Realisation_in_Major_Projects_V2.1_August_2026.pdf |

**Steps:**

1. Confirm each PDF URL from its GOV.UK landing page.
2. Ingest with the existing PDF adapter.
3. Make sure that the old versions (for example the agile guide v1.2, October 2021) are not indexed.

**Acceptance:**
- `coverage` shows all three as indexed.
- A search for "reviewer with agile delivery experience" returns `agile-assurance`.
- A search for "integrated assurance and approval plan" returns `integrated-assurance`.

---

### WP3: Add new sources

#### WP3a: Must do before go-live

| New source ID | Title | Owner | Spine | Authority | Format | Landing page or document (confirm) |
|---|---|---|---|---|---|---|
| `govs-005` | Government Functional Standard GovS 005: Digital | Government Digital Service | digital | mandatory | HTML, or PDF if the HTML is not the current version | https://www.gov.uk/government/publications/government-functional-standard-govs-005-digital |
| `ddat-playbook` | The Digital, Data and Technology Playbook | Cabinet Office | D7 (default `commercial`) | D6 (default `mandatory`, comply or explain) | Find an HTML edition. If none, use the PDF. | Find from the GOV.UK Commercial Playbooks pages |

**Important for `govs-005`:** version 2.2 was published in September 2026 as a PDF. The HTML edition can still be version 2.1. Compare the version number in the HTML with the PDF. Ingest the current version (2.2). If the HTML is older, use the PDF. Record which one you used.

#### WP3b: Should do before go-live

| New source ID | Title | Owner | Spine | Authority | Notes |
|---|---|---|---|---|---|
| `sourcing-playbook` | The Sourcing Playbook | Cabinet Office | `commercial` | per D6 | HTML updated 6 March 2026: https://gov.uk/government/publications/the-sourcing-and-consultancy-playbooks/the-sourcing-playbook-html |
| `consultancy-playbook` | The Consultancy Playbook | Cabinet Office | `commercial` | per D6 | In the same GOV.UK publication as the Sourcing Playbook. |
| `nista-par` | Project Assessment Review guidance and templates | NISTA | assurance | advisory | https://www.gov.uk/government/publications/project-assessment-review-guidance-and-templates |
| `nista-action-plan` | Assurance of action plan guidance and templates | NISTA | assurance | advisory | https://www.gov.uk/government/publications/assurance-of-action-plan-guidance-and-templates |

#### WP3c: Can do after go-live (apply decisions D2, D3, D4)

| New source ID | Title | Owner | Spine | Authority | Notes |
|---|---|---|---|---|---|
| `aqua-book` | The Aqua Book: guidance on producing quality analysis for government | HM Treasury | per D8 | advisory | The Analysis Function said in May 2026 that a new edition is in progress. Ingest the current edition. Add a watch note. |
| `rose-book` | The Rose Book: guidance on knowledge assets | HM Treasury | funding | advisory | Find the current edition. |
| `atrs` | Algorithmic Transparency Recording Standard | Government Digital Service | digital | mandatory for central government departments (confirm from the source text) | Confirm the current hub page and format before ingest. |

**Steps for every new source:**

1. Make a registry entry with the same fields as the existing entries (ID, title, owner, spine, authority, licence, canonical URL, how it is read, status).
2. Confirm the licence is OGL v3.
3. Ingest with the existing HTML or PDF adapter.
4. If you cannot ingest a source, register it as "not indexed" with a correct reason. Do not leave it out.

**Acceptance:**
- `coverage` shows each new source with the correct spine and authority.
- A search for "comply or explain" with `source_id: ddat-playbook` returns playbook sections.
- A search for "digital and data continuous improvement" with `source_id: govs-005` returns GovS 005 sections.
- The `commercial` spine shows in `coverage` (if D7 is accepted).

---

### WP4: Curated relationships (propose only)

**Goal:** make relationships consistent, and connect the new sources.

**Steps:**

1. Write all proposals to `docs/wp4-proposed-relationships.md`. Do not add them to the registry until Oli approves.
2. For each proposal, give: source, relationship type (use the existing types only, for example `supersedes`, `conflicts`, `requires`, `gates`, `elaborates`), target, a one-line reason, and the section of the source text that supports it.
3. Propose relationships for:
   - Gate Reviews 0, 2 and 4. They have no curated relationships, but Gates 1, 3 and 5 have them. Use Gates 1, 3 and 5 as the pattern.
   - `govs-002`: link to `teal-book` (already exists, `teal-book` elaborates `govs-002`), and to the gate reviews and `nista-par` where the text supports it.
   - `govs-005`: link to `service-standard` and `tcop`.
   - `ddat-playbook`: link to `tcop`, `service-standard`, `spend-controls` and `agile-assurance` where the text supports it.
   - `business-cases`: link to `green-book` and `tap`.
   - `aqua-book`: link to `green-book` and `magenta-book`.
4. Do not propose a relationship that the source text does not support.

**Acceptance:**
- Oli approves or rejects each proposal.
- After approval, the count of sources with "No curated relationships" in `coverage` is lower than 13, and Gates 0, 2 and 4 are not in that list.

---

### WP5: Metadata corrections

**Goal:** correct metadata that is out of date.

**Steps:**

1. **Owner names.** Change "Central Digital and Data Office" to "Government Digital Service" for these sources, after you confirm the current owner on each GOV.UK page:
   - `tcop`
   - `secure-by-design`
   - `data-ethics`
2. **GMPP.** From 1 April 2026 the GMPP decreased from more than 200 projects to approximately 80. Make sure that the `gmpp` source reads the current portfolio list. If it does not, update the source.
3. **Search for other uses of "CDDO"** in the registry and in the server text. List them. Change only the owner fields. Report any other uses to Oli.

**Acceptance:**
- No owner field shows "Central Digital and Data Office" unless the GOV.UK page still shows it.
- `get_source gmpp` shows the post-April 2026 portfolio.

---

### WP6: Scope statement

**Goal:** make all remaining gaps visible and intentional.

**Steps:**

1. Add an "Out of scope" section to the `coverage` output. Put it after the spine list and before the "No curated relationships" section.
2. Use the list from decision D9. Draft text (Oli to confirm):

   > **Out of scope (by design)**
   > This library covers UK central government delivery guidance. It does not include:
   > - NHS-specific guidance (for example DTAC, DCB0129, DCB0160, the NHS service standard)
   > - Guidance from the governments of Scotland, Wales or Northern Ireland
   > - Procurement law, including Procurement Act 2023 guidance
   > - Government functional standards other than GovS 002 (Project Delivery) and GovS 005 (Digital)
   > If your question is about one of these subjects, no result from this library does not mean that no rule applies.

3. Add the same text to the README or the public description of the connector.

**Acceptance:**
- `coverage` shows the "Out of scope" section.
- The README has the same text.

---

### WP7: Watch list

**Goal:** record items that can change the library soon.

**Steps:**

1. Make `docs/watch-list.md` with these items:

| Item | Why it matters | What to do when it is published |
|---|---|---|
| New NISTA assurance framework for major projects | NISTA planned to include evaluation in a new assurance framework (September 2026). It can change or replace the gate review guidance. | Check if it supersedes any gate review. Add `supersedes` relationships. |
| New edition of the Aqua Book | The Analysis Function is updating it. | Replace the `aqua-book` source. |
| MOD Evidence-Led Assurance, Parts 2 and 3 | Part 1 launched in October 2026. It is about continuous assurance for software delivery. | Decide if it is in scope (it is specific to defence). |

2. If the refresh job can alert on new publications from NISTA and HM Treasury, record how. Do not build an alert in this plan.

**Acceptance:**
- The watch list file exists.

---

### WP8: Verification and the go-live gate

**Goal:** prove the changes work before Oli deploys.

**Steps:**

1. Run all tests. All tests must pass.
2. Run a full refresh locally.
3. Run `coverage`. Compare with the baseline from WP0. Record the changes in source count, indexed count, section count and mandatory obligation count.
4. Run these acceptance searches. Record the top result for each:

| # | Query | Expected source in the top 3 |
|---|---|---|
| 1 | senior responsible owner accountabilities | `govs-002` or `teal-book` |
| 2 | five case model | `business-cases` or `green-book` |
| 3 | reviewer with agile delivery experience | `agile-assurance` |
| 4 | integrated assurance and approval plan | `integrated-assurance` |
| 5 | benefits realisation assurance | `benefits-assurance` |
| 6 | comply or explain digital procurement | `ddat-playbook` |
| 7 | digital functional standard | `govs-005` |
| 8 | project assessment review | `nista-par` |
| 9 | Teal Book principles | `teal-book` |
| 10 | NHS clinical safety DCB0129 | No indexed result. The out-of-scope note is visible in `coverage`. |

5. Make sure that every source in `coverage` is one of these: indexed, "not indexed" with a correct reason, or withdrawn.
6. Write `docs/go-live-report.md` with:
   - the before and after counts
   - the results of the acceptance searches
   - the decisions that used a default
   - the open items and the watch list

**Go-live gate:** stop here. Oli reads the report and makes the deploy.

---

## 5. Definition of done

- All "Must do" work packages are complete.
- All tests pass.
- The go-live report exists and Oli approved it.
- Every gap is indexed, registered with a reason, or in the out-of-scope statement.
