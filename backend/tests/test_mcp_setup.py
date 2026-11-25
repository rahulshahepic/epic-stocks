import io
import json
import zipfile
from unittest.mock import patch

import pytest


@pytest.mark.parametrize('domain,environment,url', [('epic-stocks.com', 'production', 'https://epic-stocks.com/mcp'),
    ('staging.epic-stocks.com', 'staging', 'https://staging.epic-stocks.com/mcp'),
    ('custom.example.org', 'self-hosted', 'https://custom.example.org/mcp')])
def test_public_setup_has_no_auth_or_host_spoofing(client, domain, environment, url):
    with patch.dict('os.environ', {'DOMAIN': domain}):
        doc = client.get('/mcp/setup.json', headers={'Host': 'evil.example'}).json()
        assert doc['environment'] == environment
        assert doc['server_url'] == url
        assert client.get('/mcp-setup').status_code == 200
        assert url in client.get('/mcp-setup').text
        assert doc['guide_url'] in client.get('/mcp-sitemap.xml').text
        assert '/mcp-setup' in client.get('/robots.txt').text
        assert '/mcp/setup.json' in client.get('/llms.txt').text
        assert client.get('/api/grants').status_code == 401
        assert client.post('/mcp', json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}).status_code == 401


def test_public_setup_explains_chatgpt_eligibility_before_connection_steps(client):
    requirements = client.get('/mcp/setup.json').json()['chatgpt_requirements']
    notice = requirements['notice']
    assert 'Epic’s ChatGPT Enterprise workspace currently blocks custom connectors.' in notice
    assert 'ChatGPT Free cannot add custom connectors.' in notice
    assert 'import your Eureka CSV or Stock Loan Statement directly' in notice
    page = client.get('/mcp-setup').text
    assert page.index(notice) < page.index('Add custom MCP server')
    assert requirements['docs_url'] in page
    assert notice in client.get('/llms.txt').text


@pytest.mark.parametrize('domain,staging', [('epic-stocks.com', False), ('staging.epic-stocks.com', True)])
def test_public_discovery_explains_value_and_first_import(client, domain, staging):
    with patch.dict('os.environ', {'DOMAIN': domain}):
        doc = client.get('/mcp/setup.json').json()
        page = client.get('/mcp-setup').text
        llms = client.get('/llms.txt').text

    for surface in (page, llms, json.dumps(doc)):
        assert 'when your shares vest' in surface
        assert 'if you left Epic' in surface
        assert 'get_import_guide' in surface
        assert 'Enable Equity editing before previewing or saving changes.' in surface
        if staging:
            assert 'get_account_context' in surface
            assert 'fictional documents only' in surface
        else:
            assert 'DocuSign' in surface
            assert 'Stock Loan Statement' in surface
            assert 'Eureka' in surface
            assert 'before saving' in surface
    if not staging:
        assert doc['first_run']['import']['required_scope'] == 'equity:write'


@pytest.mark.parametrize('platform', ['chatgpt', 'claude'])
def test_staging_public_packages_target_staging_only(client, platform):
    with patch.dict('os.environ', {'DOMAIN': 'staging.epic-stocks.com'}):
        response = client.get('/mcp-setup/plugin/' + platform)
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as bundle:
        config = json.loads(bundle.read('mcp.json' if platform == 'chatgpt' else '.mcp.json'))
        assert config['mcpServers']['epic-stocks-staging-test']['url'] == 'https://staging.epic-stocks.com/mcp'
        manifest = json.loads(bundle.read('plugin.json' if platform == 'chatgpt' else '.claude-plugin/plugin.json'))
        assert 'fictional' in manifest['description']
        assert 'secret' not in json.dumps(config).lower()


def test_oauth_metadata_links_to_public_guide(client):
    assert client.get('/.well-known/oauth-protected-resource/mcp').json()['resource_documentation'].endswith('/mcp-setup')
    assert client.get('/.well-known/oauth-authorization-server').json()['service_documentation'].endswith('/mcp-setup')


