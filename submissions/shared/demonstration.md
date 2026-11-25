# Walkthrough and capture script

Use a dedicated fictional reviewer for each platform. Never display credentials,
OAuth tokens, actual documents, real share prices or administrator screens in a
public demonstration. An application screenshot is not an actual-host screenshot.

Suggested 2–3 minute actual-host recording:

1. Start already connected with the platform-specific established reviewer.
   Prompt: “Verify my active account and show my equity overview.” Show the
   fictional account context and the rendered equity app, including a grants
   and loans tab. Demonstrate one callback.
2. Prompt: “Explain my outstanding stock loans and upcoming vesting.” Show
   useful dated figures and distinguish projections from recorded facts.
3. Prompt: “Compare retiring in 2032 and 2034 using my saved spending.” Show
   both scenarios, assumptions and uncertainty. Open the retirement app.
4. Explore a conditional replacement-car expense. Explain no purchase happens.
5. Prompt: “Preview an estimated price of $1,000 effective January 1, 2043.”
   Show the preview, explicitly confirm it, then read back projections. Explain
   this saves a fictional planning assumption only.
6. Mention website deterministic import and user confirmation. For an empty
   reviewer, show importing the synthetic CSV/workbook on the website and
   reconciling saved records, without showing an actual employee document.

OpenAI requires an accessible video walkthrough URL in private review metadata.
Record ChatGPT itself; do not splice a local iframe into ChatGPT chrome.
Anthropic's MCP App carousel accepts PNGs rather than video/GIF: capture 3–5
rendered app responses in Claude at >=1000px width, crop out chat prompts and
supply each prompt separately. Suggested scenes: equity summary, loans,
retirement plan, date comparison, conditional expense. Local simulations in
`screenshots/` are engineering evidence and supplemental assets only.

Mobile check in each actual host: summary legibility, chart labels, tabs,
keyboard/focus, scroll, simulation controls, callbacks, loading and errors.
Website/local screenshot tests cover different evidence and cannot replace it.

A completed, supplemental website-only recording is linked in [assets](assets.md).
It demonstrates the actual public fictional demo, with settled results and no
host chrome. The actual-host walkthrough and Claude carousel remain outstanding.
