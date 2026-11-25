/**
 * How to connect each assistant to the MCP server.
 *
 * To support another assistant: add an entry here, and its OAuth callback to
 * DEFAULT_REDIRECT_RULES in backend/scaffold/oauth/settings.py. Menu names
 * move often, so steps name the setting to look for rather than every click.
 */

export interface AssistantGuide {
  id: string
  name: string
  /** Who receives the data, for the privacy line. */
  company: string
  steps: string[]
  /** Plan or workspace limits worth knowing before starting. */
  note?: string
  /** A downloadable plugin that needs no server address. */
  plugin?: { href: string; filename: string }
  /** Send a setup request to the assistant instead of clicking through menus. */
  setupPrompt?: boolean
  docs?: string
}

export const ASSISTANT_GUIDES: AssistantGuide[] = [
  {
    id: 'claude',
    name: 'Claude',
    company: 'Anthropic',
    steps: [
      'In Claude, open Settings → Connectors and choose Add custom connector.',
      'Name it Epic Stocks, paste the server address and choose Add.',
      'Choose Connect, sign in to Epic Stocks and approve the permissions.',
    ],
    note: 'Custom connectors need a paid plan. On Team and Enterprise, an owner may have to add it first.',
    plugin: { href: '/api/ai/plugin/claude', filename: 'epic-stocks-claude.zip' },
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    company: 'OpenAI',
    steps: [
      'In ChatGPT on the web, open Plugins → + → Add custom MCP server. In the older Apps view, look for Create.',
      'Name it Epic Stocks (or Epic Stocks Staging Test for testing), paste the server address and choose OAuth.',
      'Review the connection and create the plugin.',
      'Sign in to Epic Stocks and approve the permissions.',
    ],
    note: 'Epic’s ChatGPT Enterprise workspace currently blocks custom connectors. ChatGPT Free cannot add custom connectors. You can still import your Eureka CSV or Stock Loan Statement directly in Epic Stocks.',
    docs: 'https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt',
    plugin: { href: '/api/ai/plugin/chatgpt', filename: 'epic-stocks-chatgpt.zip' },
  },
  {
    id: 'gemini',
    name: 'Gemini',
    company: 'Google',
    steps: [
      'On gemini.google.com, open Settings → Connected apps.',
      'Add a custom app and paste the server address.',
      'Sign in to Epic Stocks and approve the permissions.',
    ],
    note: 'Google limits custom apps by country and account type, and they need Keep Activity turned on.',
  },
  {
    id: 'grok',
    name: 'Grok',
    company: 'xAI',
    steps: [
      'Open grok.com/connectors and choose New Connector → Custom.',
      'Name it Epic Stocks, paste the server address and save.',
      'Sign in to Epic Stocks and approve the permissions.',
    ],
    note: 'Custom connectors need a paid Grok plan.',
    docs: 'https://docs.x.ai/grok/connectors',
  },
  {
    id: 'muse',
    name: 'Muse',
    company: 'Meta',
    steps: [
      'Copy the setup request below and send it in a Muse chat. The address is already in it.',
      'Follow Muse’s sign-in link, sign in here and approve the permissions.',
      'Let Muse check the connection and save the connector for future chats.',
    ],
    setupPrompt: true,
    docs: 'https://www.meta.com/help/artificial-intelligence/1687253048996149/',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    company: 'Perplexity',
    steps: [
      'In Perplexity, open Settings → Connectors and choose + Custom connector, then Remote.',
      'Name it Epic Stocks, paste the server address, choose OAuth, tick the risk notice and choose Add.',
      'Sign in to Epic Stocks in the tab that opens and approve. Finish before closing the tab.',
    ],
    note: 'Needs Pro, Max or Enterprise. On Enterprise, an admin must allow custom connectors.',
  },
  {
    id: 'mistral',
    name: 'Mistral Le Chat',
    company: 'Mistral AI',
    steps: [
      'In Le Chat, open Intelligence (or Context) → Connectors and choose + Add Connector.',
      'On the Custom MCP Connector tab, name it EpicStocks (no spaces) and paste the server address.',
      'Connect, sign in to Epic Stocks and approve. Allow pop-ups if nothing opens.',
    ],
    note: 'Adding a connector needs admin rights on the Le Chat account or workspace.',
    docs: 'https://help.mistral.ai/en/articles/393572-configuring-a-custom-connector',
  },
  {
    id: 'manus',
    name: 'Manus',
    company: 'Manus',
    steps: [
      'In Manus, open Settings → Connectors → Add connectors and pick the Custom MCP tab.',
      'Add a custom MCP server by URL, name it Epic Stocks and paste the server address.',
      'Sign in to Epic Stocks and approve, then turn the connector on in each new task.',
    ],
  },
]

export function mcpServerUrl(location: Pick<Location, 'hostname' | 'origin'> = window.location): string {
  return `${location.origin}/mcp`
}

export function museSetupPrompt(serverUrl: string): string {
  return `Create a custom connector named Epic Stocks for the remote MCP server at ${serverUrl}. ` +
    'It uses Streamable HTTP and OAuth with PKCE and dynamic client registration. ' +
    'Guide me through signing in to Epic Stocks and approving the connection. ' +
    'Then list its tools, use get_dashboard to check the connection, and save it for future chats.'
}
