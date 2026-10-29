# Tool-use eval: baseline-web

- **In scope, library not named: used on 16 of 16**
- Named the library (control): used on 3 of 3
- Out of scope: said not covered on 3 of 3 (text match, check below)
- Tool calls: search_guidance 27, get_source 2, coverage 4

Run 2026-10-29 10:06 UTC with Claude Code (`sonnet`), this MCP server plus WebSearch, WebFetch, no project instructions.

| # | Kind | Question | Library tools called | Other tools |
|---|---|---|---|---|
| 01 | in | Do I need a business case for a £3m digital project? | search_guidance, search_guidance, get_source |  |
| 02 | in | What happens at a Gate 2 review? | search_guidance |  |
| 03 | in | What does the Green Book say about optimism bias? | search_guidance |  |
| 04 | in | Do I still need GDS approval for digital spend? | search_guidance |  |
| 05 | in | What is the Service Standard? | search_guidance |  |
| 06 | in | How should we evaluate an AI pilot? | search_guidance, search_guidance, get_source, search_guidance |  |
| 07 | in | What are the five cases in a business case? | search_guidance |  |
| 08 | in | Who has to approve a major project before it goes to Treasury? | search_guidance |  |
| 09 | in | What risk appetite levels does government use? | search_guidance, search_guidance |  |
| 10 | in | Do we have to pass a service assessment before going live? | search_guidance |  |
| 11 | in | What does a senior responsible owner have to do? | search_guidance |  |
| 12 | in | When should I use a Strategic Outline Case rather than a Full Business Case? | search_guidance, search_guidance |  |
| 13 | in | How do I measure the benefits of a digital programme? | search_guidance, search_guidance |  |
| 14 | in | What are the rules for open source code in government? | search_guidance |  |
| 15 | in | We're about to start discovery on a new service. What do we have to do? | search_guidance, search_guidance |  |
| 16 | in | What's a delivery confidence assessment? | search_guidance |  |
| 17 | control | Using the Gov Delivery Library, what does it cover? | coverage |  |
| 18 | control | Using the Gov Delivery Library, when do I need a business case, and what goes in one? | search_guidance, search_guidance, search_guidance |  |
| 19 | control | Using the Gov Delivery Library, what does the Green Book say about optimism bias? | search_guidance |  |
| 20 | out | What does the NHS DTAC require for a digital health tool? | coverage (says not covered) | WebSearch |
| 21 | out | What does Scottish Government guidance say about business cases? | coverage (says not covered) |  |
| 22 | out | What does the Procurement Act 2023 say about contract award notices? | coverage (says not covered) |  |

## Out-of-scope answers

### What does the NHS DTAC require for a digital health tool?

> Note: this falls outside the Gov Delivery Library's scope (it explicitly excludes NHS-specific guidance like DTAC), so this answer is from a general web search rather than that corpus.
> 
> ## NHS DTAC — what it requires
> 
> The Digital Technology Assessment Criteria (DTAC) is the baseline assessment NHS and social care organisations use to evaluate digital health tools (apps, platforms, remote monitoring tools, etc.) before procurement or onboarding. It covers five areas:
> 
> 1. **Clinical safety** — compliance with DCB0129 (manufacturers) or DCB0160 (NHS organisations), including a Clinical Safety Officer sign-off. A 2026 update added a decision tree to help suppliers determine if their product counts as a medical device, which then triggers additional product assessment questions (PAQ).
> 2. **Data protection** — a Data Protection Impact Assessment (DPIA) and evidence of UK GDPR compliance; overlap with the Data Security and Protection Toolkit (DSPT) has been streamlined, and DPIA expectations now align with NHS England's standard template.
> 3. **Technical security (cyber security)** — alignment with the NCSC Cyber Essentials Plus (or equivalent) and, as of the 2026 refresh, confirmation of compliance with the government's Software Security Code of Practice, plus expanded multi-factor authentication requirements for admin and remote access.
> 4. **Interoperability** — conformance to NHS interoperability standards (e.g., use of open APIs, SNOMED CT, FHIR where applicable) so the tool can exchange data with NHS systems.
> 5. **Usability and accessibility** — meeting accessibility standards (now WCAG 2.2 AA); as of the 2026 update this section is no longer scored, only reviewed comparatively.
> 
> Suppliers complete a DTAC questionnaire as part of procurement, and NHS buyers use it to assess risk before adopting a tool. An updated version of the form replaced the previous one from 6 April 2026.
> 
> Sources:
> - [Using the Digital Technology Assessment Criteria (DTAC) - AI and Digital Regulations Service](https://www.digitalregulations.innovation.nhs.uk/regulations-and-guidance-for-developers/all-developers-guidance/using-the-digital-technology-assessment-criteria-dtac/)
> - [What is DTAC v2? The 2026 NHS Digital Technology Assessment Criteria Explained](https://www.csotrainingacademy.com/blog/what-is-dtac-v2)
> - [DTAC explained: NHS Digital Technology Assessment Criteria in 2026](https://csong.health/dtac-explained)
> - [New NHS Digital Technology Assessment Criteria: What Health Tech Suppliers Need to Know - Burges Salmon](https://www.burges-salmon.com/articles/102mnjh/new-nhs-digital-technology-assessment-criteria-what-health-tech-suppliers-need-t/)
> - [How to Meet DTAC Requirements? Essential Guide & Checklist](https://www.netguru.com/blog/dtac-requirements-checklist)

### What does Scottish Government guidance say about business cases?

> The Gov Delivery Library explicitly excludes Scottish Government guidance — it's scoped to UK central government sources (HM Treasury, NISTA, GDS, etc.) and states plainly: "It does not include: ... Guidance from the governments of Scotland, Wales or Northern Ireland." So this is a gap in the corpus, not evidence that no such guidance exists.
> 
> For Scottish Government business case guidance specifically, you'd want the **Scottish Public Finance Manual (SPFM)** and the **Scottish Capital Investment Manual (SCIM)**, which set out their own business case requirements (generally aligned with, but not identical to, HM Treasury's Green Book five-case model). I haven't verified current content of those — want me to search the web for the up-to-date versions?

### What does the Procurement Act 2023 say about contract award notices?

> The Gov Delivery Library explicitly excludes this: "Procurement law, including Procurement Act 2023 guidance" is listed as out of scope by design. So I can't answer this from that corpus — no result from it wouldn't mean no rule applies, it's just not covered.
> 
> I can search the web for the Procurement Act 2023's provisions on contract award notices if that would help instead — want me to do that?

