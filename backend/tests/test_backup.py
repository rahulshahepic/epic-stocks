"""Off-site backup: signing, the run against a fake S3 server, pruning, failure status and installer."""
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import textwrap
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

REPO = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 11, 7, 3, 20, tzinfo=timezone.utc)
RECIPIENT = "age1" + "q" * 58


def load(name):
    spec = importlib.util.spec_from_file_location(name, REPO / f"ops/{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


backup = load("backup_database")


class FakeS3(BaseHTTPRequestHandler):
    objects: dict = {}
    log: list = []
    fail: set = set()

    def log_message(self, *args):
        pass

    def _key(self):
        return urlsplit(self.path).path.split("/", 2)[2] if self.path.count("/") >= 2 else ""

    def _reply(self, status, body=b"", headers=None):
        headers = {"Content-Length": str(len(body)), **(headers or {})}
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _authorized(self):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("AWS4-HMAC-SHA256 Credential=AKID/") or "Signature=" not in auth:
            self._reply(403, b"<Error><Code>AccessDenied</Code></Error>")
            return False
        if self.command in self.fail:
            self._reply(500, b"<Error><Code>InternalError</Code></Error>")
            return False
        return True

    def do_PUT(self):
        if not self._authorized():
            return
        body = self.rfile.read(int(self.headers["Content-Length"]))
        assert hashlib.sha256(body).hexdigest() == self.headers["x-amz-content-sha256"]
        self.objects[self._key()] = body
        self.log.append(("PUT", self._key()))
        self._reply(200)

    def do_HEAD(self):
        if not self._authorized():
            return
        key = self._key()
        if key not in self.objects:
            return self._reply(404)
        self._reply(200, headers={"Content-Length": str(len(self.objects[key]))})

    def do_GET(self):
        if not self._authorized():
            return
        query = parse_qs(urlsplit(self.path).query)
        if "list-type" in query:
            prefix = query.get("prefix", [""])[0]
            keys = sorted(k for k in self.objects if k.startswith(prefix))
            start = int(query.get("continuation-token", ["0"])[0])
            page, more = keys[start:start + 5], start + 5 < len(keys)
            body = ('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                    + "".join(f"<Contents><Key>{k}</Key></Contents>" for k in page)
                    + f"<IsTruncated>{'true' if more else 'false'}</IsTruncated>"
                    + (f"<NextContinuationToken>{start + 5}</NextContinuationToken>" if more else "")
                    + "</ListBucketResult>").encode()
            return self._reply(200, body)
        key = self._key()
        if key not in self.objects:
            return self._reply(404, b"<Error><Code>NoSuchKey</Code></Error>")
        self._reply(200, self.objects[key])

    def do_DELETE(self):
        if not self._authorized():
            return
        self.objects.pop(self._key(), None)
        self.log.append(("DELETE", self._key()))
        self._reply(204)


@pytest.fixture()
def s3():
    FakeS3.objects, FakeS3.log, FakeS3.fail = {}, [], set()
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeS3)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


@pytest.fixture()
def host(tmp_path, s3, monkeypatch):
    """A deploy checkout with .secrets, a fake age (marks, doesn't encrypt) and storage env."""
    deploy = tmp_path / "deploy"
    (deploy / ".secrets").mkdir(parents=True)
    for name, value in {"jwt_secret": "jwt", "key_encryption_key": "THE-KEK", "vapid_private_key": "vapid"}.items():
        (deploy / ".secrets" / name).write_text(value)
    (deploy / ".env").write_text("APP_ENV=staging\nCOMMIT_SHA=" + "a" * 40 + "\n")
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "age").write_text(f"#!{sys.executable}\nimport sys\n"
                                "assert sys.argv[1:3] == ['-r', '" + RECIPIENT + "']\n"
                                "sys.stdout.buffer.write(b'FAKEAGE' + sys.stdin.buffer.read())\n")
    (bindir / "age").chmod(0o755)
    monkeypatch.setenv("PATH", f"{bindir}:{os.environ['PATH']}")
    env = {"BACKUP_S3_ENDPOINT": s3, "BACKUP_BUCKET": "bkt", "BACKUP_ACCESS_KEY_ID": "AKID",
           "BACKUP_SECRET_ACCESS_KEY": "TOP-SECRET-VALUE", "BACKUP_AGE_RECIPIENT": RECIPIENT}
    return deploy, env, tmp_path / "state" / "status.json"


