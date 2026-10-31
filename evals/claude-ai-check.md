# Claude.ai check, by hand

The automated eval runs in Claude Code, where Claude already uses the library every
time. Most trial users are on Claude.ai, which behaves differently, so this is the
check that matters. Do it twice: **before** the new tool descriptions go live, and
**after**.

## How

1. In Claude.ai, check the Gov Delivery Library connector is switched on (the tools
   menu under the message box).
2. Leave everything else as you normally have it, including web search. That is what
   trial users have.
3. Start a **new chat for each question**. Paste the question exactly as written.
4. Note whether Claude used the library. When it does, the answer shows a step such as
   "Gov Delivery Library: search_guidance" above the reply, and the answer has links
   to gov.uk headings.

## Questions

None of them names the library. That is the point.

1. Do I still need GDS approval for digital spend?
2. What happens at a Gate 2 review?
3. Do I need a business case for a £3m digital project?
4. What does the Green Book say about optimism bias?
5. How should we evaluate an AI pilot?

## Results

| # | Before: used library? | After: used library? | Notes |
|---|---|---|---|
| 1 | No: searched the web | No: searched the web (31 Oct) | Named in a follow-up, it "loaded tools" then used the library, and found a third HMT approval trigger (repercussive) the web answer missed, plus three "overtaken" warnings |
| 2 | No: searched the web | No: answered from memory (31 Oct). Named in a follow-up, the library corrected it: Gate 2 tests the *Outline* Business Case after Gate 1, not an approved business case | Web answer mixed in NI Department of Finance and a GOV.UK .docx for how the review runs. Named in a follow-up, it "loaded tools" and listed the full purpose checklist, but said the library has nothing on review length or report format |
| 3 | No: answered from memory, no search at all | No: searched the web (31 Oct). Knew spend controls changed on 1 April 2026 but "could not find the new thresholds and process"; cited Inside Housing and a Gardiner market report. Named in a follow-up, the library found the BJC route and the novel/contentious/repercussive rule | Memory answer said digital projects "may also need spend controls approval… at a much lower threshold", which stopped being true on 1 April 2026. Named in a follow-up, it quoted TAP's MANDATORY line verbatim and said no fixed £3m threshold exists |
| 4 | **Yes**: "loaded tools, used Gov Delivery Library" on the first try | No: searched the web and read the Green Book 2026 PDF itself (31 Oct). Accurate. Named in a follow-up, the library confirmed it and settled a commentator's claim about reference class forecasting | The only question so far that names a document (the Green Book). Quoted the MANDATORY line verbatim, cited headings, gave the page date. Follow-up pulled in the DDaT benefits framework's 54%/200% figures and Gate 2/3 checks |
| 5 | No: answered from memory, no search at all | No: answered from memory (31 Oct). Named in a follow-up, the library added the ETF's Theory of Change and staged-evaluation guidance, and now said unprompted that it does not cover NHS guidance (new instructions reaching the model) | Generic pilot advice. Named in a follow-up (as "the government delivery playbook"), it found the ETF's AI evaluation guidance, the Teal Book and the DDaT Playbook, with the 2023 page-date caution |

Before: tested on 29 October 2026 by Oli, Claude.ai, old descriptions. **Used the library on 1 of 5**, the only question that named a document. Each time, Claude.ai "loaded tools" before using them: it fetches a connector's tools only when it judges them relevant.
After: tested on 31 October 2026 by Oli, Claude.ai, new descriptions live, connector disconnected and reconnected. **Used the library on 0 of 5.**

## What this shows

- The new wording did not change whether Claude.ai uses the library: 1 of 5 before, 0 of 5 after. Five questions is a small sample, so read that as "no effect", not "worse".
- The wording does reach Claude once the tools are loaded: follow-up answers now mention what the library does not cover, which is new text.
- So the decision that matters happens earlier. Claude.ai keeps a connector's tools unloaded until it judges them relevant ("Loaded tools" each time it used them), and it makes that judgement before it reads the tool descriptions, apparently from the connector's name and little else.
- Naming the library in the question worked every time, before and after.
