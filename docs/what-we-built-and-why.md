# Delivery Compass: what we built, and why

Written 2026-10-08, after eight working sessions, with the prototype live and in front
of testers. The last section is the one that travels: what this taught us about
building a trustworthy navigator for any fragmented, changing body of rules.

---

## 1. In one paragraph

Delivery Compass answers questions about UK government delivery guidance by quoting
it, never by summarising it. It holds 41 curated sources across six spines, of which
30 are indexed: 3,306 sections and 4,511 extracted obligations, 564 of them mandatory.
It says whether something binds you or merely advises you, cites every claim to the
exact heading on GOV.UK, warns when one document has been overtaken by another, and
shows what changed and when in the publisher's own words. It is roughly 4,000 lines of
code with one runtime dependency, it uses no language model at any point, and it ships
as static files behind a password.

Live at `publicdigital-delivery-compass.netlify.app`. Switch-off 2027-01-15.

## 2. The problem

UK delivery guidance is maintained by eleven different bodies with no central
coordination: HM Treasury, NISTA, GDS, CDDO, DSIT, DBT, the Evaluation Task Force, the
NAO, DHSC and individual departments. A delivery team is expected to comply with all
of it, find it themselves, and notice when it changes.

Three things follow, and we met all three inside the first day.

**Nobody can tell you what applies.** There is no index of delivery obligations. The
Green Book collection alone expands to 28 documents; the Service Manual to 144 pages.

**Nobody tells you when something stops applying.** Two documents in the original seed
folder had been deleted from GOV.UK three weeks earlier, with HM Treasury stating they
"no longer fully reflect current Risk Centre of Excellence thinking". Anyone holding a
copy had no way of knowing.

**Nobody reconciles the contradictions.** The Technology Code of Practice still tells
readers to follow the Cabinet Office spend control process. That process was abolished
on 1 April 2026. Both pages are current government guidance. Neither mentions the
other.

## 3. What it does

Three surfaces on one pipeline.

**Ask.** Keyword retrieval over the corpus, returning the guidance's own sentences
with the exact heading cited and a link to GOV.UK. Mandatory requirements are
separated from recommendations. Every quote carries the date of the page it came from.
Where a cited source is known to be superseded, the warning appears above the quote,
not after it.

**Map.** The landscape drawn: 41 documents clustered by spine, coloured by spine,
sized by how much is indexed, with the 26 curated relationships between them. Eleven
of those relationships cross between spines. Thirteen documents have no curated
relationship at all, which the caption states plainly as a gap in our curation rather
than evidence of independence.

**Watch.** Change notes in the publisher's own words, newest first, across every
registered source.

## 4. How it is built

```
sources/*.yaml        41 curated sources. The actual asset.
sources/relations.yaml 26 hand-curated edges: supersedes, conflicts, requires, gates…
sources/concepts.yaml  12 bridges from what people type to what the guidance calls itself
pipeline/             fetch, normalise, classify, index, detect conflicts, export
assets/               the deployed site: client-side search, the map, the data as JSON
test/                 27 hand-marked retrieval cases, plus a CSP guard
```

Ingestion is HTML-first via the GOV.UK Content API, which returns clean markup with
stable heading anchors, publication timestamps and human-authored change notes.
Sections are split on headings, obligations extracted by modal verb, everything stored
in one SQLite file. An export step flattens it all, including every enrichment that
does not depend on the question, into JSON that is committed to the repository.

The deployed site has no server. Search runs in the browser: an index over 3,306
sections builds in about 370ms on load, and a query takes under a millisecond. The
corpus is 1.2MB gzipped.

## 5. Why it is built this way

Each of these started as a decision and became a rule, usually after something went
wrong.

**Quote, never paraphrase.** A tool that summarises a mandatory requirement is a tool
that can get a mandatory requirement wrong. Answers are extractive by construction, so
the rule is satisfied by the architecture rather than by discipline. A side effect
turned out to matter more than the rule: with no model in the answer path, there is
nothing that can hallucinate, and the question "how do we stop it making things up"
never arises.

**Build on live sources, not copies.** The project began with fifteen PDFs. Several
were CID-encoded and extracted as garbage; two were browser print-outs of web pages.
Meanwhile the API had clean HTML, timestamps and change notes for nearly all of it.
The PDFs became a provenance record and nothing more.

**Silence is a claim.** This is the spine of the whole design. Once an interface shows
a SUPERSEDED banner, a reader reasonably infers that no banner means no conflict, and
we had not earned that inference. So: every card carries an age badge even when the
page is recent, because an absent badge would read as "checked, fine". A search that
returns nothing says it is a gap in the corpus rather than an answer. Query expansion
is declared on screen. The map's caption names the thirteen documents with no curated
relationship. The aim throughout is that the tool's confidence never exceeds its
evidence.

