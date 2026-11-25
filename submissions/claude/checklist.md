# Claude compliance checklist

Verified 2026-11-25. [Official requirement register](../shared/requirements.md).

| Requirement/source | Implementation/evidence | Status / remaining action |
|---|---|---|
| [Paid account/role](https://claude.com/docs/directory/publish) | Account-specific portal | Blocked: owner account/organization/contact |
| [HTTPS OAuth connector](https://claude.com/docs/connectors/building/authentication) | Public metadata; DCR; PKCE; refresh/revocation tests | Production public discovery verified; actual Claude OAuth validation pending |
| [Titles/annotations/narrow tools](https://claude.com/docs/connectors/building/review-criteria) | Registry schemas/annotations and scoped handlers | Existing implementation; platform scan and all-tool actual Claude testing pending |
| First-party API | Epic Stocks services only; no corporate/broker APIs | Complete implementation |
| [Financial safeguards](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) | Tracking-only writes, confirmation, assumption labels | Complete implementation; host review required |
| Conversation/files minimization | No memory/history/file retrieval endpoint; website parser; narrowed import guidance | Complete implementation; raw Claude-upload extraction interpretation remains unresolved and is not marketed |
| Privacy/contact/documentation | PRIVACY.md, setup pages, public probe evidence | Production scriptless privacy and support accessible; actual monitored contact owner-only |
| Standard populated test account | independent Anthropic identity, fictional fixture, persistent writes | Production feature deployed; owner-approved provisioning and secure reviewer delivery remain separate |
| [Carousel](https://claude.com/docs/connectors/building/submission#carousel-screenshots-for-mcp-apps) | Capture script and prompts; supplemental website assets | Blocked for MCP App submission: 3–5 actual-host PNG crops >=1000px |
| MCP Apps callbacks/sandbox | portfolio/retirement resources, CSP, text fallback, local tests | Local simulation only; actual Claude desktop/mobile evidence pending |
| [Plugin structure/license](https://claude.com/docs/plugins/pre-submission-checklist) | plugin/.claude-plugin, .mcp.json, skills, README, MIT LICENSE | Prepared; CLI/portal validation and reviewed main commit pending |
| Plugin/connector pairing | exact same production MCP URL; explicit main tracking instructions | Prepared; pair in same owning organization |
| Prompt examples | form answers + reviewer guide | Complete copy; actual execution pending |
| Test/launch and seven acknowledgments | owner portal | Owner action only after evidence complete |
| Production approval | Existing release deployed | No redeploy needed; any later production deployment remains owner-only |
