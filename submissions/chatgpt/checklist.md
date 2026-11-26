# ChatGPT compliance checklist

Verified 2026-11-25. **Complete** means implemented/observed at the stated layer,
not portal approval. [Official requirement register](../shared/requirements.md).

| Requirement/source | Implementation/evidence | Status / remaining action |
|---|---|---|
| [Verified publisher](https://developers.openai.com/plugins/plugin-guidelines#2-developer-verification) | Owner-only dashboard | Blocked: owner verification/identity/contact |
| [Public authenticated MCP](https://developers.openai.com/plugins/build/auth) | OAuth metadata public probes; oauth server and tests | Production public discovery verified; actual-host reviewer OAuth validation pending |
| PKCE/audience/scopes/revocation | scaffold/oauth; OAuth and reviewer tests | Deployed staging acceptance passed; production host validation pending |
| Independent populated reviewer | reviewers service/model/login/admin; existing fixture seeder | Production feature deployed; provision through owner-approved controls before host validation |
| Least privilege/isolation | own-account resolution, separate admin endpoint, namespace/live checks | Complete local tests; independent review/CI recorded in evidence |
| Accurate tools/confirmations | annotations registry, apply_changes, retirement services | Complete existing mechanisms; platform tool scans and all-tool host runs pending |
| Financial effects | equity tool wording, deterministic services, no trade/bank APIs | Complete implementation; platform policy review still required |
| [Privacy/restricted inputs](https://developers.openai.com/plugins/plugin-guidelines#4-privacy) | PRIVACY.md and public page; minimal import fields, website parser | Production scriptless policy /privacy-policy and /privacy.md return policy text; use the scriptless URL |
| Retention/export/deletion | single deletion service, export, audit cleanup, privacy | Existing controls; operator must verify deployed backup retention and restore policy |
| Terms/support URLs | setup URL exists; terms draft supplied | Terms blocked: owner adoption/public URL; monitored contact needed |
| [UI sandbox/mobile](https://developers.openai.com/plugins/build/chatgpt-ui) | versioned resources, empty external CSP, browser tests | Local simulation only; actual ChatGPT/iOS/Android rendering and unique component origin pending |
| IP/independent branding | existing brand icon, unofficial name/disclosures | Complete copy; publisher must attest rights/affiliation truthfully |
| [Listing/package/assets](https://developers.openai.com/plugins/deploy/submission) | plugin candidate, asset manifest, packaging validation | Prepared; authenticated OpenAI scanner required; keep documented OAuth/DCR extension pending its verdict |
| Five positive/three negative tests | review-cases.json + candidate manifest | Complete cases; actual-host results pending |
| Reviewer walkthrough video | [Live ChatGPT capture](../evidence/epic-stocks-chatgpt-walkthrough.mp4) (2:47; fictional OpenAI reviewer) | Captured: account context, equity/Grants/Loans, dated loans and vesting, 2032 vs. 2034 comparison, and confirmed estimate read-back. Owner supplies video in portal. |
| Legal/publish/deploy approval | Release already deployed; no listing submission or legal approval performed | Owner action only |
