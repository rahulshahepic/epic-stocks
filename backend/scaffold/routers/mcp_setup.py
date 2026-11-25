"""Public, credential-free MCP setup documents and environment-specific packages."""
from html import escape

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response

from scaffold.routers.plugin_downloads import Platform, PRODUCTION, STAGING, archive, site_origin

router = APIRouter(tags=['MCP setup'])
PUBLIC_PATHS = ('/mcp-setup', '/mcp-setup.css', '/mcp/setup.json', '/robots.txt', '/llms.txt', '/mcp-sitemap.xml',
                '/mcp-setup/plugin/chatgpt', '/mcp-setup/plugin/claude')


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
        'guide_url': origin + '/mcp-setup',
        'downloads': {p: origin + '/mcp-setup/plugin/' + p for p in ('chatgpt', 'claude')},
        'setup': ['Create a custom MCP app in your assistant, or upload the matching plugin ZIP.',
                  'Use server_url with OAuth authentication; no API key or client secret is required.',
                  'Sign in to this environment and explicitly approve the account permissions.',
                  'Choose equity:read and comp:read for analysis; add equity:write and comp:write for editing tests.',
                  ('Select the app, call get_account_context, then list_test_scenarios and setup_test_account before get_dashboard.' if staging else 'Select the installed app in your chat and ask it to call get_dashboard.')],
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
    seed = '<p>On staging, connect normally. Ask your assistant to verify get_account_context, list_test_scenarios and call setup_test_account. The dashboard account is separate and cannot be accessed through the staging MCP.</p>' if doc['environment'] == 'staging' else ''
    body = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect an AI assistant · {heading}</title><link rel="stylesheet" href="/mcp-setup.css"><link rel="alternate" type="application/json" href="/mcp/setup.json"></head><body><main><a href="/login">Epic Stocks Unofficial</a><h1>Connect an AI assistant</h1><p>Ask ChatGPT or Claude about your stock, loans and retirement plan using the same figures you see in the app.</p><p>{escape(doc['data_notice'])}</p><h2>Your connection address</h2><p>Select and copy this address into your assistant’s connection settings:</p><p><code>{escape(doc['server_url'])}</code></p><h2>ChatGPT</h2><ol><li>Open Settings → Apps and look for the option to add a custom app or connector. Availability depends on your plan and workspace.</li><li>Paste the connection address above. If asked for authentication, choose OAuth; you do not need an API key.</li><li>Connect, sign in to Epic Stocks and review the permissions before approving.</li><li>In a chat, select Epic Stocks and ask: “Help me get started with my stock account.”</li></ol><h2>Claude</h2><ol><li>Open Settings → Connectors and add a custom connector.</li><li>Paste the connection address above, then connect and sign in to Epic Stocks.</li><li>Review the permissions, then select Epic Stocks in your conversation and ask about your account.</li></ol><p>Start with read permissions for questions and analysis. Allow editing only if you want your assistant to save changes. You can disconnect it in Epic Stocks Settings → AI connections.</p>{seed}<details><summary>Technical setup and assistant discovery</summary><p>Streamable HTTP · OAuth with PKCE · no API key</p><ol>{steps}</ol><h2>Download a connector</h2><p><a href="/mcp-setup/plugin/chatgpt">Download ChatGPT plugin ZIP</a> · <a href="/mcp-setup/plugin/claude">Download Claude plugin ZIP</a></p><p>Packages contain public configuration only, never credentials.</p><ul><li><a href="/mcp/setup.json">Machine-readable setup JSON</a></li><li><a href="/.well-known/oauth-protected-resource/mcp">OAuth protected resource metadata</a></li><li><a href="/.well-known/oauth-authorization-server">OAuth authorization server metadata</a></li></ul><p>{escape(doc['automatic_setup_limit'])}</p></details><p><a href="/demo">Explore fictional profiles</a> · <a href="/privacy">Privacy</a></p></main></body></html>'''
    return HTMLResponse(body, headers={'Cache-Control': 'public, max-age=300'})


@router.api_route('/mcp-setup.css', methods=['GET', 'HEAD'])
def setup_css():
    return Response('''html{font:16px/1.6 system-ui,sans-serif;color:#211713;background:#f7f2ea}main{max-width:48rem;margin:2rem auto;padding:1.5rem;background:#fff;border:1px solid #d8cbbd;border-radius:1rem}h1{line-height:1.2}h2{font-size:1.15rem;margin-top:1.8rem}a{color:#a30f28;text-underline-offset:3px}code{overflow-wrap:anywhere}li{margin:.6rem 0}@media(prefers-color-scheme:dark){html{color:#f2ede8;background:#211713}main{background:#2a211d;border-color:#62544c}a{color:#f8a5b2}}''', media_type='text/css', headers={'Cache-Control': 'public, max-age=300'})


@router.api_route('/mcp-setup/plugin/{platform}', methods=['GET', 'HEAD'])
def setup_plugin(platform: Platform):
    doc = setup_document()
    staging = doc['environment'] == 'staging'
    name = 'epic-stocks-staging-test' if staging else 'epic-stocks'
    description = ('Epic Stocks Staging Test — fictional data only; never sync to personal finances' if staging else 'Epic Stocks — account data')
    return archive(platform.value, name, description, doc['server_url'])


@router.api_route('/robots.txt', methods=['GET', 'HEAD'])
def robots():
    return PlainTextResponse('User-agent: *\nAllow: /mcp-setup\nAllow: /mcp/setup.json\nAllow: /.well-known/\nDisallow: /api/\nDisallow: /oauth/\nDisallow: /admin-oauth/\nDisallow: /admin-mcp\nDisallow: /mcp$\nSitemap: ' + setup_document()['guide_url'].removesuffix('/mcp-setup') + '/mcp-sitemap.xml\n')


@router.api_route('/llms.txt', methods=['GET', 'HEAD'])
def llms():
    doc = setup_document()
    return PlainTextResponse('# ' + doc['name'] + '\n\n' + doc['data_notice'] + '\n\n- [MCP setup](' + doc['guide_url'] + ')\n- [Setup JSON](' + doc['guide_url'].removesuffix('/mcp-setup') + '/mcp/setup.json)\n\n' + doc['automatic_setup_limit'] + '\n')


@router.api_route('/mcp-sitemap.xml', methods=['GET', 'HEAD'])
def sitemap():
    return Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' + escape(setup_document()['guide_url']) + '</loc></url></urlset>', media_type='application/xml')
