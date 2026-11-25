import pytest
from directory_reviewer_smoke import Inputs, run


def test_deployment_acceptance_refuses_production_before_database_or_network(monkeypatch):
    monkeypatch.setenv('APP_ENV', 'production')
    monkeypatch.setenv('DOMAIN', 'epic-stocks.com')
    with pytest.raises(RuntimeError, match='staging-only'):
        run()


def test_deployment_acceptance_refuses_ambiguous_staging(monkeypatch):
    monkeypatch.setenv('APP_ENV', 'staging')
    monkeypatch.setenv('DOMAIN', 'example.invalid')
    with pytest.raises(RuntimeError, match='staging-only'):
        run()


def test_acceptance_form_parser_reads_hidden_fields_and_unescapes():
    assert Inputs('<input name="request" value="a&amp;b"><input name="csrf" value="test">').values == {'request': 'a&b', 'csrf': 'test'}


def test_staging_acceptance_exercises_oauth_writes_revocation_and_cleanup(client, db_session, monkeypatch, capsys):
    import httpx
    from scaffold.models import ReviewerAccount, User
    from scaffold.oauth.models import OAuthClient
    import directory_reviewer_smoke
    original = httpx.Client
    def relay(request):
        response = client.request(request.method, str(request.url), headers=dict(request.headers), content=request.read(), follow_redirects=False)
        return httpx.Response(response.status_code, headers=response.headers.multi_items(), content=response.content, request=request)
    def local_client(**kwargs):
        return original(**kwargs, transport=httpx.MockTransport(relay))
    monkeypatch.setenv('APP_ENV', 'staging')
    monkeypatch.setenv('DOMAIN', 'staging.epic-stocks.com')
    monkeypatch.setattr(directory_reviewer_smoke.httpx, 'Client', local_client)
    run()
    output = capsys.readouterr().out
    assert '"status": "passed"' in output
    assert 'password' not in output and 'access_token' not in output
    assert db_session.query(ReviewerAccount).count() == 0
    assert db_session.query(User).filter_by(is_synthetic=True).count() == 0
    assert db_session.query(OAuthClient).filter(OAuthClient.client_name.like('Directory deployment acceptance%')).count() == 0