def dump_cmd(payload='b"PGDMP" + b"x" * 300_000', code=0):
    return [sys.executable, "-c", f"import sys; sys.stdout.buffer.write({payload}); sys.exit({code})"]


def test_signature_matches_aws_published_example():
    headers = backup.sign_headers(
        "GET", "https://examplebucket.s3.amazonaws.com/test.txt",
        access_key="AKIAIOSFODNN7EXAMPLE", secret_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        payload_hash=hashlib.sha256(b"").hexdigest(), now=datetime(2013, 5, 24), region="us-east-1",
        extra={"Range": "bytes=0-9"})
    assert headers["authorization"].endswith("Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41")


def test_run_uploads_encrypted_dump_and_secrets_without_kek_manifest_last(host):
    deploy, env, status_path = host
    assert backup.run("staging", deploy, status_path, env=env, now=NOW, cmd=dump_cmd()) == 0
    prefix = "staging/20261107T032000Z"
    puts = [key for method, key in FakeS3.log if method == "PUT"]
    assert puts == [f"{prefix}/database.dump.age", f"{prefix}/secrets.tar.age", f"{prefix}/manifest.json"]
    assert FakeS3.objects[f"{prefix}/database.dump.age"] == b"FAKEAGE" + b"PGDMP" + b"x" * 300_000
    secrets = FakeS3.objects[f"{prefix}/secrets.tar.age"]
    assert secrets.startswith(b"FAKEAGE")
    with tarfile.open(fileobj=io.BytesIO(secrets[7:])) as tar:
        assert sorted(tar.getnames()) == ["jwt_secret", "vapid_private_key"]
    manifest = json.loads(FakeS3.objects[f"{prefix}/manifest.json"])
    assert manifest["kek_included"] is False and manifest["commit"] == "a" * 40
    assert manifest["database_encrypted_sha256"] == hashlib.sha256(FakeS3.objects[f"{prefix}/database.dump.age"]).hexdigest()
    assert b"THE-KEK" not in b"".join(FakeS3.objects.values())
    status = json.loads(status_path.read_text())
    assert status["last_result"] == "success" and status["last_success_utc"] == NOW.isoformat()
    assert oct(status_path.stat().st_mode & 0o777) == "0o644"
    assert "TOP-SECRET-VALUE" not in status_path.read_text() and "AKID" not in status_path.read_text()


@pytest.mark.parametrize("cmd, message", [
    (dump_cmd(code=3), "pg_dump exited 3"),
    (dump_cmd(payload='b"not a dump"'), "not a custom-format archive"),
])
def test_bad_dump_uploads_nothing_and_reports_failure(host, cmd, message):
    deploy, env, status_path = host
    backup.write_status(status_path, environment="staging", last_success_utc="2026-11-06T03:20:00+00:00")
    with pytest.raises(backup.BackupError, match=message):
        backup.run("staging", deploy, status_path, env=env, now=NOW, cmd=cmd)
    assert FakeS3.objects == {}
    status = json.loads(status_path.read_text())
    assert status["last_result"] == "failed" and status["last_success_utc"] == "2026-11-06T03:20:00+00:00"


def test_storage_failure_leaves_no_complete_run(host):
    deploy, env, status_path = host
    FakeS3.fail = {"HEAD"}
    with pytest.raises(backup.BackupError, match="HEAD failed: HTTP 500"):
        backup.run("staging", deploy, status_path, env=env, now=NOW, cmd=dump_cmd())
    assert not any(k.endswith("manifest.json") for k in FakeS3.objects)
    assert json.loads(status_path.read_text())["last_result"] == "failed"


def test_unconfigured_reports_without_network(host):
    deploy, _, status_path = host
    assert backup.run("staging", deploy, status_path, env={}, now=NOW, cmd=dump_cmd()) == 0
    assert FakeS3.log == []
    status = json.loads(status_path.read_text())
    assert status["configured"] is False and status["last_result"] == "unconfigured"


