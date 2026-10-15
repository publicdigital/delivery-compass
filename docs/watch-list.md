# Watch list

Items that could change the library soon. Started 2026-10-15 from the go-live report
(`docs/go-live-report.md` §6), as WP7 of `docs/go-live-plan.md`. Add a row when you learn
of something coming; remove it once it has been dealt with, and say how in HANDOVER.md.

| Item | Why it matters | What to do when it is published | How it will be noticed |
|---|---|---|---|
| New NISTA assurance framework for major projects | NISTA planned to include evaluation in a new assurance framework (September 2026). It may change or replace the gate review guidance. | Check whether it supersedes any gate review, and add `supersedes` relationships (for Oli to approve unless the text says so outright). Register it as a source. | **By hand**, unless NISTA adds it to the assurance review toolkit collection or changes the gate review pages (see below). Sweep NISTA's publications. |
| New edition of the Aqua Book | The plan says the Analysis Function is updating it (May 2026; not checked). Note: the edition on GOV.UK is itself new, first published there 2025-07-30, and calls itself "this new edition". | Replace or update the `aqua-book` source; re-check its owner, authority and the `aqua-book` relationships. | **Automatically** if it replaces the page at `/guidance/the-aqua-book`: the text refreshes and a change note goes in the curator issue. If it moves and the old page redirects, the refresh flags the redirect. If it appears at a new address with no redirect, **by hand**. |
| MOD Evidence-Led Assurance, Parts 2 and 3 | Part 1 launched in October 2026 (per the plan; not checked). It covers continuous assurance for software delivery. | Decide whether it is in scope. It is specific to defence, and the scope statement covers central government guidance. | **By hand.** No MOD source is registered, so nothing in the refresh looks at it. |

## What the weekly refresh notices, and what it does not

The refresh (`.github/workflows/refresh.yml`, Mondays 06:17 UTC) re-reads every
**registered** source and then opens a curator issue if there is anything to review.
It finds out about guidance only from the pages it already knows.

**It notices:**

- **Changes to a registered page.** If GOV.UK's update date moves, the new text replaces
  the old. Any new change note from the publisher is listed in the curator issue
  (`scripts/refresh-report.ts`), because a changed page is the one whose relationships
  may no longer hold.
- **A new version of a document under a registered publication.** A `govuk_publication`
  source takes every HTML attachment on each run, and `govuk_pdf` takes whichever PDF
  the landing page carries, so a replacement edition at the same publication arrives
  without anyone acting.
- **A new member of a registered collection.** `govuk_collection` sources with `expand`
  (the NISTA assurance review toolkit, the Green Book collection) are expanded on each
  run, so a new member is read in. The curator issue shows it only as a change in the
  counts, not by name, unless the collection's own change note mentions it.
- **A registered page that moves, redirects or is withdrawn.** These are flagged for the
  curator, not handled silently.
- **The Teal Book**, by a hash of its text (`data/offsite-state.json`).

**It does not notice:**

- **A new publication at a new address**, from NISTA, HM Treasury or anyone else. Nothing
  sweeps an organisation's output for new guidance. A new NISTA framework, a new Aqua
  Book published as a separate page, or MOD guidance will not appear until someone
  registers it.
- **Anything off GOV.UK** apart from the Teal Book.
- **Guidance that other guidance starts to cite.** Links are dropped at ingest, so the
  "the corpus knows what it is missing" route in `docs/sources-engine.md` §2 is not
  running.

`docs/sources-engine.md` §2 sets out the planned fix: a `compass discover` command that
builds one triage queue from organisation sweeps, collections, the link graph and users'
zero-result questions. It has not been built. The go-live plan said not to build an
alert in WP7.

## Checking by hand until then

`pipeline/list-org.ts` lists an organisation's latest GOV.UK items, newest first. It uses
GOV.UK's search API, so keep it occasional.

```bash
node --experimental-strip-types pipeline/list-org.ts national-infrastructure-and-service-transformation-authority 20
```

Other slugs worth sweeping: `hm-treasury`, `government-analysis-function`,
`civil-service-government-operational-research-service` (the Aqua Book's lead
organisation), `government-digital-service` and `ministry-of-defence` (large: filter by
eye). Verified 2026-10-15: the NISTA slug returns 60 items, the newest dated
2026-09-10, and nothing that looks like a new assurance framework.
