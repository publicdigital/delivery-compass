# Tool-use eval: after-descriptions

- **In scope, library not named: used on 16 of 16**
- Named the library (control): used on 3 of 3
- Out of scope: said not covered on 3 of 3 (text match, check below)
- Tool calls: search_guidance 27, get_source 5, recent_changes 1, coverage 4

Run 2026-10-29 10:24 UTC with Claude Code (`sonnet`), this MCP server plus WebSearch, WebFetch, no project instructions.

| # | Kind | Question | Library tools called | Other tools |
|---|---|---|---|---|
| 01 | in | Do I need a business case for a £3m digital project? | search_guidance, search_guidance, get_source, search_guidance |  |
| 02 | in | What happens at a Gate 2 review? | search_guidance, get_source |  |
| 03 | in | What does the Green Book say about optimism bias? | search_guidance |  |
| 04 | in | Do I still need GDS approval for digital spend? | search_guidance, recent_changes |  |
| 05 | in | What is the Service Standard? | search_guidance, get_source |  |
| 06 | in | How should we evaluate an AI pilot? | search_guidance, search_guidance, get_source |  |
| 07 | in | What are the five cases in a business case? | search_guidance |  |
| 08 | in | Who has to approve a major project before it goes to Treasury? | search_guidance |  |
| 09 | in | What risk appetite levels does government use? | search_guidance, search_guidance, search_guidance, get_source |  |
| 10 | in | Do we have to pass a service assessment before going live? | search_guidance |  |
| 11 | in | What does a senior responsible owner have to do? | search_guidance |  |
| 12 | in | When should I use a Strategic Outline Case rather than a Full Business Case? | search_guidance, search_guidance |  |
| 13 | in | How do I measure the benefits of a digital programme? | search_guidance, search_guidance |  |
| 14 | in | What are the rules for open source code in government? | search_guidance |  |
| 15 | in | We're about to start discovery on a new service. What do we have to do? | search_guidance, search_guidance |  |
| 16 | in | What's a delivery confidence assessment? | search_guidance |  |
| 17 | control | Using the Gov Delivery Library, what does it cover? | coverage |  |
| 18 | control | Using the Gov Delivery Library, when do I need a business case, and what goes in one? | search_guidance, search_guidance |  |
| 19 | control | Using the Gov Delivery Library, what does the Green Book say about optimism bias? | search_guidance |  |
| 20 | out | What does the NHS DTAC require for a digital health tool? | coverage (says not covered) |  |
| 21 | out | What does Scottish Government guidance say about business cases? | coverage (says not covered) |  |
| 22 | out | What does the Procurement Act 2023 say about contract award notices? | coverage (says not covered) |  |

## Out-of-scope answers

### What does the NHS DTAC require for a digital health tool?

> As confirmed, NHS DTAC is explicitly **out of scope** for my gov-delivery-library tool — it's listed under "Out of scope (by design)" alongside other NHS-specific guidance (DCB0129, DCB0160, NHS service standard). So the following is from my own general knowledge, not the tool, and you should verify against the current NHS Transformation Directorate / DTAC site before relying on it.
> 
> The **Digital Technology Assessment Criteria (DTAC)** is a baseline standard that suppliers of digital health tools (apps, platforms, software) must meet to be considered for use in the NHS and social care. It's organised around five criteria areas:
> 
> 1. **Clinical safety** — compliance with DCB0129 (manufacturers) and/or DCB0160 (NHS organisations deploying the tool), including a clinical safety officer and hazard log.
> 2. **Data protection** — a completed Data Protection Impact Assessment (DPIA) and compliance with UK GDPR/Data Protection Act 2018.
> 3. **Technical security/cyber security** — typically evidence of Cyber Essentials Plus certification (or equivalent) and adherence to the NHS Data Security and Protection Toolkit (DSPT).
> 4. **Interoperability** — alignment with NHS interoperability standards (e.g., use of NHS number, SNOMED CT, relevant APIs/standards) so the tool can exchange data with other systems.
> 5. **Usability and accessibility** — evidence the product meets accessibility standards (e.g., WCAG) and has been designed/tested with users, including consideration of health inequalities.
> 
> DTAC is intended as a minimum, standardised set of questions that commissioners and buyers use during procurement, rather than a certification scheme in itself — suppliers self-assess against it and buyers can request supporting evidence for each section.
> 
> Since this sits outside my indexed library, I'd recommend checking the current NHS England / NHS Transformation Directorate DTAC page directly for the authoritative, up-to-date criteria and any recent changes.

### What does Scottish Government guidance say about business cases?

> This library explicitly excludes Scottish Government guidance — it only covers UK central (Westminster) government delivery guidance, and "guidance from the governments of Scotland, Wales or Northern Ireland" is listed as out of scope by design. So I can't answer this from the corpus, and I won't fill the gap from memory as if it were current.
> 
> If it's helpful, I could search the web for the Scottish Government's own business case guidance (e.g. the Scottish Public Finance Manual or the Scottish Government's Business Case Guide) instead — want me to do that?

### What does the Procurement Act 2023 say about contract award notices?

> The Gov Delivery Library explicitly excludes procurement law, including Procurement Act 2023 guidance, so it has no results for this. I'll answer from general knowledge instead, flagged as such — not from this tool.
> 
> From my own knowledge: the Procurement Act 2023 (mostly in force since 24 February 2025) requires contracting authorities to publish a **contract award notice** after deciding to award a public contract, before entering into it, starting a mandatory **standstill period** (usually 8 working days) during which an unsuccessful bidder can challenge the decision. For contracts above the relevant threshold, authorities must also publish a separate **contract details notice** once the contract is actually entered into (within 30 days), replacing the old "contract award notice" concept used under the previous Public Contracts Regulations 2015 regime — note the terminology shift: what used to be called a "contract award notice" (post-award) is now effectively split into the pre-award notice (triggering standstill) and the post-signature contract details notice.
> 
> Since this is procurement law detail from memory rather than the curated library, I'd recommend verifying against the official Procurement Act 2023 Code of Practice / Cabinet Office Procurement Policy Notes on GOV.UK if you need this for a live decision — happy to search the web for the current official text if useful.

