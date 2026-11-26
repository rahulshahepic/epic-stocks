"""Public, credential-free MCP setup documents and environment-specific packages."""
from html import escape

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response

from scaffold.routers.plugin_downloads import Platform, PRODUCTION, STAGING, archive, site_origin

router = APIRouter(tags=['MCP setup'])
PUBLIC_PATHS = ('/mcp-setup', '/mcp-setup.css', '/mcp/setup.json', '/robots.txt', '/llms.txt', '/mcp-sitemap.xml',
                '/mcp-setup/plugin/chatgpt', '/mcp-setup/plugin/claude')
STAGING_START = 'Call get_account_context first. If uninitialized, call list_test_scenarios and setup_test_account.'
APP_PURPOSE = ('Track when your shares vest and what you owe on stock loans. Estimate how much cash you could receive '
               'if you left Epic after loan payoff and taxes, and compare retirement dates.')
DOCUMENTS = ('Start with one document you already have: an Epic DocuSign stock purchase agreement, a Stock Loan '
             'Statement, or the Eureka “Data for Stock Workbook” CSV. Add other documents as needed.')

CHATGPT_REQUIREMENTS = ('Epic’s ChatGPT Enterprise workspace currently blocks custom connectors. '
                        'ChatGPT Free cannot add custom connectors. You can still import your Eureka CSV '
                        'or Stock Loan Statement directly in Epic Stocks.')
CHATGPT_REQUIREMENTS_URL = ('https://help.openai.com/en/articles/'
                            '12584461-connecting-custom-mcp-servers-in-chatgpt')

CLAUDE_REQUIREMENTS = ('Epic’s Claude Enterprise workspace currently blocks custom connectors. '
                       'Personal Claude Free accounts can add one custom connector.')
CLAUDE_REQUIREMENTS_URL = ('https://support.claude.com/en/articles/'
                           '11175166-get-started-with-custom-connectors-using-remote-mcp')


def setup_document():
    origin = site_origin() or PRODUCTION
    staging = origin == STAGING
    return {
        'name': 'Epic Stocks Staging Test' if staging else 'Epic Stocks',
        'environment': 'staging' if staging else 'production' if origin == PRODUCTION else 'self-hosted',
        'server_url': origin + '/mcp', 'transport': 'streamable-http',
        'authentication': {'type': 'oauth2', 'pkce': 'S256', 'dynamic_client_registration': True,
                           'resource_metadata': origin + '/.well-known/oauth-protected-resource/mcp',
                           'authorization_server_metadata': origin + '/.well-known/oauth-authorization-server'},
        'support_url': origin + '/support',
        'guide_url': origin + '/mcp-setup', 'privacy_policy_url': origin + '/privacy-policy',
        'downloads': {p: origin + '/mcp-setup/plugin/' + p for p in ('chatgpt', 'claude')},
        'setup': ['Create a custom MCP app in your assistant, or upload the matching plugin ZIP.',
                  'Use server_url with OAuth authentication; no API key or client secret is required.',
                  'Sign in to this environment and explicitly approve the account permissions.',
                  'Use equity:read for stock and loan questions and comp:read for compensation or retirement.',
                  'Select Epic Stocks in your chat after connecting.'],
        'chatgpt_requirements': {'notice': CHATGPT_REQUIREMENTS, 'docs_url': CHATGPT_REQUIREMENTS_URL},
        'claude_requirements': {'notice': CLAUDE_REQUIREMENTS, 'docs_url': CLAUDE_REQUIREMENTS_URL},
        'purpose': APP_PURPOSE,
        'first_run': {
            **({'staging_setup': STAGING_START} if staging else {}),
            'account_overview': 'Call get_dashboard for an overview. If the account is empty, offer to help with a first import.',
            'import': {
                'read_guide': 'Call get_import_guide before asking for paperwork or proposing changes.',
                'documents': 'Use fictional documents only to try an import.' if staging else DOCUMENTS,
                'review': ('Check for existing records, preview changes with apply_changes, explain any assumptions, '
                           'and ask the user to approve the preview before saving. Read back the saved result.'),
                'required_scope': 'equity:write',
                'permission': 'Enable Equity editing before previewing or saving changes.',
            },
        },
        'data_notice': ('Staging isolates every MCP connection in a persistent fictional account. Financial tools refuse access until setup_test_account succeeds. Never sync these numbers '
                        'into production, personal finances or financial advice.' if staging else
                        'Private account data stays behind OAuth. This public document contains no account data.'),
        'automatic_setup_limit': 'Discovery can supply configuration; installation, sign-in and permission approval remain user actions.',
    }