def test_invalid_recipient_is_a_failure_not_unconfigured(host):
    deploy, env, status_path = host
    with pytest.raises(backup.BackupError, match="age public key"):
        backup.run("staging", deploy, status_path, env={**env, "BACKUP_AGE_RECIPIENT": "ssh-ed25519 AAAA"}, now=NOW)
    assert json.loads(status_path.read_text())["last_result"] == "failed"


def test_r2_endpoint_from_account_id():
    cfg = backup.config({"BACKUP_R2_ACCOUNT_ID": "abc123", "BACKUP_BUCKET": "b", "BACKUP_ACCESS_KEY_ID": "k",
                         "BACKUP_SECRET_ACCESS_KEY": "s", "BACKUP_AGE_RECIPIENT": RECIPIENT})
    assert cfg["endpoint"] == "https://abc123.r2.cloudflarestorage.com" and cfg["retention_days"] == 30


def test_prune_keeps_newest_seven_and_retention_and_drops_stale_partials(s3):
    store = backup.Store(s3, "bkt", "AKID", "SECRET")
    def run_keys(days_ago, complete=True, environment="staging"):
        stamp = (NOW - timedelta(days=days_ago)).strftime(backup.STAMP_FORMAT)
        names = ["database.dump.age", "secrets.tar.age"] + (["manifest.json"] if complete else [])
        for name in names:
            FakeS3.objects[f"{environment}/{stamp}/{name}"] = b"x"
        return stamp
    recent = [run_keys(d) for d in range(0, 20)]           # 20 nightly runs
    ancient = [run_keys(d) for d in (40, 41)]                # past 30 days
    fresh_partial = run_keys(1.5, complete=False)
    run_keys(3.5, complete=False)  # stale partial: removed
    other_env = run_keys(90, environment="production")
    assert backup.prune(store, "staging", NOW, 30) == 3
    stamps = {k.split("/")[1] for k in FakeS3.objects if k.startswith("staging/")}
    assert stamps == set(recent) | {fresh_partial}
    assert other_env in {k.split("/")[1] for k in FakeS3.objects}
    deletes = [k for m, k in FakeS3.log if m == "DELETE" and ancient[0] in k]
    assert deletes[0].endswith("manifest.json")
    # Fewer than seven complete runs: nothing is deleted however old, so a stopped timer can't empty the bucket.
    FakeS3.objects.clear()
    old = [run_keys(d) for d in (100, 200, 300)]
    assert backup.prune(store, "staging", NOW, 30) == 0
    assert {k.split("/")[1] for k in FakeS3.objects} == set(old)


def test_fetch_lists_downloads_latest_and_verifies(host, tmp_path, monkeypatch):
    deploy, env, status_path = host
    backup.run("staging", deploy, status_path, env=env, now=NOW - timedelta(days=1), cmd=dump_cmd())
    backup.run("staging", deploy, status_path, env=env, now=NOW, cmd=dump_cmd())
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("BACKUP_AGE_RECIPIENT")
    dest = tmp_path / "restore"
    assert backup.main(["fetch", "--environment", "staging", "--dest", str(dest)]) == 0
    assert json.loads((dest / "manifest.json").read_text())["created_at_utc"] == NOW.isoformat()
    FakeS3.objects["staging/20261107T032000Z/database.dump.age"] = b"tampered"
    assert backup.main(["fetch", "--environment", "staging", "--dest", str(dest)]) == 1


