# Listing assets

All financial screenshots/fixtures are fictional. Generated archives include
these files under `assets/`; `asset-manifest.json` records exact dimensions,
byte size, source, SHA-256 and evidence type. The current
[committed manifest](asset-manifest.json) is regenerated with the archives. Rebuild with
`python scripts/package_submissions.py`. No credential-bearing screens are
included. Source images stay in their existing canonical locations.

| Packaged asset | Source | Use |
|---|---|---|
| icon.svg | [Existing SVG](../../plugins/epic-stocks/assets/icon.svg), square 512 viewBox | OpenAI primary/composer icon, optional same dark variant; Claude icon |
| icon-512.png | [Existing PNG](../../frontend/public/icon-512.png), 512×512 | Raster logo alternative |
| equity-desktop.png | [Fictional reviewer equity](../../screenshots/directory-equity-light-desktop.png), 1280×800 | Supplemental website equity overview |
| loans-desktop.png | [Fictional reviewer loans](../../screenshots/directory-loans-light-desktop.png), 1280×800 | Supplemental website borrowing information |
| equity-mobile.png | [Fictional reviewer mobile](../../screenshots/directory-equity-light-mobile.png), 375px wide | Supplemental mobile usability; height in generated manifest |
| retirement-desktop.png | [Fictional website demo](../../screenshots/demo-retirement-light-desktop.png) | Supplemental retirement planning; exact dimensions in manifest |
| equity-widget-local.png | [Local equity card](../../screenshots/chatgpt-plugin-light-desktop.png) | Engineering simulation only, not a real host capture |
| retirement-widget-local.png | [Local retirement card](../../screenshots/mcp-apps-retirement-light-desktop.png) | Engineering simulation only, not a real host capture |

Existing SVG design is reused without OpenAI, Anthropic or Epic corporate marks.
Publisher must confirm its rights to branding when making legal attestations.
The same icon is valid on light/dark surfaces; no unsupported variant requirement
is invented. No promotional banner is claimed mandatory in current public forms.

Actual-host assets still required:

- OpenAI: the [actual ChatGPT walkthrough](../evidence/epic-stocks-chatgpt-walkthrough.mp4)
  is in the repository, outside the plugin and materials archives. The owner
  still needs to supply a reviewer-accessible video URL.
- Anthropic MCP App: 3–5 PNG app-response crops >=1000px wide, prompt text
  separately; no chat prompt in crop and no GIF/video carousel.

Do **not** upload website/local screenshots as host proof. Suggested prompts and
capture sequence are in [demonstration.md](demonstration.md).

Fictional import documents included under `samples/` in materials archives:
[share-summary CSV](../../test_data/epic_share_summary.csv),
[loan statement text](../../test_data/epic_loan_statement.txt),
[workbook](../../test_data/fixture.xlsx). The CSV/workbook can exercise website
imports; the text statement is a human-readable reference (the PDF import
expects a PDF, not this .txt). None contains real employee records or prices.
Use the existing synthetic PDF in `test_data/` if an actual PDF upload test is
needed; do not substitute a real statement.

Supplemental [website walkthrough video](../../frontend/public/review/epic-stocks-website-demo.webm)
(WebM, 1280×800) records the actual fictional website demo: equity, sale what-if,
timeline and retirement simulation. It shows no credentials or private records.
The materials archives include `assets/website-demo.webm`. It is **not** a
ChatGPT/Claude recording and does not establish host compatibility.
Regenerate with `SUBMISSION_DEMO_CAPTURE=1 PLAYWRIGHT_SPECS=e2e/submission-demo.spec.ts
./screenshots/run.sh`; validate dimensions/duration with `ffprobe`. Viewing pauses
are deliberate. The committed manifest contains its hash and byte size.
