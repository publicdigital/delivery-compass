# Tool-use eval: baseline

- **In scope, library not named: used on 16 of 16**
- Named the library (control): used on 3 of 3
- Out of scope: said not covered on 3 of 3 (text match, check below)
- Tool calls: search_guidance 35, get_source 1, coverage 4

Run 2026-10-29 10:04 UTC with Claude Code (`sonnet`), this MCP server as its only tool, no project instructions.

| # | Kind | Question | Library tools called | Other tools |
|---|---|---|---|---|
| 01 | in | Do I need a business case for a £3m digital project? | search_guidance, search_guidance |  |
| 02 | in | What happens at a Gate 2 review? | search_guidance |  |
| 03 | in | What does the Green Book say about optimism bias? | search_guidance |  |
| 04 | in | Do I still need GDS approval for digital spend? | search_guidance |  |
| 05 | in | What is the Service Standard? | search_guidance |  |
| 06 | in | How should we evaluate an AI pilot? | search_guidance, search_guidance, search_guidance, search_guidance, search_guidance, get_source, search_guidance |  |
| 07 | in | What are the five cases in a business case? | search_guidance |  |
| 08 | in | Who has to approve a major project before it goes to Treasury? | search_guidance, search_guidance |  |
| 09 | in | What risk appetite levels does government use? | search_guidance, search_guidance, search_guidance |  |
| 10 | in | Do we have to pass a service assessment before going live? | search_guidance |  |
| 11 | in | What does a senior responsible owner have to do? | search_guidance |  |
| 12 | in | When should I use a Strategic Outline Case rather than a Full Business Case? | search_guidance, search_guidance |  |
| 13 | in | How do I measure the benefits of a digital programme? | search_guidance, search_guidance |  |
| 14 | in | What are the rules for open source code in government? | search_guidance |  |
| 15 | in | We're about to start discovery on a new service. What do we have to do? | search_guidance, search_guidance, search_guidance, search_guidance |  |
| 16 | in | What's a delivery confidence assessment? | search_guidance |  |
| 17 | control | Using the Gov Delivery Library, what does it cover? | coverage |  |
| 18 | control | Using the Gov Delivery Library, when do I need a business case, and what goes in one? | search_guidance, search_guidance, search_guidance |  |
| 19 | control | Using the Gov Delivery Library, what does the Green Book say about optimism bias? | search_guidance |  |
| 20 | out | What does the NHS DTAC require for a digital health tool? | coverage (says not covered) |  |
| 21 | out | What does Scottish Government guidance say about business cases? | coverage (says not covered) |  |
| 22 | out | What does the Procurement Act 2023 say about contract award notices? | coverage, search_guidance (says not covered) |  |

## Out-of-scope answers

### What does the NHS DTAC require for a digital health tool?

> The Gov Delivery Library explicitly excludes NHS-specific guidance — it's "out of scope (by design)" and lists DTAC (the NHS Digital Technology Assessment Criteria) by name as an example. So I can't answer this from the corpus; it covers UK central government delivery guidance (Green Book, Service Standard, Technology Code of Practice, etc.), not NHS-specific frameworks.
> 
> For DTAC specifically, you'd need to check NHS England's own published criteria directly rather than relying on this tool.

### What does Scottish Government guidance say about business cases?

> This library is explicitly scoped to UK central government delivery guidance and doesn't cover devolved administrations — Scottish Government guidance is listed as out of scope by design: "It does not include... Guidance from the governments of Scotland, Wales or Northern Ireland."
> 
> So I can't answer this from the corpus, and I don't want to fill the gap from memory as if it were current guidance. If you're looking for the UK/HM Treasury equivalent (the Green Book and associated business case guidance), I can cover that instead — just let me know.

### What does the Procurement Act 2023 say about contract award notices?

> Important caveat first: the coverage check shows this library explicitly excludes **procurement law, including Procurement Act 2023 guidance** — so it has no authoritative legal coverage here. What follows is secondary commentary from delivery guidance, not the law itself.
> 
> **On Award Notices specifically**, The Digital, Data and Technology Playbook and The Sourcing Playbook both describe (in near-identical wording) the new notice regime introduced by the Act:
> 
> > "Award Notice - the Award Notice is notification that a contract is about to be entered into. It is required for competitive and non-competitive contracts and will usually mark the start of an 8 working day standstill period before which the contract can not be entered into." ([The Digital, Data and Technology Playbook: Procurement Reform](https://www.gov.uk/government/publications/the-digital-data-and-technology-playbook/the-digital-data-and-technology-playbook-html#procurement-reform-9))
> 
> Note the page date on that source: **last updated 2023-06-20, over three years ago** — it was written while the Act was still a Bill going through Parliament, so terminology/detail may have shifted in the final Act and regulations. The same text appears in [The Sourcing Playbook: Procurement Reform](https://www.gov.uk/government/publications/the-sourcing-and-consultancy-playbooks/the-sourcing-playbook-html#procurement-reform-4), updated more recently (2026-09-30), which lends it some support, but neither source is the legislation itself.
> 
> Related notices in the same regime, for context:
> - A **Contract Details Notice** "to be published within 30 days of the contract being entered into" (same sources).
> - A **Transparency Notice**, for direct awards without competition, to "inform the market and the public of their intention to direct award a contract."
> 
> On the broader legal framework, the Teal Book notes: "Generally, the provisions in the Procurement Act 2023 must be applied to a 'covered procurement'." ([The Teal Book: 25.6.1.1 Complying with the Procurement Act 2023](https://projectdelivery.gov.uk/teal-book/home/part-e-planning-and-control/chapter-25-procurement-and-contract-management/#:~:text=25.6.1.1%20Complying%20with%20the%20Procurement%20Act%202023,-The%20Procurement%20Act))
> 
> **My recommendation:** for the authoritative, current text on contract award notices (contents, timing, thresholds), go to the Act itself and its secondary legislation, or the Cabinet Office's "Procurement Act 2023: guidance documents collection" referenced in the Teal Book's further-reading list — not this library, which only has pre-enactment and indirect commentary.