@pytest.mark.skipif(not shutil.which("age") or not shutil.which("age-keygen"), reason="age not installed")
def test_real_age_round_trip(tmp_path, s3):
    key = tmp_path / "key.txt"
    out = subprocess.run(["age-keygen", "-o", str(key)], capture_output=True, text=True, check=True)
    recipient = out.stderr.strip().split()[-1]
    deploy = tmp_path / "deploy"
    (deploy / ".secrets").mkdir(parents=True)
    (deploy / ".secrets" / "jwt_secret").write_text("jwt")
    expression = 'b"PGDMP" + b"secret-figure-12345" * 1000'
    payload = eval(expression)
    env = {"BACKUP_S3_ENDPOINT": s3, "BACKUP_BUCKET": "bkt", "BACKUP_ACCESS_KEY_ID": "AKID",
           "BACKUP_SECRET_ACCESS_KEY": "s", "BACKUP_AGE_RECIPIENT": recipient}
    backup.run("production", deploy, tmp_path / "status.json", env=env, now=NOW, cmd=dump_cmd(expression))
    blob = FakeS3.objects["production/20261107T032000Z/database.dump.age"]
    assert b"secret-figure" not in blob
    plain = subprocess.run(["age", "-d", "-i", str(key)], input=blob, capture_output=True, check=True).stdout
    assert plain == payload


# ── Collector integration ───────────────────────────────────────────────────

collector = load("collect_diagnostics")


@pytest.mark.parametrize("status, expected", [
    (None, "backup_unavailable"),
    ({"environment": "production", "last_result": "success", "last_success_utc": NOW.isoformat()}, "backup_unavailable"),
    ({"environment": "staging", "configured": False, "last_result": "unconfigured"}, "backup_unconfigured"),
    ({"environment": "staging", "last_result": "failed", "last_success_utc": NOW.isoformat()}, "backup_failed"),
    ({"environment": "staging", "last_result": "success", "last_success_utc": (NOW - timedelta(hours=27)).isoformat()}, "backup_overdue"),
    ({"environment": "staging", "last_result": "success", "last_success_utc": (NOW - timedelta(hours=20)).isoformat()}, "backup_succeeded"),
])
def test_collector_backup_state(tmp_path, status, expected):
    path = tmp_path / "status.json"
    if status is not None:
        path.write_text(json.dumps(status))
    assert collector.backup_state("staging", path, NOW) == expected


def test_collector_reports_backup_recovery_and_app_accepts_states(tmp_path, monkeypatch):
    import services.diagnostics as diag
    monkeypatch.setattr(collector, "command", lambda args: None)
    status, output = tmp_path / "status.json", tmp_path / "host.json"
    status.write_text(json.dumps({"environment": "staging", "last_result": "failed"}))
    collector.collect("staging", output, status)
    status.write_text(json.dumps({"environment": "staging", "last_result": "success",
                                  "last_success_utc": datetime.now(timezone.utc).isoformat()}))
    collector.collect("staging", output, status)
    data = json.loads(output.read_text())
    assert data["states"]["backup"] == "backup_succeeded"
    assert {"backup_failed", "backup_recovered"} <= {e["event_code"] for e in data["events"]}
    assert set(collector._CODES) == set(diag.CODES) - {c for c in diag.CODES if c.split("_")[0] in
                                                        ("maintenance", "notifications", "admin", "runner")}
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.setenv("DIAGNOSTICS_HOST_FILE", str(output))
    snapshot = diag.host_snapshot()
    assert snapshot["state"] == "available" and snapshot["current_states"]["backup"] == "backup_succeeded"


# ── Installer and deploy guard ──────────────────────────────────────────────

@pytest.fixture()
def fake_host(tmp_path):
    root, commands, log = tmp_path / "host", tmp_path / "bin", tmp_path / "commands.log"
    commands.mkdir()
    fake = f'''#!{sys.executable}
import os, sys, shutil
from pathlib import Path
name, args = Path(sys.argv[0]).name, sys.argv[1:]
with open(os.environ['COMMAND_LOG'], 'a') as stream:
    stream.write(name + ' ' + ' '.join(args) + '\\n')
if os.environ.get('FAIL_COMMAND') == name:
    sys.exit(1)
root = Path(os.environ['HOST_ROOT'])
if name == 'install':
    mode = args[args.index('-m') + 1]
    if '-d' in args:
        for arg in args[args.index(mode) + 1:]:
            (root / arg.lstrip('/')).mkdir(parents=True, exist_ok=True)
    else:
        target = root / args[-1].lstrip('/')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args[-2], target)
        target.chmod(int(mode, 8))
if name == 'systemctl' and args[0] == 'start' and '--no-block' not in args:
    sys.exit(95)
'''
    for name in ("install", "systemctl", "apt-get", "age"):
        (commands / name).write_text(fake)
        (commands / name).chmod(0o755)
    checkout = tmp_path / "home" / "deployer" / "checkout"
    shutil.copytree(REPO / "ops", checkout / "ops")
    env = {**{k: v for k, v in os.environ.items() if not k.startswith("BACKUP_")},
           "PATH": f"{commands}:{os.environ['PATH']}", "HOST_ROOT": str(root), "COMMAND_LOG": str(log)}
    return checkout, root, log, env