**Precision over recall wherever the label is loud.** A missed obligation is a gap. A
false "MANDATORY" is actively misleading. We removed "is/are required to" from the
mandatory markers after finding that seven in ten of its matches meant "needed"
rather than "obliged", and that it was promoting sentences whose real modal was
"should" to a red label.

**One implementation, tested as shipped.** The browser's search module is imported
unchanged by the test suite. The suite therefore certifies the code users run, not a
server-side stand-in that happens to resemble it.

**Fail loudly.** The failure that nearly got us twice is the one that looks like
success. The corpus export refuses to write below defined floors. Ingest exits
non-zero when a source that should carry prose returns none. Both exist because the
Green Book silently emptied itself when GOV.UK moved its URL: ingest reported "no body
content", the previous run's rows stayed in the database, and the health check still
passed.

## 6. What the tool found, which is partly the point

The findings are not a by-product. For a tool whose job is navigation and currency,
they are the output.

- **The Infrastructure and Projects Authority no longer exists.** NISTA replaced it on
  2025-04-01. The IPA's organisation page has not been updated since. Our own approved
  plan named the IPA as the owner of GovS 002 and was wrong on the day it was written.
- **Digital and technology spend controls were abolished on 2026-04-01.** Departments
  now make most of their own digital spending decisions. The Technology Code of
  Practice has not caught up.
- **Two risk documents were deleted from GOV.UK on 2026-07-29** as no longer
  reflecting current thinking, with no public replacement. The material moved to an
  internal intranet. Guidance going behind the firewall is its own finding.
- **The Green Book moved URL on 2026-10-06**, the day before we noticed, taking its
  collection with it.
- **HM Treasury published a Test and Learn guide in May 2026**, 38 sections including
  one called "Adapting governance for Test and Learn". A well-informed practitioner in
  exactly that field had not seen it. Guidance that exists but cannot be found fails
  in the same way as guidance never written.
- **Test, Learn and Grow is a £100m Cabinet Office programme** running three named
  Accelerators, and everything GOV.UK publishes about it is privacy notices. The data
  protection documents exist because the law required them. Nothing else was required,
  so nothing else was written.

## 7. What this taught us about building this kind of thing

This is the part that transfers to a different corpus.

### The curation is the asset, not the code

Four thousand lines of code took eight sessions. It could be rewritten in two. What
could not be rewritten quickly is the registry: which 41 sources matter, which body
owns each, what each one's canonical URL is this week, and the 26 relationships
between them that exist nowhere in any publisher's data.

Publishers model documents. Nobody models the edges. "This supersedes that on this
specific point, since this date" is not a field in any API, and it is the single most
valuable thing the tool knows. It is also entirely hand-made.

Plan for the curation to be the expensive part, give it an owner, and make it
inspectable and arguable rather than buried in code.

### Declare the boundary rather than chase completeness

"Complete" is not reachable for a corpus nobody owns, and claiming it is dangerous:
the closer you get to sounding comprehensive, the more reasonable it becomes for a
reader to treat silence as an answer.

What works instead is a stated scope, measured coverage against it, and a published
gap list. A `not-in-scope` file with reasons is as valuable as the registry: it stops
the same candidate being re-reviewed every quarter, and it turns "incomplete" into a
boundary you can defend.

### The corpus will tell you what it is missing, if you ask

Harvesting outbound links from nine sampled documents found 177 linked pages, of which
146 were not in the registry. Ranked by how often the corpus cited them, the top of
that list was the DDaT Playbook, business case guidance, the Algorithmic Transparency
Recording Standard and the Public Sector Equality Duty. None marginal.

Anything a curated corpus repeatedly points at but does not contain is a gap it is
reporting itself. Cheapest discovery mechanism we found, by a distance.

### Keyword search has one hard limit, and it is vocabulary

Ranking tuning fixes ranking problems. It cannot connect "new ways of funding and
delivering work" to a document called "Test and Learn", because they share no content
word. That is not a bug to be tuned out, it is the boundary of the method.

The two fixes are embeddings or a curated concept map. For a small, inspectable corpus
the curated map won: it is cheaper, it can be read, and unlike an embedding it can be
argued with. Twelve concepts closed most of the gap. The condition is that every
expansion is shown to the user, because a search that quietly looks for words nobody
typed is a different kind of tool.

### Make the search explain itself

The single highest-value interface change was a line showing what was actually
searched for, flagging words that are rare in the corpus or absent from it.

