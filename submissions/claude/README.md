# Claude connector and plugin package

Portal: **https://claude.ai/directory/manage**.
[Official connector process](https://claude.com/docs/connectors/building/submission)
and [plugin process](https://claude.com/docs/plugins/submit).

1. Use your eligible paid account and appropriate organization role. Choose the
   organization that should own both listings long term; supply actual contacts.
2. Clear the [checklist](checklist.md), deploy after approval, verify privacy and
   reviewer access, and provision independent Anthropic reviewers using
   [secure setup](../shared/reviewer-setup.md).
3. Select **Submit new → MCP connector**. Use one production URL,
   `https://epic-stocks.com/mcp`, Required authentication, OAuth DCR. Paste
   [form answers](form-answers.md), upload the icon, and resolve synced tool warnings.
4. Test every tool in Claude and Inspector. For MCP App carousel material,
   capture actual Claude responses: 3–5 PNGs at least 1000px wide, prompts
   separately, no chat prompt in the crop. Existing website/local screenshots
   are supplemental; actual-host captures remain pending.
5. Do not place credentials in the portal. When Verified review requests access,
   supply the dedicated account securely with [reviewer guide](reviewer-guide.md).
6. Also select **Submit new → Plugin bundle** using repository
   `rahulshahepic/epic-stocks`, path `submissions/claude/plugin`, branch **main**.
   Connect your GitHub account with push rights; validate the production commit.
   The plugin adds onboarding guidance and points to the same MCP URL. Pair it
   with the connector from the same organization. Do not track default staging.
7. Complete the live listing fields and personally review policy/legal
   acknowledgments. Submit only when the evidence is true. No application or
   attestation has been submitted by this assignment.

[Plugin source](plugin/) · [asset manifest](../shared/assets.md) ·
[compliance audit](../shared/audit.md) · [testing/deployment](../shared/evidence/README.md).
The downloadable materials ZIP is for convenient transfer; the current plugin
submission uses the GitHub folder, not a ZIP upload.
