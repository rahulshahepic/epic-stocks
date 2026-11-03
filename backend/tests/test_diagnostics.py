import importlib.util
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from services import diagnostics as diag, diagnostic_sources as sources
from scaffold.models import SystemSettings
from tests.conftest import register_user
from tests.test_mcp_admin import _connect_admin, _rpc


@pytest.fixture(autouse=True)
def source_setup(monkeypatch):
    sources._cache.clear()
    monkeypatch.setenv('APP_ENV', 'staging')
    monkeypatch.setenv('COMMIT_SHA', 'a' * 40)
    monkeypatch.delenv('DIAGNOSTICS_CF_API_TOKEN', raising=False)
    monkeypatch.delenv('DIAGNOSTICS_GITHUB_REPOSITORY', raising=False)


def snapshot(monkeypatch, tmp_path, *, age=0, environment='staging', rows=None):
    now = datetime.now(timezone.utc)
    path = tmp_path / 'host.json'
    path.write_text(json.dumps({'environment': environment,
                               'collected_at_utc': (now - timedelta(seconds=age)).isoformat(),
                               'history_started_at_utc': now.isoformat(), 'events': rows or []}))
    monkeypatch.setenv('DIAGNOSTICS_HOST_FILE', str(path))
    return path


def test_host_fresh_stale_unavailable_and_environment(monkeypatch, tmp_path):
    row = diag.event('container_oom', api_build='a' * 40)
    row.update(message='account-secret', headers={'cookie': 'session-secret'})
    snapshot(monkeypatch, tmp_path, rows=[row])
    result = diag.host_snapshot()
    assert result['state'] == 'available' and result['environment'] == 'staging'
    assert result['records'][0]['event_code'] == 'container_oom'
    assert 'secret' not in json.dumps(result)
    snapshot(monkeypatch, tmp_path, age=181, rows=[row])
    assert diag.host_snapshot()['state'] == 'stale'
    path = snapshot(monkeypatch, tmp_path, environment='production', rows=[row])
    assert diag.host_snapshot()['state'] == 'unavailable'
    path.write_bytes(b'x' * (diag.MAX_BYTES + 1))
    assert diag.host_snapshot()['state'] == 'unavailable'
    path.unlink()
    assert diag.host_snapshot()['state'] == 'unavailable'


def test_host_retention_bounds_bad_clock_and_envelopes(monkeypatch, tmp_path):
    now = datetime.now(timezone.utc)
    rows = [diag.event('container_restarted', now=now - timedelta(minutes=i), api_build='private-price') for i in range(70)]
    rows.append(diag.event('container_oom', now=now - timedelta(hours=73)))
    path = snapshot(monkeypatch, tmp_path, rows=rows)
    result = diag.host_snapshot(3)
    assert len(result['records']) == 3 and result['record_limit_reached']
    assert result['records'][0]['api_build'] is None
    snapshot(monkeypatch, tmp_path, age=-600)
    assert diag.host_snapshot()['state'] == 'unavailable'
    path.write_text(json.dumps({'environment': 'staging', 'collected_at_utc': now.isoformat(),
                                'history_started_at_utc': now.isoformat(), 'events': rows * 2}))
    assert diag.host_snapshot()['state'] == 'unavailable'
    path.write_text('null')
    assert diag.host_snapshot()['state'] == 'unavailable'


def test_scheduler_history_failure_recovery_retention(db_session):
    diag.record_scheduler(db_session, {'notifications': 'failed'}, {})
    db_session.commit()
    diag.record_scheduler(db_session, {'notifications': 'completed'}, {'notifications': 'failed'})
    db_session.add(SystemSettings(key='scheduled:runner:last_finished_at', value=datetime.now(timezone.utc).isoformat()))
    db_session.commit()
    result = diag.scheduler_history(db_session)
    assert result['state'] == 'available'
    assert [r['event_code'] for r in result['records']] == ['notifications_recovered', 'notifications_failed']
    for _ in range(100):
        diag.record_scheduler(db_session, {'notifications': 'failed', 'untrusted-secret': 'failed'}, {})
        db_session.commit()
    row = db_session.get(SystemSettings, diag.SCHEDULER_HISTORY_KEY)
    assert len(json.loads(row.value)) == 96 and 'untrusted' not in row.value
    old = diag.event('notifications_failed', now=datetime.now(timezone.utc) - timedelta(hours=73))
    row.value = json.dumps([old])
    db_session.commit()
    assert diag.scheduler_history(db_session)['records'] == []
    db_session.get(SystemSettings, 'scheduled:runner:last_finished_at').value = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    db_session.commit()
    assert diag.scheduler_history(db_session)['state'] == 'stale'


