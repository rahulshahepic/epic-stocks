"""Deployment-only staging acceptance. Temporary fictional accounts, never production."""
import base64
import hashlib
from html.parser import HTMLParser
import json
import os
from urllib.parse import parse_qs, urlparse
import uuid

import httpx


class Inputs(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.values = {}
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'input' and 'name' in attrs and 'value' in attrs:
            self.values[attrs['name']] = attrs['value']


def check(response, status):
    if response.status_code != status:
        raise RuntimeError(f'Staging reviewer acceptance expected HTTP {status}, got {response.status_code}')
    return response


def run():
    if os.getenv('APP_ENV') != 'staging' or os.getenv('DOMAIN') != 'staging.epic-stocks.com':
        raise RuntimeError('Directory reviewer deployment acceptance is staging-only')
    # Importing the composition root registers the existing financial fixture provider.
    import main  # noqa: F401
    from database import SessionLocal
    from scaffold import reviewers
    from scaffold.crypto import initialize_master_key
    from scaffold.models import ReviewerAccount
    from scaffold.oauth import admin_actions, admin_journal
    from scaffold.oauth.models import OAuthClient
    from scaffold.routers.reviewers import manage
    from scaffold.user_deletion import delete_user

    origin = 'https://staging.epic-stocks.com'
    created, clients, sessions = [], [], []
    client_name = 'Directory deployment acceptance ' + uuid.uuid4().hex
    actor = admin_actions.Actor(via='system', email=None)
    with SessionLocal() as db:
        initialize_master_key(db)
        journal = admin_journal.begin(db, via='system', action='directory_reviewer_acceptance', actor_email=None)
        phase = 'provision'
        try:
            for index, platform in enumerate(('openai', 'anthropic')):
                raw, digest = reviewers.credentials()
                def provision(platform=platform, digest=digest):
                    result = reviewers.grant_access(db, {'platform': platform, 'scenario': 'established', 'days': 1, 'credential_hash': digest})
                    db.commit()
                    return result, result
                info = admin_actions._run(db, actor, 'reviewer_acceptance_provision', 'reviewer', None, None, provision)
                created.append((info['id'], info['login']))
                client = httpx.Client(base_url=origin, timeout=20, follow_redirects=False,
                                     headers={'User-Agent': 'EpicStocksDirectoryAcceptance/1.0', 'Accept': 'text/html, application/json'})
                sessions.append(client)
                phase = 'login_page'
                login = check(client.get('/reviewer-login'), 200)
                csrf = Inputs(login.text).values['csrf']
                phase = 'login'
                check(client.post('/reviewer-login', data={'login': info['login'], 'password': raw, 'csrf': csrf}), 303)
                phase = 'client_registration'
                registration = check(client.post('/oauth/register', json={
                    'client_name': client_name, 'redirect_uris': ['https://claude.ai/api/mcp/auth_callback'],
                    'token_endpoint_auth_method': 'none'}), 201).json()
                cid = registration['client_id']
                clients.append(cid)
                verifier = reviewers.credentials()[0]
                challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
                scopes = 'equity:read equity:write comp:read comp:write'
                phase = 'consent_page'
                consent = check(client.get('/oauth/authorize', params={
                    'client_id': cid, 'redirect_uri': 'https://claude.ai/api/mcp/auth_callback',
                    'response_type': 'code', 'scope': scopes, 'state': 'staging-acceptance',
                    'resource': origin + '/mcp', 'code_challenge': challenge, 'code_challenge_method': 'S256'}), 200)
                inputs = Inputs(consent.text).values
                phase = 'consent_decision'
                authorized = check(client.post('/oauth/authorize', data={
                    'request': inputs['request'], 'csrf': inputs['csrf'], 'decision': 'allow',
                    'permission_selection': '1', 'selected_scope': scopes.split()}), 302)
                code = parse_qs(urlparse(authorized.headers['location']).query)['code'][0]
                phase = 'token_exchange'
                tokens = check(client.post('/oauth/token', data={
                    'grant_type': 'authorization_code', 'code': code, 'client_id': cid,
                    'code_verifier': verifier, 'redirect_uri': 'https://claude.ai/api/mcp/auth_callback',
                    'resource': origin + '/mcp'}), 200).json()
                bearer = {'Authorization': 'Bearer ' + tokens['access_token']}
                def tool(name, args=None, client=client, bearer=bearer):
                    nonlocal phase
                    phase = 'tool_' + name
                    result = check(client.post('/mcp', headers=bearer, json={'jsonrpc': '2.0', 'id': 1,
                        'method': 'tools/call', 'params': {'name': name, 'arguments': args or {}}}), 200).json()['result']
                    if result.get('isError'):
                        raise RuntimeError('Staging reviewer financial tool failed')
                    return json.loads(result['content'][0]['text'])
                phase = 'financial_tools'
                context = tool('get_account_context')
                if not context.get('synthetic') or context.get('platform') != platform:
                    raise RuntimeError('Staging reviewer MCP context mismatch')
                tool('get_dashboard')
                changes = [{'kind': 'price', 'action': 'create', 'values': {'effective_date': '2044-01-01', 'price': 1000 + index * 100}}]
                preview = tool('apply_changes', {'changes': changes})
                tool('apply_changes', {'changes': changes, 'confirm': preview['confirm']})
                listed = tool('list_prices', {'include_projections': True})
                prices = listed['prices'] + listed.get('projected_prices', [])
                if not any(p['effective_date'] == '2044-01-01' and p['price'] == 1000 + index * 100 for p in prices):
                    raise RuntimeError('Staging reviewer write did not persist')
                if client.post('/admin-mcp', headers=bearer, json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}).status_code not in (401, 403):
                    raise RuntimeError('Staging reviewer admin boundary failed')
                # Revoke through the exact service used by browser/admin MCP management.
                phase = 'revoke'
                pending = manage(db, info['id'], 'revoke', None, actor)
                manage(db, info['id'], 'revoke', pending['confirm'], actor)
                if client.post('/mcp', headers=bearer, json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}).status_code != 401:
                    raise RuntimeError('Staging reviewer revocation failed')
            admin_journal.finish(db, journal, outcome=admin_journal.OK, after={'reviewers': 2, 'environment': 'staging'})
        except Exception as exc:
            db.rollback()
            admin_journal.finish(db, journal, outcome=admin_journal.FAILED, detail='Staging reviewer acceptance failed; no credential or financial payload logged')
            raise RuntimeError(f'Staging reviewer acceptance failed at {phase} ({type(exc).__name__}); no sensitive payload logged') from None
        finally:
            for client in sessions:
                client.close()
            db.rollback()
            for rid, login in created:
                row = db.get(ReviewerAccount, rid)
                if row and row.login == login:
                    delete_user(db, row.user_id)
                    db.commit()
            if clients:
                db.query(OAuthClient).filter(OAuthClient.client_id.in_(clients), OAuthClient.client_name == client_name).delete(synchronize_session=False)
                db.commit()
    print(json.dumps({'status': 'passed', 'environment': 'staging', 'temporary_reviewers': 2,
                      'oauth': True, 'persistent_writes': True, 'admin_refusal': True, 'revocation': True, 'cleanup': True}))


if __name__ == '__main__':
    run()
