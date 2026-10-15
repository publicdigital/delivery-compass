# WP4: Curated relationships

2026-10-15, branch `go-live-sources`. Under decision D10 as Oli changed it, an edge is
**added** when the source text states it outright, and **proposed** here otherwise.
Each proposal needs Oli's yes or no before it goes into `sources/relations.yaml`.

## Added (stated outright in the source text)

All 11 are in `sources/relations.yaml` with the quote as `evidence`.

| From | Type | To | On |
|---|---|---|---|
| `gate-review-0` | gates | `business-cases` | programme business case approval points |
| `gate-review-2` | gates | `business-cases` | Outline Business Case approval |
| `gate-review-4` | requires | `business-cases` | an approved Full Business Case before going live |
| `gate-review-4` | requires | `magenta-book` | an approved evaluation plan |
| `govs-005` | requires | `service-standard` | "Services shall be delivered in accordance with the Service Standard" |
| `tcop` | elaborates | `govs-005` | expectations for technology decisions |
| `ddat-playbook` | requires | `tcop` | technology design and data sharing |
| `ddat-playbook` | requires | `service-standard` | service assessments |
| `ddat-playbook` | elaborates | `sourcing-playbook` | sourcing digital, data and technology |
| `consultancy-playbook` | elaborates | `sourcing-playbook` | sourcing consultancy |
| `integrated-assurance` | feeds | `tap` | IAAPs submitted for Treasury approval |

Already present, so not re-added: `business-cases` requires `green-book`, `tap` gates
`business-cases` (the plan asked for both).

## Proposed: Oli to decide

### P1. `spend-controls` supersedes `ddat-playbook` on digital and technology spend control. **Recommended: yes.**

The same supersession as TCoP, and it would make the DDaT Playbook carry a warning.

- DDaT Playbook (2023), "DDaT assurance: Technology Code of Practice": "Compliance with
  this code is assured through the Cabinet Office spend control process".
- Service Manual (2026-04-01): "Digital and technology spend controls were replaced on
  1 April 2026."
- Proposed: `effective: 2026-04-01`, `severity: high`, scope "who assures TCoP
  compliance and approves digital and technology spend". The rest of the playbook is
  unaffected. The *commercial* spend control it also describes is a different control,
  and nothing in the corpus says that one changed.

### P2. `spend-controls` conflicts with `gate-review-4` on technology spend control. **Recommended: yes, as `conflicts` with medium severity.**

Gate 4 was republished on **2026-08-20**, after the change, and still asks for it.

- Gate 4 workbook, 4.2: "Cabinet Office (CO) controls have been sighted on the FBC and the
  project has satisfied the CO controls teams commercial and technology spend control
  requirements."
- Service Manual (2026-04-01): digital and technology spend controls replaced.
- `conflicts`, not `supersedes`, because Gate 4 is the newer page: either NISTA's
  wording is stale or a technology control survives in some form. The library can say
  the two disagree, not which is right.

### P3. `benefits-assurance` elaborates each gate review (0 to 5), on benefits evidence. **Recommended: yes.**

The guide has a section per gate saying what benefits evidence that gate needs, e.g.
"Gate 4. Benefits slogan: 'Work to realise' … Documents required (for benefits): Most
up-to-date approved business case". Six edges. Proposed rather than added because six
near-identical edges change how dense the Map is; if yes, all six go in.

### P4. Each gate review requires `integrated-assurance`, on the IAAP. **Recommended: no.**