def run_row(branch='staging', conclusion='failure', sha='b' * 40):
    return {'id': 42, 'head_branch': branch, 'event': 'push', 'head_sha': sha,
            'status': 'completed', 'conclusion': conclusion, 'created_at': '2026-11-01T00:00:00Z',
            'run_started_at': '2026-11-01T00:01:00Z', 'updated_at': '2026-11-01T00:02:00Z',
            'display_title': 'private-message', 'actor': {'email': 'private-email'}}


def test_deploy_filter_correlation_and_no_raw_metadata(monkeypatch):
    monkeypatch.setenv('DIAGNOSTICS_GITHUB_REPOSITORY', 'rahulshahepic/epic-stocks')
    def response(method, url, **kwargs):
        assert url.endswith('/epic-stocks/actions/workflows/deploy.yml/runs')
        assert kwargs['params'] == {'branch': 'staging', 'per_page': 20}
        return {'total_count': 100, 'workflow_runs': [run_row(), run_row(sha='a' * 40, conclusion='success'), run_row(branch='main')]}
    monkeypatch.setattr(sources, '_json', response)
    result = sources.deployments()
    assert result['state'] == 'available' and len(result['records']) == 2
    assert result['latest_failed_run']['conclusion'] == 'failure'
    assert result['running_build_successful_run']['commit'] == 'a' * 40
    assert 'private' not in json.dumps(result) and result['record_limit_reached']
    monkeypatch.setenv('APP_ENV', 'invalid')
    assert sources.deployments()['state'] == 'unavailable'


def test_sources_fail_closed_and_cache_failures(monkeypatch):
    assert sources.deployments()['state'] == sources.edge_summary()['state'] == 'unavailable'
    monkeypatch.setenv('DIAGNOSTICS_GITHUB_REPOSITORY', 'rahulshahepic/epic-stocks')
    with patch.object(sources, '_json', side_effect=httpx.ReadTimeout('secret-token')) as fetch:
        result = sources.deployments()
        assert result['state'] == sources.deployments()['state'] == 'unavailable'
        assert fetch.call_count == 1 and 'secret-token' not in json.dumps(result)


def test_edge_hostname_filter_redaction_and_permission_errors(monkeypatch):
    monkeypatch.setenv('DIAGNOSTICS_CF_ZONE_ID', 'c' * 32)
    monkeypatch.setenv('DIAGNOSTICS_CF_API_TOKEN', 'private-token')
    monkeypatch.setenv('DOMAIN', 'staging.epic-stocks.com')
    def response(method, url, **kwargs):
        assert url == 'https://api.cloudflare.com/client/v4/graphql'
        assert kwargs['json']['variables']['filter']['clientRequestHTTPHost'] == 'staging.epic-stocks.com'
        assert 'clientIP' not in kwargs['json']['query']
        return {'data': {'viewer': {'zones': [{'firewallEventsAdaptiveGroups': [
            {'count': 7, 'dimensions': {'action': 'block', 'clientIP': 'private-ip'}, 'cookie': 'private-cookie'}]}]}}}
    monkeypatch.setattr(sources, '_json', response)
    result = sources.edge_summary()
    assert result['state'] == 'available' and result['records'] == [{'action': 'block', 'count': 7}]
    assert 'private' not in json.dumps(result)
    sources._cache.clear()
    monkeypatch.setattr(sources, '_json', lambda *a, **k: {'errors': [{'message': 'private-error'}]})
    assert sources.edge_summary()['state'] == 'unavailable'