def test_installer_writes_private_config_and_hardened_unit(fake_host):
    checkout, root, log, env = fake_host
    env.update(BACKUP_R2_ACCOUNT_ID="acct", BACKUP_BUCKET="epic-stocks-backup-staging",
               BACKUP_ACCESS_KEY_ID="AKID", BACKUP_SECRET_ACCESS_KEY="s3cr3t", BACKUP_AGE_RECIPIENT=RECIPIENT)
    subprocess.run(["bash", "ops/install_backup.sh", "staging", str(checkout)], cwd=checkout, env=env, check=True)
    config = root / "etc/epic-stocks/backup.env"
    assert oct(config.stat().st_mode & 0o777) == "0o600"
    assert "BACKUP_SECRET_ACCESS_KEY=s3cr3t\n" in config.read_text()
    unit = (root / "etc/systemd/system/epic-stocks-backup.service").read_text()
    assert f"run --environment staging --deploy-path {checkout}" in unit
    assert "/usr/local/lib/epic-stocks/backup_database.py" in unit and "@" not in unit
    assert "s3cr3t" not in unit and "EnvironmentFile=-/etc/epic-stocks/backup.env" in unit
    assert "ProtectSystem=strict" in unit and "ProtectHome=read-only" in unit
    commands = log.read_text()
    assert "systemctl enable --now epic-stocks-backup.timer" in commands
    assert "systemctl start --no-block epic-stocks-backup.service" in commands


@pytest.mark.parametrize("args, variable", [
    (["unexpected", "/opt/epic-stocks"], None),
    (["staging", "relative/path"], None),
    (["staging", "/opt/epic stocks"], None),
    (["staging", "/opt/epic-stocks"], "BACKUP_BUCKET"),
])
def test_installer_refuses_bad_input_before_host_changes(fake_host, args, variable):
    checkout, root, log, env = fake_host
    if variable:
        env[variable] = "bucket\nExecStart=/bin/evil"
    result = subprocess.run(["bash", "ops/install_backup.sh", *args], cwd=checkout, env=env, capture_output=True, text=True)
    assert result.returncode != 0
    assert not root.exists() and not log.exists()


@pytest.mark.parametrize("failed_command", ["install", "systemctl"])
def test_backup_failure_does_not_abort_deploy(fake_host, failed_command):
    checkout, root, log, env = fake_host
    (checkout / ".env").write_text("APP_ENV=staging\n")
    env["FAIL_COMMAND"] = failed_command
    workflow = (REPO / ".github/workflows/deploy.yml").read_text()
    start = workflow.index("            if ! BACKUP_R2_ACCOUNT_ID=")
    end = workflow.index("            fi\n", start) + len("            fi\n")
    guard = textwrap.dedent(workflow[start:end])
    guard = guard.replace("${{ vars.DEPLOY_PATH }}", str(checkout))
    for expression in ("vars.BACKUP_R2_ACCOUNT_ID", "vars.BACKUP_BUCKET", "secrets.BACKUP_ACCESS_KEY_ID",
                       "secrets.BACKUP_SECRET_ACCESS_KEY", "vars.BACKUP_AGE_RECIPIENT", "vars.BACKUP_RETENTION_DAYS"):
        guard = guard.replace("${{ " + expression + " }}", "")
    assert "${{" not in guard
    result = subprocess.run(["bash", "-euc", guard + '\nprintf "app-deploy-continues"\n'],
                            cwd=checkout, env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert "::warning::Off-site backup setup failed" in result.stdout
    assert "app-deploy-continues" in result.stdout
