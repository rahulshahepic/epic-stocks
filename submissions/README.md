# Epic Stocks submission control center

**Updated 2026-11-25 · release live; directory submission not yet ready.**
Neither application has been submitted. The production deploy is complete;
do not approve or trigger another deploy for this release.

| Platform | Start here | Submission portal |
|---|---|---|
| ChatGPT | [Instructions](chatgpt/README.md) · [paste answers](chatgpt/form-answers.md) · [checklist](chatgpt/checklist.md) · [reviewer guide](chatgpt/reviewer-guide.md) | [OpenAI Plugins](https://platform.openai.com/plugins) |
| Claude | [Instructions](claude/README.md) · [paste answers](claude/form-answers.md) · [checklist](claude/checklist.md) · [reviewer guide](claude/reviewer-guide.md) | [Claude directory](https://claude.ai/directory/manage) |

[Download the deployed release’s packages](https://github.com/rahulshahepic/epic-stocks/actions/runs/45673166635/artifacts/15050911428) (expires December 25, 2026) · [current archive builds](https://github.com/rahulshahepic/epic-stocks/actions/workflows/submission-packages.yml) ·
[Listing assets](shared/assets.md) · [Secure reviewer setup](shared/reviewer-setup.md) ·
[Compliance audit](shared/audit.md) · [Official sources/requirements](shared/requirements.md) ·
[Testing and deployment](shared/evidence/README.md) · [Walkthrough script](shared/demonstration.md) · [Website demo video](../frontend/public/review/epic-stocks-website-demo.webm).

## Release status

- [Staging acceptance](https://github.com/rahulshahepic/epic-stocks/actions/runs/45671945719)
  passed on `024f72b`: two isolated fictional reviewers, both OAuth callbacks,
  confirmed writes, admin refusal, revocation and cleanup.
- [Release promotion #750](https://github.com/rahulshahepic/epic-stocks/pull/750)
  merged as `451b6ca86ebff717c3e5ae56fbf8f69a54e1c02f`.
  The [production deploy](https://github.com/rahulshahepic/epic-stocks/actions/runs/45673166459)
  completed successfully. This is not evidence of actual ChatGPT/Claude rendering.
- Production health, reviewer sign-in, scriptless privacy, support and public
  discovery were checked without sign-in. Unauthenticated MCP initialization
  requests return OAuth discovery information with 401. See
  [production public probes](shared/evidence/production-public-probes.json).
  Narrow Cloudflare exceptions are live (ruleset 14; challenge 6, BIC 3);
  do not replay the historical ops recipe or broadly exempt protected APIs.

## Before either submission

- [ ] Provision separate production OpenAI and Anthropic established reviewers;
  add empty/additional accounts only when independent workflows need them.
  Store generated credentials privately; do not reset active review datasets.
- [ ] Test the deployed reviewer OAuth flow and read/confirmed-write workflows
  through each actual host. Capture desktop/mobile UI evidence honestly.
- [ ] Supply your actual publishing identity, monitored support/review contact,
  domain verification and any account/organization details the portals request.
- [ ] Review privacy/financial representations and make legal attestations yourself.

## ChatGPT owner checklist

- [ ] Complete verified developer identity and publishing role configuration.
  Use a Global data-residency project for MCP app review.
- [ ] Adopt/publish [service terms](shared/terms-draft.md) at a stable HTTPS URL;
  then add its URL to the ChatGPT manifest or submission portal.
- [x] Record the [live ChatGPT reviewer walkthrough](evidence/epic-stocks-chatgpt-walkthrough.mp4) (2:47, fictional account only).
- [ ] Supply an accessible video URL or upload the MP4 in the submission portal.
- [ ] Build/upload `chatgpt-plugin.zip`; complete domain challenge and scans.
- [ ] Enter credentials privately in Review details, review the prepared 5 positive
  and 3 negative cases, personally submit/attest, and publish after acceptance.

## Claude owner checklist

- [ ] Use the eligible paid account and correct long-term owning organization.
- [ ] Capture 3–5 actual Claude app-response PNGs >=1000px wide if submitting as
  an MCP App, with prompt text separately. Supplemental website shots are not substitutes.
- [ ] Submit the production MCP connector; do not place credentials in the portal.
  Supply the dedicated reviewer securely when requested.
- [ ] Connect GitHub, submit [plugin folder](claude/plugin/) tracking **main**,
  validate the exact commit, and pair with the connector in the same organization.
  The repo must be public before the plugin listing goes live.
- [ ] Personally review the test/launch claims and seven policy acknowledgments.

## Downloads and regeneration

`python scripts/package_submissions.py` creates deterministic archives in
`submissions/dist/`: separate plugin ZIPs and complete materials ZIPs with
allowlisted assets, fictional import samples and a dimensions/hash manifest.
Generated binaries are ignored to avoid duplicate committed screenshots. The
Submission packages workflow attaches them to its successful run for 30 days;
open that run from your phone and download its artifact. The workflow has only
repository read permission and never deploys or provisions credentials.
`--check` validates package structure, field lengths, cases and matching server
URLs. See [script](../scripts/package_submissions.py).

The current OpenAI process uses a plugin ZIP. The current Claude plugin process
reads the GitHub folder; its ZIP is a convenient transfer artifact. Both point
to **https://epic-stocks.com/mcp**, never the separate administrator endpoint.
