from scaffold.routers.public_privacy import policy_html


def test_public_privacy_is_readable_without_login_or_javascript(client):
    response = client.get('/privacy-policy')
    assert response.status_code == 200
    assert '<h1>Privacy Policy</h1>' in response.text
    assert 'admin:reports:sensitive' in response.text
    assert '30 days' in response.text
    assert '<script' not in response.text
    plain = client.get('/privacy.md')
    assert plain.status_code == 200
    assert plain.text.startswith('# Privacy Policy')
    assert client.head('/privacy-policy').status_code == 200
    assert client.get('/.well-known/oauth-protected-resource/mcp').json()['resource_policy_uri'].endswith('/privacy-policy')


def test_public_privacy_renderer_never_interprets_raw_html_or_script_links():
    rendered = policy_html('# Policy\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert)\n\n- **safe**')
    assert '<script>' not in rendered
    assert '&lt;script&gt;' in rendered
    assert 'href="javascript:' not in rendered
    assert '<li><strong>safe</strong></li>' in rendered


def test_public_terms_are_readable_without_sign_in_or_javascript(client):
    response = client.get('/terms')
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('text/html')
    assert '<h1>Epic Stocks Terms of Use</h1>' in response.text
    assert '<h2>Connecting an AI assistant</h2>' in response.text
    assert '<h2>Release and limitation of liability</h2>' in response.text
    assert '<strong>US $1</strong>' in response.text
    assert 'Dane County, Wisconsin' in response.text
    assert 'https://epic-stocks.com/privacy-policy' in response.text
    assert 'https://epic-stocks.com/support' in response.text
    assert '<script' not in response.text
    assert client.head('/terms').status_code == 200
    metadata = client.get('/.well-known/oauth-protected-resource/mcp').json()
    assert metadata['resource_tos_uri'] == metadata['resource_documentation'].removesuffix('/mcp-setup') + '/terms'
    assert '<a href="/terms">Terms of Use</a>' in client.get('/mcp-setup').text


def test_public_support_is_readable_without_sign_in(client):
    response = client.get('/support')
    assert response.status_code == 200
    assert 'Report a problem privately' in response.text
    assert 'Public issues are visible to everyone' in response.text
    assert '30 days' in response.text
    assert client.head('/support').status_code == 200


def test_privacy_preserves_ordered_lists_and_inline_code(client):
    body = client.get('/privacy-policy').text
    assert body.count('<ol>') == 3
    assert body.count('</ol>') == 3
    assert '<li><strong>Self-host</strong>' in body
    assert '<code>KEY_ENCRYPTION_KEY</code>' in body
    assert '<a href="https://github.com/rahulshahepic/epic-stocks/blob/main/PRIVACY.md"><code>PRIVACY.md</code></a>' in body
    assert '<code>[not a link](https://example.invalid)</code>' in policy_html('`[not a link](https://example.invalid)`')
    assert 'Plain-text policy' not in client.get('/support').text


def test_llms_document_starts_with_h1_and_keeps_policy_support_links(client):
    text = client.get('/llms.txt').text
    assert text.startswith('# Epic Stocks\n\n> ')
    assert '[Privacy policy](https://epic-stocks.com/privacy-policy)' in text
    assert '[Support](https://epic-stocks.com/support)' in text