Every gate workbook says: "This requires management to map their assurance needs in an
Integrated Assurance and Approvals Plan (IAAP)". True, but it is boilerplate repeated in
all six workbooks, and the business case guide says the same ("11.10 Practitioners
should develop an integrated assurance and approval plan (IAAP)"). P5 below captures it
once.

### P5. `business-cases` requires `integrated-assurance`, on assurance planning. **Recommended: yes, as `requires`.**

Business case guidance, 11.10: "Practitioners should develop an integrated assurance and
approval plan (IAAP)." "should" in a mandatory guide, so `requires` is a judgement.

### P6. `govs-002` assured_by each gate review, on the lifecycle's decision points. **Recommended: no, for now.**

Each workbook says: "Refer to the Government Functional Standard for Project Delivery for
more information on the project delivery lifecycle and key decision points." That points
the reader to GovS 002; it does not say the gates assure it. GovS 002's own text would
settle it, and the library cannot read it (WP1). Revisit if Government Project Delivery
provides an open copy.

### P7. `govs-005` requires `data-ethics`. **Recommended: yes, as `requires`.**

GovS 005 v2.2, 7.2: "organisations should use the Data and AI Ethics Framework to ensure
data and AI are used appropriately, responsibly and transparently". "should" in a
mandatory standard, so `requires` is a judgement.

### Not proposed: `ddat-playbook` and `agile-assurance`

The plan asked for this link "where the text supports it". Neither document names the
other, so no edge.

## Gaps in existing edges (for a later pass)

15 of the 27 edges that existed before WP4 have no `evidence` line, against the rule at
the top of `relations.yaml`: `green-book-health`, `green-book-environment` and
`green-book-mcda` elaborates `green-book`; `publishing-business-cases` and
`agile-business-case` elaborates `business-cases`; `govs-002` requires `business-cases`;
`nista-assurance-toolkit` assured_by `govs-002`; `gate-review-1` gates `business-cases`;
`gate-review-3` gates `tap`; `gate-review-5` feeds `magenta-book`;
`service-standard` elaborates `service-manual`; `tcop` requires `secure-by-design`;
`ai-playbook` requires `data-ethics`; `magenta-book` feeds `green-book`;
`nista-annual-report` assured_by `govs-002`. Most can be evidenced from text now in the
corpus; the three that involve GovS 002 cannot, since its text cannot be read.

## Oli's decisions (2026-10-15)

Approved and added: **P1, P2, P3, P5, P7** (10 edges). Declined: **P4, P6**.

Adding P2, the first `conflicts` edge where the target is the *newer* page, showed
that every surface worded a conflict as "out of date … current position is in". That
claims to know which side is right. The MCP server, the web page and the CLI now say
the two sources "disagree" for `conflicts`, and keep "out of date" for `supersedes`.
This also changes how the existing `spend-controls` / `agile-business-case` conflict
reads.

## Result

48 relationships (27 before WP4). Sources with no curated relationship: **10** (13 at
the WP0 baseline), so the plan's threshold is met, and Gates 0, 2 and 4 are off the
list. Still on it: `project-routemap`, `nista-par`, `nista-action-plan`, `ai-evaluation`, `green-book-collection`, `managing-public-money`, `better-regulation`, `gmpp`, `nao-reports`, `uc-lessons-learned`.

## Found in WP5, proposed

### P8. `service-standard` requires `secure-by-design`, on Service Standard point 9. **Approved by Oli 2026-10-15; added.**

Secure by Design's own About page (security.gov.uk, read 2026-10-15): "The Service
Standard Point 9 (Create a secure service which protects users' privacy) advises
service teams that they must follow the Secure by Design principles." Proposed, not
added, because the Service Standard's text in the corpus does not name Secure by
Design itself, and the Secure by Design page cannot be ingested (it is linked only).
The existing edge `tcop` requires `secure-by-design` has no evidence line either.

## WP3c (after go-live, 2026-10-15): Aqua Book, Rose Book, ATRS

### Added (stated outright in the source text)

| From | Type | To | Quote |
|---|---|---|---|
| `aqua-book` | elaborates | `magenta-book` | Magenta Book 4.4: "The Aqua Book and the Green Book provide further guidance on producing quality analysis for government." |
| `rose-book` | elaborates | `managing-public-money` | Rose Book: "to advise and support organisations in scope with their knowledge asset management and, in turn, fulfil their responsibilities as set out in Managing Public Money" |
| `rose-book` | elaborates | `teal-book` | Teal Book 24.4: "The Rose Book: Knowledge asset management in government provides further guidance on this." |
| `ai-playbook` | requires | `atrs` | AI Playbook, Principle 7: "If you're a central government department or an arm's length body within scope, you're required to use the Algorithmic Transparency Recording Standard (ATRS)." |
| `data-ethics` | requires | `atrs` | Data and AI Ethics Framework: "All central government departments and arm's length bodies that provide public or frontline services, or routinely interact with the general public, must use the ATRS." |

54 relationships. Sources with none: 9 (`managing-public-money` is off the list).

### Proposed: Oli to decide

#### P9. `govs-005` requires `atrs`. **Recommended: yes, as `requires`, matching P7.**

GovS 005 v2.2, 7.1: "Organisations should follow cross-government strategies,
standards and governance for government digital and data, including guidance from the
Data Standards Authority, the Government Data Quality Framework, the Data and AI Ethics
Framework, the Algorithmic Transparency Recording Standard, and relevant security,
privacy and technology standards". "should" in a mandatory standard, the same judgement
as P7 (approved).

#### P10. `rose-book` elaborates `green-book`, on knowledge assets. **Recommended: yes.**

Green Book, "Assets": "The Rose Book provides guidance on how to identify, protect and
exploit knowledge assets." A pointer rather than "further guidance on this", so
proposed, not added. The Rose Book in turn applies Green Book appraisal ("In line with
good practice set out in the HM Treasury's Green Book, such appraisal should be set
alongside a 'do nothing' option").

#### P11. `aqua-book` elaborates `teal-book`, on analysis and data use. **Recommended: yes.**

The Teal Book points to the Aqua Book in about a dozen chapters. The strongest, 24.6.1.4:
"the Government Functional Standard for Analysis and the Aqua Book (requires sign in)
set out standards for data use in analysis, and these should be followed where such
activities are part of the scope of the work."

#### Not proposed: `aqua-book` and `green-book`

The plan asked for this link. The Aqua Book (2025) says "It is also referred to by the
Green Book", but the Green Book's current text (2026 edition, as indexed) does not
mention the Aqua Book at all. The only text linking them is the Magenta Book naming
both as guidance on quality analysis, which supports the `magenta-book` edge above, not
one between these two. No edge.

#### Not proposed: `service-manual` and `atrs`

The Service Manual says "The Algorithmic Transparency Standard helps you outline and
publish this information": a pointer, not a requirement, and it uses an old name.
