# Epic Stocks submission control center

**Prepared 2026-11-25 · publication blocked on the gates below.**
No application has been submitted, legal terms accepted, charges incurred or
production deployment approved. Reviewer implementation is not yet claimed
validated in production.

| Platform | Start here | Submission portal |
|---|---|---|
| ChatGPT | [Instructions](chatgpt/README.md) · [paste answers](chatgpt/form-answers.md) · [checklist](chatgpt/checklist.md) · [reviewer guide](chatgpt/reviewer-guide.md) | [OpenAI Plugins](https://platform.openai.com/plugins) |
| Claude | [Instructions](claude/README.md) · [paste answers](claude/form-answers.md) · [checklist](claude/checklist.md) · [reviewer guide](claude/reviewer-guide.md) | [Claude directory](https://claude.ai/directory/manage) |

[Download generated archives from Actions](https://github.com/rahulshahepic/epic-stocks/actions/workflows/submission-packages.yml) ·
[Listing assets](shared/assets.md) · [Secure reviewer setup](shared/reviewer-setup.md) ·
[Compliance audit](shared/audit.md) · [Official sources/requirements](shared/requirements.md) ·
[Testing and deployment](shared/evidence/README.md) · [Walkthrough script](shared/demonstration.md) · [Website demo video](../frontend/public/review/epic-stocks-website-demo.webm).

## Release status

- [Reviewer security #747](https://github.com/rahulshahepic/epic-stocks/pull/747)
  merged as `3112916`; its [staging deployment passed](https://github.com/rahulshahepic/epic-stocks/actions/runs/45667332221).
- [Submission/acceptance #749](https://github.com/rahulshahepic/epic-stocks/pull/749)
  contains these packages, public policy/support and the deployed acceptance gate.
  Its live PR records exact-head independent reviews and required CI.
- [Staging → main #750](https://github.com/rahulshahepic/epic-stocks/pull/750)
  is the release promotion. Follow its latest head/checks, not an older green run.
- [Staging Deploy runs](https://github.com/rahulshahepic/epic-stocks/actions/workflows/deploy.yml?query=branch%3Astaging)
  contain the final HTTPS reviewer acceptance result; **that step must pass**.
- [Production Deploy / approval](https://github.com/rahulshahepic/epic-stocks/actions/workflows/deploy.yml?query=branch%3Amain)
  is owner-gated. No production release or reviewer workflow is claimed validated
  by these materials. The agent must leave the final run waiting for you.

## Before either submission

- [ ] Open the final production Deploy run above, check the intended release,
  and approve its environment gate yourself.
- [ ] Verify privacy and reviewer-login accessibility for automated clients;
  review/apply the narrow Cloudflare rule changes through the release process.
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
- [ ] Adopt/publish [service terms](shared/terms-draft.md) at a stable HTTPS URL;
  candidate metadata uses proposed `/terms`, which is not yet a working terms page.
- [ ] Record/publish an actual ChatGPT walkthrough video and supply its URL.
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