@router.api_route('/mcp/setup.json', methods=['GET', 'HEAD'])
def setup_json():
    return JSONResponse(setup_document(), headers={'Cache-Control': 'public, max-age=300'})


@router.api_route('/mcp-setup', methods=['GET', 'HEAD'])
def setup_page():
    doc = setup_document()
    heading = escape(doc['name'])
    steps = ''.join('<li>' + escape(s) + '</li>' for s in doc['setup'])
    first_run = doc['first_run']
    import_steps = first_run['import']
    seed = f'<p>{escape(first_run["staging_setup"])}</p>' if 'staging_setup' in first_run else ''
    onboarding = (f'<h2>After connecting</h2>{seed}<p>{escape(import_steps["documents"])}</p>'
                  '<p>Ask your assistant for help with the import. It will use <code>get_import_guide</code> '
                  f'and show what would change before saving. {escape(import_steps["permission"])}</p>')
    body = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect an AI assistant · {heading}</title><link rel="stylesheet" href="/mcp-setup.css"><link rel="alternate" type="application/json" href="/mcp/setup.json"></head><body><main><a href="/login?intent=%2Fconnect-ai">Epic Stocks Unofficial</a><h1>Connect an AI assistant</h1><p>{escape(doc["purpose"])}</p><p>{escape(doc['data_notice'])}</p><h2>Your connection address</h2><p>Select and copy this address into your assistant’s connection settings:</p><p><code>{escape(doc['server_url'])}</code></p><h2>ChatGPT</h2><p>{escape(doc["chatgpt_requirements"]["notice"])}</p><p><a href="{escape(doc["chatgpt_requirements"]["docs_url"])}">ChatGPT plan and workspace requirements</a></p><ol><li>In ChatGPT on the web, open Plugins → + → Add custom MCP server. In the older Apps view, look for Create.</li><li>Paste the connection address above. If asked for authentication, choose OAuth; you do not need an API key.</li><li>Connect, sign in to Epic Stocks and review the permissions before approving.</li><li>In a chat, select Epic Stocks and ask: “Help me get started with my stock account.”</li></ol><h2>Claude</h2><p>{escape(doc["claude_requirements"]["notice"])}</p><p><a href="/import">Import your Eureka CSV or Stock Loan Statement directly</a> · <a href="{escape(doc["claude_requirements"]["docs_url"])}">Claude plan and workspace requirements</a></p><ol><li>Open Customize → Connectors and choose Add custom connector, or Add → Custom → Web if you see that menu.</li><li>Paste the connection address above, then connect and sign in to Epic Stocks.</li><li>Review the permissions, then select Epic Stocks in your conversation and ask about your account.</li></ol><p>Start with read permissions for questions and analysis. Allow editing only if you want your assistant to save changes. You can disconnect it in Epic Stocks Settings → AI connections.</p>{onboarding}<details><summary>Technical setup and assistant discovery</summary><p>Streamable HTTP · OAuth with PKCE · no API key</p><ol>{steps}</ol><h2>Download a connector</h2><p><a href="/mcp-setup/plugin/chatgpt">Download ChatGPT plugin ZIP</a> · <a href="/mcp-setup/plugin/claude">Download Claude plugin ZIP</a></p><p>Packages contain public configuration only, never credentials.</p><ul><li><a href="/mcp/setup.json">Machine-readable setup JSON</a></li><li><a href="/.well-known/oauth-protected-resource/mcp">OAuth protected resource metadata</a></li><li><a href="/.well-known/oauth-authorization-server">OAuth authorization server metadata</a></li></ul><p>{escape(doc['automatic_setup_limit'])}</p></details><p><a href="/demo">Explore fictional profiles</a> · <a href="/privacy-policy">Privacy</a> · <a href="/support">Support</a></p></main></body></html>'''
    return HTMLResponse(body, headers={'Cache-Control': 'public, max-age=300'})


@router.api_route('/mcp-setup.css', methods=['GET', 'HEAD'])
def setup_css():
    return Response('''html{font:16px/1.6 system-ui,sans-serif;color:#211713;background:#f7f2ea}main{max-width:48rem;margin:2rem auto;padding:1.5rem;background:#fff;border:1px solid #d8cbbd;border-radius:1rem}h1{line-height:1.2}h2{font-size:1.15rem;margin-top:1.8rem}a{color:#a30f28;text-underline-offset:3px}code,p,li,a{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}li{margin:.6rem 0}@media(prefers-color-scheme:dark){html{color:#f2ede8;background:#211713}main{background:#2a211d;border-color:#62544c}a{color:#f8a5b2}}''', media_type='text/css', headers={'Cache-Control': 'public, max-age=300'})


@router.api_route('/mcp-setup/plugin/{platform}', methods=['GET', 'HEAD'])
def setup_plugin(platform: Platform):
    doc = setup_document()
    staging = doc['environment'] == 'staging'
    name = 'epic-stocks-staging-test' if staging else 'epic-stocks'
    description = ('Epic Stocks Staging Test — fictional data only; never sync to personal finances' if staging else 'Epic Stocks — account data')
    return archive(platform.value, name, description, doc['server_url'])


@router.api_route('/robots.txt', methods=['GET', 'HEAD'])
def robots():
    return PlainTextResponse('User-agent: *\nAllow: /privacy-policy\nAllow: /privacy.md\nAllow: /mcp-setup\nAllow: /mcp/setup.json\nAllow: /.well-known/\nDisallow: /api/\nDisallow: /oauth/\nDisallow: /admin-oauth/\nDisallow: /admin-mcp\nDisallow: /mcp$\nSitemap: ' + setup_document()['guide_url'].removesuffix('/mcp-setup') + '/mcp-sitemap.xml\n')


@router.api_route('/llms.txt', methods=['GET', 'HEAD'])
def llms():
    doc = setup_document()
    first_run = doc['first_run']
    import_steps = first_run['import']
    lines = [
        f'# {doc["name"]}', '', f'> {doc["purpose"]}', '',
        f'- [MCP setup]({doc["guide_url"]}): Connection and OAuth sign-in steps.',
        f'- [Setup JSON]({doc["server_url"]}/setup.json): Server configuration and first-run instructions.',
        f'- [Privacy policy]({doc["privacy_policy_url"]}): Data use, recipients and retention.',
        f'- [Support]({doc["support_url"]}): Private reporting and public issue guidance.',
        '', '## Before connecting ChatGPT', '',
        doc['chatgpt_requirements']['notice'],
        f'- [ChatGPT plan and workspace requirements]({doc["chatgpt_requirements"]["docs_url"]})',
        '', '## Before connecting Claude', '',
        doc['claude_requirements']['notice'],
        f'- [Claude plan and workspace requirements]({doc["claude_requirements"]["docs_url"]})',
        f'- [Import your Eureka CSV or Stock Loan Statement directly]({doc["server_url"].removesuffix("/mcp")}/import)',
        '', '## After connecting', '',
    ]
    if 'staging_setup' in first_run:
        lines.append(f'- {first_run["staging_setup"]}')
    lines += [
        f'- {first_run["account_overview"]}',
        f'- {import_steps["read_guide"]} {import_steps["documents"]}',
        f'- {import_steps["permission"]} The scope is `{import_steps["required_scope"]}`.',
        f'- {import_steps["review"]}',
        '', doc['data_notice'], doc['automatic_setup_limit'], '',
    ]
    return PlainTextResponse('\n'.join(lines))


@router.api_route('/mcp-sitemap.xml', methods=['GET', 'HEAD'])
def sitemap():
    return Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' + escape(setup_document()['guide_url']) + '</loc></url></urlset>', media_type='application/xml')
