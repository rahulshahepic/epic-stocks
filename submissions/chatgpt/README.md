# ChatGPT submission package

Portal: **https://platform.openai.com/plugins**.
Identity verification: https://platform.openai.com/settings/organization/general.
Current [official flow](https://developers.openai.com/plugins/deploy/submission)
uses a plugin ZIP; older Apps SDK submission links redirect there.

1. Review the [control center](../README.md) and [checklist](checklist.md).
2. Select your verified publishing identity and owning organization/project.
   You need owner or Apps Management Write rights. Supply your real monitored
   support/review contact; no placeholder identity should be submitted.
3. Approve production deployment only after independent review, CI and staging
   acceptance pass. Complete the narrow edge/documentation fixes and validate
   privacy/terms URLs. Adopt/publish terms after reviewing the supplied draft.
4. Provision independent OpenAI reviewers using [secure setup](../shared/reviewer-setup.md).
5. Run `python scripts/package_submissions.py`. From the generated artifacts,
   upload **chatgpt-plugin.zip**, not the documentation-only materials ZIP.
   [Candidate source](plugin/plugin.json) includes listing fields, 5 positive/3
   negative review cases and an onboarding skill. Supply the adopted terms URL
   and the actual-host demo recording URL before submission. Replace developerName if your
   verified identity differs from the GitHub handle.
6. In the draft, complete the domain challenge, connect MCP using DCR/OAuth,
   resolve required scans, and use [form answers](form-answers.md).
7. Enter reviewer credentials and [review instructions](reviewer-guide.md) only
   in private Review details. Complete actual-host desktop/mobile testing,
   record/publish a video, and add its URL. [Demonstration script](../shared/demonstration.md).
8. Personally review attestations and submit. After approval, choose when to
   publish. This assignment does not submit, accept terms or publish for you.

[Asset manifest](../shared/assets.md) · [test cases](review-cases.json) ·
[compliance evidence](../shared/audit.md) · [deployment status](../shared/evidence/README.md).
Do not upload supplemental/local simulation screenshots as actual ChatGPT proof.
