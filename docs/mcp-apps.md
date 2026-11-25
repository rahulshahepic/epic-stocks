# Epic Stocks MCP Apps: interactive cards across AI assistants

**MCP Apps** is the name of the official [Model Context Protocol extension for interactive user interfaces](https://modelcontextprotocol.io/docs/extensions/apps/overview). It lets a tool return a sandboxed HTML card inside an assistant's conversation. This is **not** a ChatGPT-only widget format or a separate calculator for each provider.

Epic Stocks exposes **one OAuth-protected Streamable HTTP MCP server** at `https://YOUR-DOMAIN/mcp`. Assistants that support MCP tools can read the data they are authorized to access. Hosts that also support the **MCP Apps extension** can render the same interactive portfolio and retirement components. The ordinary MCP text/JSON result remains available when a host does not render the card.

## What is implemented

| Card / capability | How to open it | What it does | Permission |
| --- | --- | --- | --- |
| **Portfolio** | “Show my Epic Stocks portfolio” / `show_equity` | Summary, grants, loans, upcoming events, event-date filters, refresh and display-mode requests | `equity:read` |
| **Retirement planner** | “Show my retirement plan” / `show_retirement` | Actual retirement Monte Carlo results, funded-path and exhaustion risks, percentile wealth chart, date/spending/allocation/insurance what-if controls | `comp:read` |
| **Compare retirement dates** | Retirement card **Compare** button / `compare_retirement_scenarios` | Compare two or three runs on consistent random seeds; the card compares the chosen retirement date against a second user-selected date (three months later by default) | `comp:read`; also `equity:read` for date-specific Epic exit projections |
| **Save retirement assumptions** | Retirement card **Save these inputs** / `update_retirement_params` | Preview named fields and confirm to save. The card handles both requests after you press Save. Exploratory simulations and comparisons leave saved settings alone | `comp:write` |
| **Import equity documents** | Conversation plus the portfolio/import workflow | Assistant interprets attachments, previews proposed changes, then applies only after explicit confirmation | Corresponding import and `equity:write` permissions |

`get_retirement_params` reads the saved retirement inputs; `run_retirement_simulation` returns numerical results without opening a card. `refresh_equity_view` and `refresh_retirement_view` are app-only tools for interactive refreshes. The full retirement simulation is compiled from the browser's `frontend/src/app/pages/Retirement.math.ts` into the server-side Node runner; the UI does not invent its own financial calculations. Date-specific Epic exits use modeled **after-tax, after-loan net cash** and may depend on estimated future share prices.

### How MCP Apps works in this repository

1. The assistant discovers `show_equity` or `show_retirement` through the same `/mcp` endpoint as ordinary tools. The tool advertises `_meta.ui.resourceUri`.
2. The host reads the matching `ui://epic-stocks/...` resource through MCP `resources/read`, then renders its HTML in a sandboxed frame. The resource contains **no account data or credentials**.
3. The tool returns a scoped `structuredContent` result plus JSON text fallback. The host supplies the result to the card.
4. Card actions use the host's MCP Apps message bridge to call other scoped tools. The host can choose whether to support particular presentation features. Every tool invocation is authorized on the server, regardless of what buttons are displayed.
5. If the host lacks MCP Apps, the user can still ask the assistant to call `get_dashboard`, `run_retirement_simulation`, or `compare_retirement_scenarios` and receive a normal answer.

| Resource | Server files | Scope |
| --- | --- | --- |
| `ui://epic-stocks/portfolio-v3.html` | `backend/app/mcp/ui_tools.py`, `portfolio.html` | `equity:read` |
| `ui://epic-stocks/retirement-v4.html` | `backend/app/mcp/retirement_tools.py`, `retirement_ui.py`, `retirement.html` | `comp:read` |

`backend/app/mcp/transport.py` lists and serves these resources. HTML/CSS/JS is bundled in the resource, with no third-party script or direct account API fetch. CSP, OAuth scopes, account isolation, revocation and server-side rate limits still apply. The `openai/ui` metadata enables optional ChatGPT display/entrypoint enhancements; the **basic MCP Apps protocol is shared**. Do not assume fullscreen, sidebar, host file selection, persistence or mobile presentation is identical across clients.

Clients can cache a tool descriptor after its resource version changes. Discovery
advertises only the current portfolio/retirement URI, but `resources/read` retains
every published version as a compatibility alias. The returned content URI matches
the requested URI and serves the current compatible component. Aliases enforce the
same scope and revocation checks; arbitrary paths and unknown versions are refused.
Increment the version constant for future component releases so earlier versions
remain in the bounded allowlist automatically.

Test the loading boundary as well as the component: authenticate a synthetic MCP
connection, read the resource named by cached metadata, then render that returned
HTML in the browser harness. Direct `srcdoc` captures alone miss resource routing
failures. Neither these tests nor successful simulation calls prove a real ChatGPT
or iOS host rendered the app; record actual host observations separately.

## Host support and verification

**Three different claims must stay separate:** a vendor documents support for MCP Apps; Epic Stocks connects to that host through MCP; someone actually opened and exercised **our** card in that host. MCP tool support alone does **not** imply inline HTML cards.

| Host | Vendor MCP Apps support | Epic Stocks verification |
| --- | --- | --- |
| **Claude** | Yes, per MCP's official announcement | **Existing portfolio cards user-verified in Claude (November 2026; client/platform not specified).** Retirement card and its save/compare controls are **not yet host-verified**. |
| **ChatGPT** | Yes | Portfolio/retirement MCP Apps implementations and synthetic-host E2E tests exist. Real host behavior depends on deployment, connected plugin and client; do not equate CI with a live-host acceptance test. |
| **Cursor** | Yes, per [Cursor MCP docs](https://prod.cursor.com/docs/mcp) | Not tested with Epic Stocks cards. |
| **VS Code / GitHub Copilot** | Yes, per [MCP Apps overview](https://modelcontextprotocol.io/docs/extensions/apps/overview); availability can depend on release | Not tested with Epic Stocks cards. |
| **Microsoft 365 Copilot, Goose, Postman, MCPJam, Archestra.AI** | Listed as supported by the [MCP Apps overview](https://modelcontextprotocol.io/docs/extensions/apps/overview) | Not tested with Epic Stocks cards; connection and authentication may vary. |
| **Gemini, Grok, Muse, Perplexity, Mistral Le Chat, Manus** | No verified inline MCP Apps integration for Epic Stocks | Use ordinary MCP tools and structured/text results; do not promise a card. |
| **Claude Code and other terminal agents** | Depends on host/UI surface | MCP tools can work; no inline Epic Stocks card has been verified in a terminal. |

The [official MCP Apps announcement](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) explicitly names Claude, ChatGPT, Goose and VS Code. The [MCP Apps overview](https://modelcontextprotocol.io/docs/extensions/apps/overview) and [Cursor's own MCP documentation](https://prod.cursor.com/docs/mcp) document additional hosts. Check the [current MCP Apps client compatibility matrix](https://modelcontextprotocol.io/docs/extensions/apps/overview) before expanding this table. These are **vendor capabilities**, not proof that every Epic Stocks feature has been tested there.

## Connecting and trying the cards

1. In Epic Stocks, go to **Settings → AI Connections → Connect your AI**. Choose a supported assistant and use its instructions for adding the OAuth-protected `https://YOUR-DOMAIN/mcp` connector. Claude and ChatGPT also have downloadable provider-specific plugin packages. The ZIPs configure the same server; they do **not** contain credentials.
2. Sign in and review permissions. For the portfolio card, grant `equity:read`. For retirement simulation, grant `comp:read`; also grant `equity:read` to recalculate date-specific Epic liquidation values. Grant `comp:write` only if you want the card to save retirement settings.
3. Ask **“Show my Epic Stocks portfolio”** or **“Show my retirement plan.”** If the host supports MCP Apps, it may render a card. Otherwise ask for the numerical tool result.
4. The card opens **Results** without a form. Choose **Edit assumptions**, change spending or date, and choose **Run simulation** to return to results. This does not save. **Compare dates** opens a separate comparison view and runs two scenarios without saving. **Save these inputs** changes the stored scenario only with write permission and an explicit click.
5. After deploying a new resource or adding tools, refresh the assistant's connector/tool metadata, and reconnect if the host needs it. Check actual host behavior before claiming a new client is verified.

Retirement responses distinguish resolved `assumptions` for display from explicit
`inputOverrides` for later runs and saves. The card preserves chat overrides and
edited fields without persisting derived defaults. A date-specific Epic projection
is saved only when selected explicitly and already run for the current date.

Date comparisons default to **Project Epic exit separately for each date**. This
uses saved future price estimates, vesting, debt and taxes and requires
`equity:read`. The comparison control is independent of the single-run projection
checkbox. An explicit opt-out holds the saved or caller-supplied Epic exit amount
fixed, with the actual amount labeled in each result. Projection failures remain
visible; the card never silently falls back to fixed proceeds. Other starting
account balances stay fixed, and purchases before each retirement date are deducted
without modeling working-life savings or market returns. Changing the comparison
date or mode clears stale comparison results. None of these actions saves inputs.

For the ChatGPT package build and host-specific rollout, see [ChatGPT plugin instructions](chatgpt-plugin.md) and [portable plugin packaging](../plugins/epic-stocks/README.md). For Claude, the Connect your AI page provides its custom connector and ZIP installation paths.

## Acceptance checklist for each host

- [ ] Connect through OAuth and verify `resources/list` and `resources/read` for the authorized scopes.
- [ ] Open the portfolio card, browse summary/grants/loans/events, filter dates, refresh, and compare values to the app.
- [ ] Open the retirement card; verify funded-path, liquidity-shortfall and exhaustion metrics, the percentile chart, date and spending overrides, and the two-date comparison.
- [ ] Confirm **Run** and **Compare** do not persist changes; confirm **Save** requires `comp:write` and saves only the selected named fields.
- [ ] Test read-only permissions, revoked connections, wrong-account isolation and an unavailable simulation.
- [ ] Check keyboard operation, mobile layout, dark mode, loading/error states and optional fullscreen behavior on that host.
- [ ] Record **host, client version, date, tester, features tested and limitations** in the relevant PR or release notes.

The existing Claude verification establishes that **the existing portfolio cards render**. It does not automatically verify the new retirement card or every optional host feature.

## References

- [MCP Apps extension overview](https://modelcontextprotocol.io/docs/extensions/apps/overview)
- [Official MCP Apps announcement and initial host support](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)
- [Cursor's MCP Apps support](https://prod.cursor.com/docs/mcp)
- [ChatGPT plugin implementation and acceptance](chatgpt-plugin.md)

## Retirement workflow and purchase deferral

The retirement-v4 resource separates results, assumption editing and retirement-date
comparison within one active card. It preserves complete what-if assumptions across
reruns, including chat-specified fields without form controls. It does not depend
on communication between independent cards. A comparison uses one draft snapshot;
editing inputs invalidates the previous comparison. Saves remain explicit.

Purchase conditions accept `conditionFailure: "skip" | "defer"` (default `skip`)
and an optional `deadlineDate` for defer mode. Wait retries monthly and moves
ownership, loan and sale schedules with the actual purchase. Purchase-count,
first-purchase-year and funded-purchase probabilities match the website's shared
simulator. Working-life needs are summarized by year; they are conservative
retirement-wealth deductions, not calculated stock-sale transactions.