A tester asked about "test and learn accelerators" and got the Treasury's accelerated
approvals process at the top, because "accelerators" stems to a near-unique term and
BM25 rewards rarity. He concluded, reasonably, that the tool had nothing for him. The
corpus in fact held 38 sections on exactly his subject. Seeing "accelerators, 7
sections" in amber next to "test, 435 sections" explains that in a glance and suggests
the fix.

A ranking nobody can explain reads as a ranking that found nothing.

### Users misdiagnose their own failures, generously

The same tester attributed the failure to himself: "I'm probably not the target
audience." He was wrong, and had we accepted it we would have drawn the wrong
conclusion about scope and built the wrong next thing.

Treat a user's explanation of why something failed as a hypothesis to test, not a
finding. Reproduce the failure before accepting the diagnosis.

### Verify in production, not locally

Three bugs were invisible on a development machine and obvious on the deployed site.
Netlify disables form detection by default, so every piece of feedback returned 404
while the site looked perfect. A content security policy that only exists in
production silently dropped inline styles, shipping the map's legend in grey. Both of
those render correctly against a local dev server.

Anything whose failure mode is "looks fine, does nothing" needs checking where it runs
and a test that fails when it regresses. We now have both.

### The hosting shapes the product more than you expect

The target was a static site with short-lived functions. That one constraint moved
search into the browser, put the corpus in version control, removed the language model
entirely, and set a ceiling of roughly 10,000 sections before the approach needs
replacing.

None of those were product decisions and all of them changed the product. Some were
improvements: the browser engine outperforms the original server-side one on our test
set, and committing the corpus made refreshes reproducible. Know the constraint before
designing around it.

### An honest tool is more useful than a confident one

Every instinct in building a search tool pushes towards appearing comprehensive and
authoritative. In a domain where being wrong has consequences, the opposite is the
feature. The things that make this tool worth using are the admissions: this is
superseded, this page is from 2016, no match means a gap in our list, these thirteen
documents have no relationships because nobody has curated them yet.

Users can work with a tool that tells them where its edges are. They cannot work with
one that pretends it has none.

## 8. What it cost, and what it would cost to run

Eight working sessions. Fourteen commits. One runtime dependency. No API keys, no
model inference, no database server, no per-query cost. Hosting is free on the
existing arrangement; the only recurring cost would be the human curation.

Refreshing the corpus is a single local command followed by a commit. It takes about
two minutes, most of it being polite to GOV.UK.

## 9. Where it is weak

- **Conflict curation is thin.** Four curated conflicts. An automatic sweep proposes
  candidates and nobody has triaged them in eight sessions. This matters more now that
  strangers read the absence of a warning as meaning something.
- **Eleven of 41 sources are not indexed**, because GOV.UK publishes only a landing
  page and the substance is a PDF or on another domain. GovS 002, the actual project
  delivery standard, is one of them.
- **Obligation extraction is regex over modal verbs.** Good enough, tuned for
  precision, and it will never catch an obligation expressed as a diagram or a table.
- **No feedback has been collected yet.** Form detection is still switched off, so the
  most valuable output of the user test, the questions people ask that return nothing,
  is currently being discarded.
- **The architecture has a ceiling.** Around 10,000 sections the browser-side approach
  stops being appropriate and needs a prebuilt index, lazy loading or a server.

## 10. The pattern, generalised

Strip out the subject matter and what remains is a reusable shape:

> **A trustworthy navigator for a fragmented, changing body of rules that nobody owns.**

Its components:

1. **A curated source registry** with owner, authority, licence and canonical
   location per source. Hand-made, version-controlled, the actual asset.
2. **Live ingestion** that prefers structured sources, follows moves, and fails
   loudly rather than quietly shipping less.
3. **Claim extraction** with honest strength labelling, tuned for precision wherever
   the label is prominent.
4. **A hand-curated relationship layer** holding what the publishers do not model:
   what supersedes what, what conflicts with what, what gates what. The differentiator.
5. **Change detection** from publisher metadata, reported in the publisher's words.
6. **Extractive answers** with hard citations and no generation in the answer path.
7. **A concept bridge** between how people ask and how the corpus writes.
8. **A declared boundary**: stated scope, published gaps, and an interface where
   silence never reads as assurance.

That shape fits anywhere a body of binding rules is maintained by several
organisations, changes without announcement, and is consumed by people who carry the
consequences of getting it wrong. Regulated industries, clinical guidelines, technical
standards, professional codes, and the internal policy estate of any organisation
large enough to have lost track of its own.

The domain knowledge in this repository is specific to UK government delivery. The
seven lessons in section 7 are not.