def test_staging_mcp_is_explicitly_test_data(client):
    from tests.conftest import register_user
    from tests.test_mcp_tools import Mcp
    register_user(client)
    with patch.dict('os.environ', {'DOMAIN': 'staging.epic-stocks.com'}):
        mcp = Mcp(client)
        init = client.post('/mcp', headers=mcp.auth, json={'jsonrpc': '2.0', 'id': 9, 'method': 'initialize', 'params': {}})
        assert init.status_code == 200
        result = init.json()['result']
        assert result['serverInfo']['name'] == 'epic-stocks-staging-test'
        assert 'Never sync' in result['instructions']

        assert 'setup_test_account' in mcp.error('get_dashboard')
        mcp.call('setup_test_account', scenario='early')
        tool_result = mcp.raw_call('get_dashboard')
        assert tool_result['_meta']['epic-stocks/environment'] == 'staging-test-data'


def test_cloudflare_plan_only_exempts_public_documents():
    from pathlib import Path
    from scaffold.routers.mcp_setup import PUBLIC_PATHS
    plan = json.loads((Path(__file__).resolve().parents[2] / 'ops/cloudflare_mcp_discovery.json').read_text())
    assert set(plan['public_paths']) == set(PUBLIC_PATHS)
    assert plan['body']['expression'].startswith('(' + plan['previous_expression'] + ') and not ')
    assert 'http.request.method in {"GET" "HEAD"}' in plan['body']['expression']
    assert not any(p.startswith('/api/') or p in {'/mcp', '/admin-mcp'} for p in plan['public_paths'])
    assert plan['body']['action'] == 'managed_challenge'
    assert plan['browser_integrity_rule']['expression'] == plan['body']['expression'].removeprefix(
        '(' + plan['previous_expression'] + ') and not '
    )
    assert plan['browser_integrity_rule']['action'] == 'skip'
    assert plan['browser_integrity_rule']['action_parameters'] == {'products': ['bic']}


def test_public_setup_supports_head_and_never_sets_account_cookies(client):
    for path in ('/mcp-setup', '/mcp-setup.css', '/mcp/setup.json', '/robots.txt', '/llms.txt', '/mcp-sitemap.xml'):
        response = client.head(path)
        assert response.status_code == 200
        assert 'set-cookie' not in response.headers


def test_fresh_staging_oauth_registration_and_environment_binding(client):
    from tests.conftest import register_user
    from tests.test_oauth_server import connect
    register_user(client)
    with patch.dict('os.environ', {'DOMAIN': 'staging.epic-stocks.com'}):
        doc = client.get('/.well-known/oauth-authorization-server').json()
        assert doc['registration_endpoint'] == 'https://staging.epic-stocks.com/oauth/register'
        assert doc['authorization_endpoint'] == 'https://staging.epic-stocks.com/oauth/authorize'
        tokens = connect(client)
        response = client.post('/mcp', headers={'Authorization': 'Bearer ' + tokens['access_token']},
                               json={'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}})
        assert response.status_code == 200, response.text
        assert response.json()['result']['serverInfo']['name'] == 'epic-stocks-staging-test'
    with patch.dict('os.environ', {'DOMAIN': 'epic-stocks.com'}):
        assert client.post('/mcp', headers={'Authorization': 'Bearer ' + tokens['access_token']},
                           json={'jsonrpc': '2.0', 'id': 2, 'method': 'initialize', 'params': {}}).status_code == 401


def test_unknown_staging_client_has_recovery_without_accepting_registration(client):
    with patch.dict('os.environ', {'DOMAIN': 'staging.epic-stocks.com'}):
        response = client.get('/oauth/authorize', params={'client_id': 'not-a-staging-client'}, follow_redirects=False)
    assert response.status_code == 400
    assert 'Add Epic Stocks Staging Test as a new app' in response.text
    assert 'href="/mcp-setup"' in response.text
    assert 'location' not in response.headers


def test_public_setup_leads_with_people_steps_and_collapses_protocol_details(client):
    text = client.get('/mcp-setup').text
    assert '<h1>Connect an AI assistant</h1>' in text
    assert '<h2>ChatGPT</h2>' in text
    assert '<h2>Claude</h2>' in text
    assert text.index('<details>') < text.index('Streamable HTTP')
    assert '/mcp/setup.json' in text
