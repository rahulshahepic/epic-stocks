# Epic Stocks plugin

The UI and OAuth server ship with Epic Stocks itself. This directory is the portable packaging source; build it for a specific deployment so forks never connect to the original owner's server by accident:

```bash
python3 scripts/build-chatgpt-plugin.py --url https://YOUR-DOMAIN/mcp --output /tmp/epic-stocks-plugin
```

The output includes root `plugin.json`, `mcp.json` with the `streamable-http` transport, and the existing app icon. It contains no access tokens. Supported local clients can install this package through a local marketplace. For ChatGPT, register the deployed `/mcp` endpoint through Plugins → Add custom MCP server and authenticate with OAuth; this creates the registered plugin connection. Refresh an existing connection's tools after deployment. Do not invent or copy someone else's `plugin_asdk_app...` ID into a package.

Public directory publication is separate from building or registering a personal plugin. See [the implementation and rollout plan](../../docs/chatgpt-plugin.md).

Version 1.1 adds the full Import tab: host file selection, parser attempts, ChatGPT repair, editable custom grants and explicit review/acceptance. Refresh tools after deployment; the UI resource is versioned at `portfolio-v2.html`. No API key is needed.
