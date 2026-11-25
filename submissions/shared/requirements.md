# Official requirements register

Verified **2026-11-25 UTC**. M = mandatory in the cited current guidance;
R = recommendation; Q = unresolved/account-specific. These are independent
platform assessments. A listing is not an endorsement or a guarantee of access.
Official pages evolve: recheck at submission. The authenticated forms were not
opened and no terms were accepted.

## OpenAI

| Topic | Classification and finding | Official source |
|---|---|---|
| Eligibility | M: verified individual/organization; owner or Apps Management Write role; select owning organization/project | [Submission](https://developers.openai.com/plugins/deploy/submission), [verification](https://platform.openai.com/settings/organization/general) |
| Submission | M: current Apps SDK submission URL redirects to **Plugins**. Upload plugin ZIP with MCP in initial package; verify domain, connect/scan, resolve required errors, provide review details, submit; publish only after approval | [Current process](https://developers.openai.com/plugins/deploy/submission) |
| Listing | M: accurate identity, support, privacy and terms URLs; clear brand and purpose. Current manifest field limits apply; no invented developer identity | [Field reference](https://developers.openai.com/plugins/deploy/submission#automatically-provide-submission-and-review-information) |
| Review access | M: populated dedicated test login/password, no inaccessible secondary challenge. Credentials go in private Review details, outside ZIP | [Test credentials](https://developers.openai.com/plugins/plugin-guidelines#14-test-credentials) |
| Functionality/finance | M: useful complete app, reliable desktop/mobile; no deceptive/high-risk financial services. Developer terms prohibit initiating/executing/facilitating financial transactions. Tracking completed sales and hypothetical calculations do not execute trades; disclose effects accurately | [Guidelines](https://developers.openai.com/plugins/plugin-guidelines), [Developer terms](https://openai.com/policies/developer-apps-terms/) |
| Privacy/documents | M: minimize necessary fields; exclude PCI/PHI/government IDs/authentication secrets from app tools; disclose recipients, retention and controls. Sensitive-data processing needs necessity, disclosure and legally adequate consent. Document import must not solicit restricted fields | [Data collection](https://developers.openai.com/plugins/plugin-guidelines#42-data-collection) |
| OAuth | M: OAuth 2.1/MCP authorization, public resource and issuer metadata, S256 PKCE, audience/resource binding. DCR, CIMD or predefined registration supported; DCR remains an available route, CIMD is not assumed mandatory | [Authentication](https://developers.openai.com/plugins/build/auth) |
| Tools | M: precise schemas, explicit read/write effects and accurate annotations; review all exposed operations; no hidden generic executor. R: narrow tools and concise outputs | [Tool design](https://developers.openai.com/plugins/plugin-guidelines#6-building-trustworthy-plugins) |
| UI | M when used: declared resource, CSP and unique component origin for publication; mobile usability and useful fallbacks. Real host testing remains required evidence | [ChatGPT UI](https://developers.openai.com/plugins/build/chatgpt-ui), [Reference](https://developers.openai.com/plugins/reference) |
| IP | M: use owned/permitted material, no impersonation or endorsement claims | [Guidelines](https://developers.openai.com/plugins/plugin-guidelines#11-purpose-and-originality) |
| Assets/review | M: primary square icon; current supported formats PNG/JPEG/WebP/SVG, >=48px, <=5 MiB, raster <=4096px. Initial MCP review needs 5 positive/3 negative cases and accessible walkthrough video. Dark icons R | [Submission](https://developers.openai.com/plugins/deploy/submission#icons) |
| Subscription access | Current help: Free/Go can discover plugins but cannot use plugin extensions. Paid plan, region, workspace, role, model and surface govern actual connected-app access; do not promise this listing on every paid tier or confuse custom development with publication | [Current troubleshooting](https://help.openai.com/en/articles/20001497-troubleshooting-plugins-and-apps-in-chatgpt), [Connected apps](https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt) |

## Anthropic

| Topic | Classification and finding | Official source |
|---|---|---|
| Eligibility | M: paid Claude account; personal paid users or permitted organization role; choose long-term owning organization. No partner-program prerequisite | [Publish](https://claude.com/docs/directory/publish) |
| Connector process | M: submit HTTPS server in claude.ai/directory/manage; tools sync from live server; complete listing, use cases, company/contact, authentication, data handling, test and policy steps. Default Community scan differs from Verified functional review | [Submit connector](https://claude.com/docs/connectors/building/submission) |
| Plugin advantage | R: submit **both** connector and plugin from same organization. A plugin can bundle onboarding skills; pairing reuses same server URL and tools while adding workflow guidance and plugin distribution. Connector has its own authentication/health dashboard; a skill alone is not a submission type | [Publishing both](https://claude.com/docs/directory/publish#submit-your-plugin-and-your-mcp-server-as-a-connector) |
| Plugin process | M if chosen: public GitHub plugin folder before publication, connected GitHub identity with push access, `.claude-plugin/plugin.json`, README/license; validate exact tracked commit. Explicitly track **main**, because repository default is staging | [Submit plugin](https://claude.com/docs/plugins/submit), [Checklist](https://claude.com/docs/plugins/pre-submission-checklist) |
| OAuth | M: authenticated account services use OAuth; discovery must signal real 401; support advertised DCR or configured OAuth client. S256, refresh and callback compatibility must work. R: keep discovery/register/token under 10 seconds | [Authentication](https://claude.com/docs/connectors/building/authentication) |
| Tools | M: title, <=64-character names, applicable readOnlyHint/destructiveHint; narrow descriptions, separate reads/writes, no catch-all HTTP executor or unrelated prompt instructions. Review guidance treats modifying tools conservatively | [Review criteria](https://claude.com/docs/connectors/building/review-criteria) |
| Privacy/finance/IP | M: necessary context only, public privacy/contact/documentation, owned/permitted APIs, human safeguards for high-risk decisions, no asset transfers. No extraction from Claude memory/history/summaries/user files | [Directory policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy), [Usage policy](https://www.anthropic.com/legal/aup) |
| Uploaded files ambiguity | Q: policy broadly forbids querying/extracting user files; no assumed exception for user-authorized uploads. This connector has no file/history retrieval API. Prefer Epic Stocks' own deterministic website parser and explicit user-supplied minimal fields. Seek written clarification before marketing automatic Claude file extraction | [Directory policy §1.G](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) |
| Test account | M: standard account/sample data. Current portal says **do not place credentials in the portal**; Verified reviewer requests test access separately. Keep secure reusable reviewer setup ready | [Policy §3.D](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy), [Test & launch](https://claude.com/docs/connectors/building/submission#submit-through-the-developer-portal) |
| Listing assets | M for MCP App: 3–5 PNGs, width >=1000px, app-response-only crops, prompts supplied separately; no video/GIF carousel. Icon required; no invented dimension requirement beyond current documented fields | [Carousel specifications](https://claude.com/docs/connectors/building/submission#carousel-screenshots-for-mcp-apps) |
| MCP Apps | M: standard MCP Apps metadata/bridge, sandbox/CSP; host support varies. Embedded website/entry-point features may require Verified status; don't infer that basic Apps UI does. Optional owned allowed-link origins reduce confirmation prompts | [MCP Apps](https://claude.com/docs/connectors/building/mcp-apps/getting-started), [Review criteria](https://claude.com/docs/connectors/building/review-criteria) |
| User tiers | Current connector support includes Free and paid tiers, subject to app/organization controls; paid publishing eligibility is separate. No promise every feature works on every surface | [User support](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities) |

## MCP specifications

The [current authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization)
redirected to **2026-07-28** on the verification date. It requires protected
resource metadata and issuer discovery, secure OAuth, PKCE and resource binding;
CIMD is recommended and DCR retained for compatibility. The deployed server
advertises older supported protocol revisions. OpenAI's authentication guide
specifically references the 2025-11-25 authorization revision. Do not claim
full newest-revision compliance merely because discovery works.

[Transport specification](https://modelcontextprotocol.io/specification/latest/basic/transports):
Streamable HTTP allows JSON responses; SSE is not mandatory for this server's
request/response operations. Compatibility must be negotiated/tested with the
actual clients. [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps)
is distinct from rendering ordinary HTML in a browser.
