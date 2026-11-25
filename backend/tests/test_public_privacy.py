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
