# Epic Stocks in ChatGPT

## Experience and scope

“Show my Epic Stocks portfolio” opens an inline card with net equity, stock value, held vested shares, outstanding loans and accrued interest. Buttons browse grants, loan history and events. Expand requests fullscreen; the same tool declares sidebar and conversation-panel entrypoints for hosts supporting those extensions. “Explain this” sends a follow-up message. The normal connector tools remain available without a rendered component.

This first version is a portfolio browser. Existing separately authorized chat tools still handle imports and edits, with their current confirmation and version checks. The component itself makes no writes. Compensation forms, retirement simulations, inline edit confirmation and document viewers are later features, each requiring its own UI and acceptance tests.

## Implementation plan and acceptance checks

| Step | Implementation | Acceptance |
| --- | --- | --- |
| Reuse account reads | `show_equity` delegates to the registered dashboard/grants/loans/events handlers | Figures match existing tools and HTTP services; encrypted two-user isolation and revoked connections remain enforced |
| Add MCP Apps resource | `resources/list`, `resources/read`, exact versioned `ui://` URI and HTML MIME profile | Unknown URIs cannot read files; a connection lacking `equity:read` cannot list/read the resource |
| Build inline UI | Self-contained `portfolio.html`, host bridge, mobile layout, light/dark themes | Four views, empty/unknown/assumed values, explicit truncation, failed refresh, text escaping, keyboard controls and axe checks |
| Add extensions | Tool global/thread entrypoints; resource inline/fullscreen display modes | Host capability detection; no required OpenAI-only API for basic rendering and reads |
| Package and document | Portable manifest, deployment-specific package builder, existing icon | No credentials or invented registered app IDs; transport explicitly `streamable-http` |
| Roll out | PR → required review and CI → staging deployment → real ChatGPT connection → production | Actual OAuth consent, resource loading, refresh, entrypoints and mobile client support checked on the deployed server |

The last row is a deployment and host acceptance gate. A simulated MCP Apps host proves component behavior, not that a particular ChatGPT account or mobile release exposes every extension.

## Data and permission boundaries

- At `/mcp`, encryption middleware selects the Bearer account even if an unrelated browser session cookie is also present. HTTP app routes retain their existing session-cookie precedence.
- Both UI tools require `equity:read` and resolve `account` through the same account selector as every other connector read. Scope checks, revocation, rate limits, encryption context and audit writes precede tool execution.
- `show_equity` opens the resource; `refresh_equity_view` is app-only and carries no resource URI, so clicking a tab does not open another card. It is still scope-checked server-side. `ui.visibility` is a host presentation hint, never authorization.
- Each successful UI call returns an output schema, `structuredContent`, and an identical JSON text fallback. Ordinary analysis tools retain their existing text behavior and do not open widgets.
- The resource contains HTML only, with no account data. Its CSP allows no external connections, subframes or assets. No session cookies, bearer tokens, direct API fetches, analytics or third-party scripts enter the widget.
- Results render through `textContent`. Only messages from the parent window are accepted. Requests time out and a failed refresh marks the retained snapshot as unrefreshed.
- Business figures come from the server, never model-supplied balances. Purchased unvested holdings retain cost valuation. Missing prices remain unknown; assumed prices and future event money are labelled. The UI displays known event dates and shares without adding projected money into a headline.
- Event reads default to today through one year ahead and return at most 100 rows. The card reports truncation and offers date filters. It never totals a partial list.
- Widget state persists only the current view. It does not persist financial snapshots or credentials. The follow-up names the view and read date; ChatGPT must verify numbers through tools.

## Install and test

1. Deploy the branch to staging after review and CI pass. Keep the admin AI Connections switch on and ChatGPT allowed.
2. Open [ChatGPT Plugins](https://chatgpt.com/plugins), add a custom MCP server with `https://YOUR-STAGING-DOMAIN/mcp`, select OAuth, create and install the plugin. For an existing connection, refresh its tool metadata from the plugin detail page.
3. Sign in to Epic Stocks and review the scope consent. Select Read only to test this UI with no edit permissions.
4. In a new conversation ask “Show my Epic Stocks portfolio.” Verify the values against Epic Stocks. Click every tab, filter events, refresh, and ask for an explanation. Test Expand and sidebar/thread entrypoints where available.
5. Disconnect in Epic Stocks. The next UI refresh must refuse access. Connect another test account and verify it sees only its own data.
6. Repeat on web and the mobile client. Extension availability varies by client; treat actual host checks as required before claiming support.

For a portable local package, run the command in [plugins/epic-stocks/README.md](../plugins/epic-stocks/README.md). Adding a package to a local marketplace does not publish it to the public directory or create a ChatGPT registered app ID.

## Operations

The UI is copied with the backend in the existing Docker build. No additional service, database table, LLM API key or UI build is needed. `CHATGPT_UI_ORIGIN` is optional for development; public UI submission requires a unique HTTPS origin owned by this plugin. Set it through deployment configuration, never to another plugin's origin. When absent the host uses its default sandbox origin. The resource URI is versioned; bump it for incompatible component/result changes and refresh the connection metadata.

All rollouts use the existing PR/deploy workflow. Public publication requires a separate submission, policy/privacy review, and host acceptance; this change does not submit it automatically.

## Verification commands

```bash
pytest backend/tests/
cd frontend && npx tsc -b --noEmit && npm run lint
cd ..
E2E_LOCAL=1 ./e2e.sh                 # optional local harness, when Docker is unavailable
GREP='chatgpt plugin' ./screenshots/run.sh
```

The normal `./e2e.sh` path remains Docker-based. The opt-in local path reuses the screenshot runner's temporary services and defaults to the plugin component tests; `PLAYWRIGHT_SPECS` can select other spec files. Screenshots use only labelled synthetic account fixtures.

## Protocol sources

- [MCP UI quickstart](https://developers.openai.com/plugins/build/app-quickstart)
- [Add UI to an MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Plugin extensions](https://developers.openai.com/plugins/build/extensions)
- [UI metadata and bridge reference](https://developers.openai.com/plugins/reference)
- [Portable plugin packaging](https://developers.openai.com/plugins/build/plugins)