def collector_module():
    spec = importlib.util.spec_from_file_location('collector', Path(__file__).resolve().parents[2] / 'ops/collect_diagnostics.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_collector_failure_recovery_gaps_and_atomic_bounded_output(tmp_path, monkeypatch):
    collector = collector_module()
    path = tmp_path / 'host.json'
    values = {'docker': '\"running\"|false|1|healthy|' + 'a' * 40, 'systemctl': 'Result=success\nExecMainStartTimestampMonotonic=123\nActiveState=inactive'}
    monkeypatch.setattr(collector, 'command', lambda args: values[Path(args[0]).name])
    collector.collect('staging', path)
    assert oct(path.stat().st_mode & 0o777) == '0o644'
    values['docker'] = '\"exited\"|true|2|unhealthy|' + 'a' * 40
    values['systemctl'] = 'Result=exit-code\nExecMainStartTimestampMonotonic=123'
    collector.collect('staging', path)
    data = json.loads(path.read_text())
    assert {e['event_code'] for e in data['events']} >= {'container_oom', 'container_restarted', 'scheduler_failed'}
    data['collected_at_utc'] = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    path.write_text(json.dumps(data))
    values['docker'] = '\"running\"|false|2|healthy|' + 'a' * 40
    values['systemctl'] = 'Result=success\nExecMainStartTimestampMonotonic=456\nActiveState=inactive'
    collector.collect('staging', path)
    data = json.loads(path.read_text())
    assert data['events'][-1]['event_code'] == 'collector_gap'
    assert data['states']['container'] == 'container_running'
    assert data['states']['scheduler'] == 'scheduler_succeeded'
    assert any(row['event_code'] == 'scheduler_recovered' for row in data['events'])
    monkeypatch.setenv('DIAGNOSTICS_HOST_FILE', str(path))
    assert diag.host_snapshot()['state'] == 'available'
    assert len(data['events']) <= 96 and path.stat().st_size <= diag.MAX_BYTES
    collector.collect('production', path)
    assert diag.host_snapshot()['state'] == 'unavailable'


def test_new_tools_audit_revocation_and_bounds(client, db_session, monkeypatch, tmp_path):
    from scaffold.oauth.models import McpAudit
    names = {'admin_host_diagnostics', 'admin_scheduler_history', 'admin_deploy_runs', 'admin_edge_summary'}
    snapshot(monkeypatch, tmp_path)
    with patch.dict(os.environ, {'ADMIN_EMAIL': 'admin@example.com'}):
        register_user(client, 'admin@example.com')
        tokens = _connect_admin(client)
        for name in names:
            response = _rpc(client, tokens['access_token'], 'tools/call', {'name': name, 'arguments': {}})
            result = json.loads(response['content'][0]['text'])
            assert result['environment'] == 'staging' and result['source']
        audits = db_session.query(McpAudit).all()
        assert names <= {row.tool for row in audits}
        for name in ('admin_host_diagnostics', 'admin_scheduler_history'):
            assert _rpc(client, tokens['access_token'], 'tools/call', {'name': name, 'arguments': {'limit': 100}})['isError']
    for name in names:
        assert _rpc(client, tokens['access_token'], 'tools/call', {'name': name, 'arguments': {}})['isError']


def test_provider_transport_bounds_and_redirect_refusal(monkeypatch):
    with httpx.Client(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, content=b'x' * (diag.MAX_BYTES + 1)))) as provider:
        monkeypatch.setattr(sources.httpx, 'stream', provider.stream)
        with pytest.raises(ValueError, match='too large'):
            sources._json('GET', 'https://api.github.com/example')
    with httpx.Client(transport=httpx.MockTransport(
            lambda request: httpx.Response(302, headers={'Location': 'https://untrusted.example/'}))) as provider:
        monkeypatch.setattr(sources.httpx, 'stream', provider.stream)
        with pytest.raises(httpx.HTTPStatusError):
            sources._json('GET', 'https://api.github.com/example')


def test_collector_has_no_scheduler_success_before_first_run(tmp_path, monkeypatch):
    collector = collector_module()
    values = {'docker': None, 'systemctl': 'Result=success\nExecMainStartTimestampMonotonic=0\nActiveState=inactive'}
    monkeypatch.setattr(collector, 'command', lambda args: values[Path(args[0]).name])
    path = tmp_path / 'host.json'
    collector.collect('staging', path)
    result = json.loads(path.read_text())
    assert result['states']['scheduler'] == 'scheduler_unavailable'
    assert result['states']['container'] == 'container_unavailable'


def test_not_due_job_does_not_falsely_report_recovery(db_session):
    diag.record_scheduler(db_session, {'notifications': 'not_due'}, {'notifications': 'failed'})
    db_session.commit()
    assert json.loads(db_session.get(SystemSettings, diag.SCHEDULER_HISTORY_KEY).value) == []
    diag.record_scheduler(db_session, {'notifications': 'completed'}, {'runner': 'failed'})
    db_session.commit()
    assert json.loads(db_session.get(SystemSettings, diag.SCHEDULER_HISTORY_KEY).value)[0]['event_code'] == 'runner_recovered'


def test_running_service_does_not_report_success(tmp_path, monkeypatch):
    collector = collector_module()
    values = {'docker': None, 'systemctl': 'Result=success\nExecMainStartTimestampMonotonic=123\nActiveState=activating'}
    monkeypatch.setattr(collector, 'command', lambda args: values[Path(args[0]).name])
    path = tmp_path / 'host.json'
    collector.collect('staging', path)
    result = json.loads(path.read_text())
    assert result['states']['scheduler'] == 'scheduler_unavailable'
    assert not any(row['event_code'] in {'scheduler_succeeded', 'scheduler_recovered'} for row in result['events'])
