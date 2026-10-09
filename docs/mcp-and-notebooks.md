# Serving the corpus to other people's assistants

Written 2026-10-09. A design note, not a decision record. The open decisions are in
the last section.

---

## Why this, why now

Delivery Compass proved that the curated corpus is worth having. It also showed what
people actually want, which is to talk to the guidance, not search it. They want to
ask "we're at outline business case, £40m, mostly digital, what applies now?" and get
an answer that holds the context.

That has been tested already, informally. A NotebookLM notebook loaded with the core
guidance has been in daily use for a couple of months. It works. It has two problems:

1. Keeping it current is manual. Someone has to notice that the Green Book moved, or
   that two risk documents were deleted, and re-upload.
2. Nobody else can use it. It is one person's notebook.

Compass already solves the first problem for itself, and as of this week it does so
on a schedule (see "What is already done" below). The second problem is about
distribution. So rather than build a chat interface of our own, this note proposes
sending the corpus to wherever people already talk to a model.

## The shift, stated plainly

Compass has no model in its answer path. That was its central safety property:
answers are quotes, so nothing can hallucinate. Both options below put a model back in
the path, and the model belongs to someone else.

So "quote, never paraphrase" stops being guaranteed by the architecture. It becomes a
contract we make as easy as possible to keep. We control what goes into the model's
context: the verbatim text, the citation, the date and the warnings. We do not control
what comes out.

That is a real loss and it should be named, not tucked away. It is also the price of
the thing people asked for. A tool that answers in quotes was never going to hold a
conversation.

## One pipeline, two outputs

```
sources/*.yaml ─┐
relations.yaml ─┼─ ingest → watch → export ─┬─ assets/data/*.json ─┬─ the Compass site (as now)
concepts.yaml  ─┘    (weekly, scheduled)     │                       └─ MCP server (new)
                                             └─ doc pack (new) ──────── Drive / SharePoint folder
```

Both outputs read what the export already produces. Neither needs a second ingest,
a second search engine or a second registry. The curation stays in one place.

## Output 1: an MCP server

### What it is

MCP (Model Context Protocol) is the standard way to give an assistant tools. A remote
MCP server is a URL. Point Claude, ChatGPT, Copilot Studio, VS Code or Gemini CLI at
it, and the assistant can call our tools mid-conversation and get back text from the
corpus.

The server never calls a model. It runs search and returns JSON. That matters for
cost (next section) and for hosting: it fits a Netlify Function, the same way the
current site fits static files.

### Tools

Kept small on purpose. Every tool is read-only.

| Tool | Returns |
| --- | --- |
| `search_guidance(question)` | Top sections: verbatim text, heading, citation URL, page date, staleness, and any supersession or conflict warning attached to the result. Plus what was actually searched for, with rare and absent terms marked, as the site does. |
| `get_obligations(source, strength?)` | Extracted obligations for a source, verbatim, each labelled mandatory, recommended, permitted or possible. |
| `get_source(id)` | Registry entry: owner, authority, status, canonical URL, curated relations, known caveats. |
| `coverage()` | The declared boundary: what is in scope, what is registered but not indexed and why, what has no curated relations. |
| `recent_changes(days)` | Change notes in the publisher's own words. |

`search_guidance` reuses `assets/search.js` unchanged. The rule that there is one
search implementation, tested as shipped, extends to the server.

### Keeping it honest from the server side

Five things carry over from Compass, adapted for an answer we do not write.

1. **Warnings travel with the text.** A superseded section never comes back without
   its warning in the same result object. The model cannot fetch the quote and miss
   the banner.
2. **Mandatory text is labelled at source.** Obligations arrive pre-labelled, so the
   model is not inferring strength from modal verbs.
3. **Empty results say what they mean.** No match returns "this is a gap in a curated
   corpus, not evidence that no rule exists", plus the coverage list. An empty array
   invites the model to fall back on what it half-remembers.
4. **Server instructions.** MCP lets a server send standing instructions: quote
   mandatory requirements verbatim, cite the heading link, repeat any warning, and
   say when the corpus has nothing. Most clients follow these well. None is forced to.
5. **Everything is dated.** Every result carries the page date and the corpus refresh
   date, so "current" is a claim the model can repeat with evidence.

### Who can use it

Most enterprise assistants now accept remote MCP servers, but nearly all of them need
an admin to allow a custom connector. In a department, that admin is IT, and the
approval is the real barrier, not the technology. Check the current state of each
client at build time, because this moves monthly.

As far as I know, NotebookLM and the consumer Gemini app do not take MCP servers. That
gap is what the second output is for.

### What we would lose, and how to keep it

Compass's most valuable output is the questions that return nothing. With MCP, the
conversation happens in someone else's product and we never see it.

