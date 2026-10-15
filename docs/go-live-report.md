# Gov Delivery Library: go-live report

For Oli, at the go-live gate of [go-live-plan.md](go-live-plan.md). Written 2026-10-15
on branch `go-live-sources` after a full local refresh. **Nothing has been deployed.**
Merging the branch to `main` is the deploy.

## Verdict

Ready to go live, with one known gap. Oli accepted acceptance searches #6, #8 and
#10 as they stand (2026-10-15; §3).

- Every "must do" work package is done (WP0, WP1, WP3a, WP5, WP6, WP8), and so is every "should do" one (WP2, WP3b, WP4).
- WP3c and WP7 are deferred to after go-live, as the plan allows.
- All tests pass: golden retrieval 37/37 on the engine that ships, the MCP contract (47 mandatory quotes verified verbatim), CSP and typecheck.
- **Every source is indexed, or registered as "not indexed" with a correct reason, or withdrawn.** The out-of-scope statement covers the rest.
- **Known gap:** GovS 002 cannot be indexed. Its text is only on projectdelivery.gov.uk, behind a bot challenge, so WP1's two GovS 002 acceptance checks fail. The library says why, and points to the Teal Book instead.
- **Accepted by Oli:** the three acceptance searches that did not pass as written (#6, #8 and #10). See §3.

## 1. Before and after

| | WP0 baseline | Now | Change |
|---|---:|---:|---:|
| Registered sources | 42 | 48 | +6 |
| Indexed | 31 | 39 | +8 |
| Sections | 4,182 | 5,062 | +880 |
| Extracted obligations | 6,229 | 8,944 | +2,715 |
| Mandatory obligations | 611 | 850 | +239 |
| Curated relationships | 27 | 48 | +21 |
| Sources with no relationship | 13 | 10 | −3 |
| Spines | 6 | 7 | `commercial` |

**Newly indexed (8):**
- `business-cases`: the combined 2026 guide, PDF
- `agile-assurance`, `integrated-assurance`, `benefits-assurance`: NISTA, August 2026, PDF
- `govs-005`: v2.2, HTML
- `ddat-playbook`, `sourcing-playbook`: HTML
- `consultancy-playbook`: PDF

**Newly registered as not indexed (2):** `nista-par` and `nista-action-plan`, both Word only.

**Data size:** `sections.json` is now 8.5MB, against 5.1MB before the Teal Book. The MCP function loads it on a cold start. The old web page also loads it. It still works, but it is slower.

## 2. Work packages

| WP | Status | Commit(s) |
|---|---|---|
| WP0 Discovery | Done. `docs/wp0-discovery.md` | 9e7e322, 473e07d |
| WP1 Mandatory sources | Done, except GovS 002 (blocked, see verdict) | 9d74b84 |
| WP2 NISTA guides | Done | b2813b4 |
| WP3a GovS 005, DDaT | Done | 94319e3 |
| WP3b Sourcing, Consultancy, PAR, action plan | Done | 55b6e29 |
| WP3c Aqua, Rose, ATRS | **Deferred** (after go-live) | |
| WP4 Relationships | Done. `docs/wp4-proposed-relationships.md` | c06b534, 41fec77 |
| WP5 Metadata | Done | 8809e44 |
| WP6 Scope statement | Done | 7a5e63f |
| WP7 Watch list | **Deferred** (after go-live) | |
| WP8 Verification | This report | (this commit) |

Engineering the plan did not anticipate, each recorded in HANDOVER.md:

- **One PDF reader with two profiles.** It now serves both the Teal Book and GOV.UK publications that exist only as PDFs (`govuk_pdf`). The GOV.UK profile reads whichever PDF is attached on each run, so new versions arrive by themselves.
- **New registry fields:** `not_indexed_reason`, `authority_note` (for "comply or explain"), `exclude_attachments` and `pdf_title`.
- **Three ranking changes, each approved by Oli:**
  - At most two results from any one document.
  - A bonus when a question names a source by its full title.
  - The concept nudge raised from 4 to 5.
- **Conflict warnings now say "disagree".** They no longer say one source is out of date, on every surface: the MCP server, the web page and the CLI.
- **A bug fix:** re-ingesting no longer leaves a source stuck as "landing page only".

## 3. Acceptance searches

Run through the MCP server against the refreshed corpus. Pass means the expected source is in the top 3.

| # | Query | Expected | Rank | Top result | Result |
|---|---|---|---:|---|---|
| 1 | senior responsible owner accountabilities | `govs-002` or `teal-book` | 1 | `teal-book`: Ch. 13, governance and management of programmes and projects | Pass. GovS 002 itself cannot appear (not indexed) |
| 2 | five case model | `business-cases` or `green-book` | 1 | `green-book`: The Five Case Model | Pass. `business-cases` is 3rd |
| 3 | reviewer with agile delivery experience | `agile-assurance` | 1 | `agile-assurance`: Organising a review | Pass |
| 4 | integrated assurance and approval plan | `integrated-assurance` | 1 | `integrated-assurance`: Integrated assurance and approval | Pass |
| 5 | benefits realisation assurance | `benefits-assurance` or `gate-review-5` (widened in WP2) | 1 | `gate-review-5`: Operations Review and Benefits Realisation | Pass, on the widened expectation. `benefits-assurance` is outside the top 5 |
| 6 | comply or explain digital procurement | `ddat-playbook` | 5 | `teal-book`: Ch. 25, how to procure | **Not in top 3.** Oli accepted top 5 in WP3a. The Teal Book's procurement chapter and the Orange Book's "comply or explain" section rank first |
| 7 | digital functional standard | `govs-005` | 1 | `govs-005`: How this assessment framework works | Pass |
| 8 | project assessment review | `nista-par` | none | `benefits-assurance`: Project Assessment Review (PAR) | **Cannot pass.** PAR is Word only and registered as not indexed (WP3b). The benefits guide's PAR section ranks first |
| 9 | Teal Book principles | `teal-book` | 1 | `teal-book`: Scope of The Teal Book | Pass. All top 5 are Teal Book; chapter 1 "Principles" is among them |
| 10 | NHS clinical safety DCB0129 | no indexed result | n/a | `teal-book`: Ch. 7, health, safety and security | **Not as written.** Keyword search always finds something for "clinical safety". No NHS-specific source is returned, and `coverage` shows the out-of-scope note listing DCB0129 |

**Accepted by Oli on 2026-10-15: #6, #8 and #10 stand as they are.**
- #6: the playbook in the top 5 is enough. This confirms the judgement made in WP3a.
- #8: this follows from the WP0 decision to register Word-only sources as not indexed.
- #10: the plan's real aim is met. No NHS-specific source is returned, and `coverage` shows the out-of-scope note.

## 4. Every source's status

| Status | Count | Sources |
|---|---:|---|
| Indexed | 39 | (see `coverage`) |
| Not indexed: off platform, blocks automated access | 2 | `govs-002`, `secure-by-design` |
| Not indexed: Word only | 2 | `nista-par`, `nista-action-plan` |
| Not indexed: PDF that does not extract | 1 | `green-book-health` (specific reason added in WP8; owner corrected to HM Treasury, per GOV.UK) |
| Not indexed: not OGL | 1 | `nao-reports` |
| Not indexed: local copy only | 1 | `uc-lessons-learned` |
| Withdrawn | 2 | `portfolio-risk-annex`, `risk-reporting-guide` |

Every not-indexed reason was read and is accurate. WP8 also fixed a doubled "NOT INDEXED: not indexed:" prefix on the generic reason.

**Indexed, but thin.** Four sources are indexed with only one or two sections, because GOV.UK gives little more than a landing page:
- `green-book-collection` (1 section)
- `nista-assurance-toolkit`, `spend-controls` and `gmpp` (2 sections each)

That is accurate, not a gap: the substance is in the sources they link to. But "indexed" overstates them a little.

## 5. Decisions that used a default

From section 2 of the plan, D1 to D9 all used the default:
- D1: Secure by Design link only
- D2: Aqua Book now, with a watch note (deferred with WP3c)
- D3: Rose Book included (deferred)
- D4: ATRS if HTML (deferred)
- D5: DDaT, Sourcing and Consultancy playbooks
- D6: `mandatory`, comply or explain
- D7: `commercial` spine
- D8: Aqua Book on `evaluation`
- D9: out-of-scope list as drafted

**D10 was changed:** Claude Code adds a relationship that the source text states outright, with the quote, and proposes the rest.

Decisions taken during the work, all by Oli on 2026-10-15:
- GovS 002 not indexed; Oli to ask Government Project Delivery for an openly served copy.
- Word-only sources registered with a reason.
- Playbooks indexed with their HTML guidance notes.
- Owners follow GOV.UK's lead organisation.
- The three ranking changes.
- Four golden expectations widened: agile governance, benefits, comply or explain, and #5.
- WP4 proposals P1, P2, P3, P5 and P7 approved; P4 and P6 declined.

## 6. Open items

**Waiting on Oli:**

1. **GovS 002:** ask Government Project Delivery for an openly served copy. The Teal Book's nightly PDF shows they can do this.
2. **Proposal P8:** Service Standard requires Secure by Design (point 9). Recommended yes; see `docs/wp4-proposed-relationships.md`.
3. **Two conflicts worth raising with the publishers.**
   - The **August 2026 Gate 4 workbook** still asks for technology spend control sign-off.
   - The **DDaT Playbook** (2023) still routes TCoP assurance through Cabinet Office spend control.

   Both now carry warnings in the library. NISTA and GDS may want to know.
4. **"CDDO" in prose:** README.md, `docs/sources-engine.md` and `docs/what-we-built-and-why.md` name CDDO in lists of bodies. These are left as they are.

**Deferred work:**

5. **WP3c:** Aqua Book, Rose Book and ATRS. All three have HTML editions, so this is straightforward. Discovery found that the plan's owners for the Aqua and Rose Books differ from GOV.UK, and that the plan's Rose Book URL is wrong. See `docs/wp0-discovery.md`.
6. **WP7 watch list:**

   | Item | Why it matters | What to do when it is published |
   |---|---|---|
   | New NISTA assurance framework for major projects | NISTA planned to include evaluation in a new assurance framework (September 2026). It may change or replace the gate review guidance. | Check whether it supersedes any gate review, and add `supersedes` relationships. |
   | New edition of the Aqua Book | The Analysis Function is updating it. | Replace the `aqua-book` source (once WP3c has added it). |
   | MOD Evidence-Led Assurance, Parts 2 and 3 | Part 1 launched in October 2026. It covers continuous assurance for software delivery. | Decide whether it is in scope (it is specific to defence). |

   The weekly refresh already raises a curator issue for any change note on a registered source. It cannot see a *new* publication from NISTA or HM Treasury; `docs/sources-engine.md` plans that.

**Follow-ups:**

7. 15 of the older relationships have no evidence quote. They are listed in `docs/wp4-proposed-relationships.md`.

**Known limitations, not blocking:**

8. Teal Book deep links use text fragments. They have not been verified by a real click; the fallback is the right chapter, at the top.
9. The non-gating sqlite reference engine scores 35/37. It has none of the three ranking changes.
10. A single extraction slip: the integrated assurance PDF yields "submion" once.

## 7. Deploying

1. Read this report, and decide §6 item 2 (§3 is settled).
2. Merge `go-live-sources` into `main`. The push to `main` triggers the deploy workflow.
3. Check the live connector: `coverage` should report 39 of 48 sources indexed, with an "Out of scope" section.

The Monday refresh (06:17 UTC) then runs against `main` with the new fetchers. Its first run will rebuild everything from scratch on a clean runner. A failure stops it before anything is committed and opens an issue, so a bad run cannot reach the live site.