What we can see is the query the model sends to `search_guidance`. Logging only that
(no conversation, no user identity) keeps the zero-result signal. It is still a
question someone typed, rewritten by a model, so it may contain project details.
Testers need telling, as they are told now.

## Output 2: a doc pack for notebooks

### What it is

A set of documents, regenerated on every refresh, written so that a notebook tool
working only from the files still gets the warnings and the labels.

- One document per source (or per spine, where the notebook has a source limit),
  opening with a header: owner, authority, canonical URL, page date, refresh date.
- Sections with their original headings and a link back to GOV.UK.
- A SUPERSEDED or CONFLICT banner as the first line of any affected section, in the
  text itself. A notebook can't drop a warning that is part of the source it is
  reading.
- Obligations marked inline: `[MANDATORY]`, `[RECOMMENDED]` and so on.
- A "start here" document stating scope, the not-indexed list and the gaps. The
  notebook can then cite the boundary rather than guess at it.

### Delivery

Start with the simplest version that tests the idea: markdown files built by the
export, attached to the refresh run or committed to a folder. Load them by hand into
the existing notebook and compare it with the hand-built one that has been in use.

If that holds up, push the pack to a shared Google Drive folder (for NotebookLM and
Gemini) and a SharePoint or OneDrive folder (for Copilot Notebooks).

### Things to check before relying on it

- **Does NotebookLM re-read Drive sources?** My understanding is that URL sources are
  a snapshot taken when they are added, and Drive sources need a manual sync click.
  If so, "always current" really means "one click from current".
- **Copilot Notebooks and SharePoint.** Whether a referenced file is re-read on
  change, and whether a folder in our tenant can be shared into a government tenant
  at all. The second may rule it out.
- **Source limits.** Notebook tools cap source count and size per notebook. The
  corpus is about 3,300 sections, so it needs grouping, not one file per page.

### What it cannot do

No feedback signal at all. No query logging, no way to know what people asked or what
the pack failed to answer. Shipping it without the MCP server would mean flying blind.

## Licensing

Most of the corpus is OGL, which allows redistribution with attribution. Every
document and every tool result carries the attribution line and a link to source.

NAO content is not OGL. It stays link-only in both outputs, exactly as in Compass.

## Costs, and who carries them

| Cost | MCP server | Doc pack | Who pays |
| --- | --- | --- | --- |
| Model inference | In the user's assistant | In the user's notebook tool | The user's organisation, through licences it already holds. Nil extra on a flat seat; pence per question on a metered API. |
| Hosting | One small function, no model | Storage in a shared folder | Us. Free or close to it at tester scale. |
| Refresh | The weekly Action, already running | One more export step | Us. Negligible minutes. |
| Curation | Shared | Shared | Us. The only cost that grows. |
| Approval | Admin approval of a custom connector | Lower: they are files | The user's department, in time rather than money. |

The short version: their licences pay for the thinking, we pay for keeping it right.

## What is already done

**The refresh is automated.** `.github/workflows/refresh.yml` re-ingests every source
weekly from a clean database, runs the golden suite, commits and deploys. A dry run
from an empty database took under a minute and matched the live corpus.

It also turns curation into a queue rather than a memory test. Anything a person has
to decide (a moved slug, an unexpected withdrawal, a source gone empty, a new change
note on a page with curated relations) becomes a GitHub issue. A failed run raises an
issue too, and the site keeps last week's corpus. Details are in DEPLOY.md.

That fixes the first of the two notebook problems for every output, not just the
site.

## Suggested order

1. **MCP server, three tools, behind a token.** `search_guidance`, `get_source`,
   `coverage`. Try it with two or three testers in whichever assistants their
   departments already allow. This is the part that reaches other people and keeps
   the feedback loop.
2. **Doc pack as markdown.** Compare it against the hand-built notebook. Cheap, and
   the comparison is the evidence.
3. **Triage the conflict sweep.** Already second on the HANDOVER list and more urgent
   now. A model will happily blend two contradicting documents into one confident
   paragraph unless a curated edge puts the warning in its context.
4. **Then decide** whether to automate the pack into Drive and SharePoint, and whether
   the remaining two MCP tools earn their place.

## Open decisions

- **Who can connect?** Options are a shared token (simple, matches the current Basic
  Auth), per-tester tokens (lets us revoke one person), or no auth at all. The content
  is public guidance and the curation is the asset, so open access is defensible, but
  it also means anyone can see the curation. MCP clients differ in what auth they
  support, which may make this choice for us.
- **Do we log tool queries?** I recommend yes, query text only, with testers told.
  Without it the MCP server has no feedback loop.
- **How long does this live?** The prototype pathway switches off on 2027-01-15. A
  server that other people's assistants depend on is a service, and a service needs
  an owner past that date, or a clear statement that it doesn't have one.
- **Who curates?** Unchanged, and still the real cost. Weekly issues make the work
  visible. They do not do it.
