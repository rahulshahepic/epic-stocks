"""Nightly encrypted off-site backup. Runs on the VPS host from systemd, never in the app.

Each run uploads one prefix to S3-compatible storage (Cloudflare R2 by default):
  <env>/<stamp>/database.dump.age  pg_dump -Fc, streamed straight into age
  <env>/<stamp>/secrets.tar.age    the deploy's .secrets/ except the KEK
  <env>/<stamp>/manifest.json      written last; a run without it is incomplete
Plaintext never touches disk. The KEK stays only in GitHub, so the age key alone
cannot read encrypted columns. Stdlib only, like collect_diagnostics.py.
"""
import argparse
import hashlib
import hmac
import http.client
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit

STATUS_FILE = Path("/var/lib/epic-stocks-backup/status.json")
STAMP_FORMAT = "%Y%m%dT%H%M%SZ"
STAMP_RE = re.compile(r"^\d{8}T\d{6}Z$")
MIN_KEEP = 7
EXCLUDED_SECRETS = {"key_encryption_key"}
CHUNK = 1 << 20
TIMEOUT = 120


class BackupError(Exception):
    pass


# ── S3 Signature V4, path-style ─────────────────────────────────────────────

def _sign(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def sign_headers(method, url, *, access_key, secret_key, payload_hash, now, region="auto", query=None, extra=None):
    parts = urlsplit(url)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    day = amz_date[:8]
    headers = {"host": parts.netloc, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date,
               **{k.lower(): v for k, v in (extra or {}).items()}}
    canonical_query = "&".join(f"{quote(k, safe='-_.~')}={quote(v, safe='-_.~')}"
                               for k, v in sorted((query or {}).items()))
    signed = ";".join(sorted(headers))
    canonical = "\n".join([method, quote(parts.path or "/", safe="/-_.~"), canonical_query,
                           "".join(f"{k}:{headers[k].strip()}\n" for k in sorted(headers)), signed, payload_hash])
    scope = f"{day}/{region}/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    key = _sign(_sign(_sign(_sign(("AWS4" + secret_key).encode(), day), region), "s3"), "aws4_request")
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    headers["authorization"] = (f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, "
                                f"SignedHeaders={signed}, Signature={signature}")
    return headers


class Store:
    def __init__(self, endpoint, bucket, access_key, secret_key, region="auto"):
        parts = urlsplit(endpoint)
        if parts.scheme not in ("https", "http") or not parts.netloc:
            raise BackupError("Invalid storage endpoint")
        self.scheme, self.netloc, self.bucket = parts.scheme, parts.netloc, bucket
        self.access_key, self.secret_key, self.region = access_key, secret_key, region

    def _request(self, method, key="", *, query=None, body=b"", payload_hash=None, length=None, extra=None):
        path = f"/{self.bucket}/{key}" if key else f"/{self.bucket}"
        url = f"{self.scheme}://{self.netloc}{quote(path, safe='/-_.~')}"
        payload_hash = payload_hash or hashlib.sha256(body if isinstance(body, bytes) else b"").hexdigest()
        headers = sign_headers(method, url, access_key=self.access_key, secret_key=self.secret_key,
                               payload_hash=payload_hash, now=datetime.now(timezone.utc),
                               region=self.region, query=query, extra=extra)
        if length is not None or method == "PUT":
            headers["content-length"] = str(length if length is not None else len(body))
        target = quote(path, safe="/-_.~")
        if query:
            target += "?" + "&".join(f"{quote(k, safe='-_.~')}={quote(v, safe='-_.~')}" for k, v in sorted(query.items()))
        cls = http.client.HTTPSConnection if self.scheme == "https" else http.client.HTTPConnection
        conn = cls(self.netloc, timeout=TIMEOUT)
        try:
            conn.request(method, target, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read() if method != "GET" or resp.status >= 300 else resp
            if resp.status >= 300:
                code = re.search(rb"<Code>([A-Za-z]{1,64})</Code>", data or b"")
                raise BackupError(f"{method} failed: HTTP {resp.status}" + (f" {code.group(1).decode()}" if code else ""))
            return resp, data, conn
        except (OSError, http.client.HTTPException) as exc:
            conn.close()
            raise BackupError(f"{method} failed: {type(exc).__name__}") from None

    def put_file(self, key, path, sha256):
        size = path.stat().st_size
        with path.open("rb") as stream:
            _, _, conn = self._request("PUT", key, body=stream, payload_hash=sha256, length=size)
        conn.close()
        self.verify(key, size)

    def put_bytes(self, key, data):
        _, _, conn = self._request("PUT", key, body=data)
        conn.close()
        self.verify(key, len(data))

    def verify(self, key, size):
        resp, _, conn = self._request("HEAD", key)
        conn.close()
        if resp.getheader("content-length") != str(size):
            raise BackupError("Uploaded object size mismatch")

    def list(self, prefix):
        keys, token = [], None
        while True:
            query = {"list-type": "2", "prefix": prefix}
            if token:
                query["continuation-token"] = token
            _, data, conn = self._request("GET", query=query)
            body = data.read()
            conn.close()
            root = ET.fromstring(body)
            ns = root.tag[: root.tag.index("}") + 1] if root.tag.startswith("{") else ""
            keys += [el.text for el in root.iter(f"{ns}Key")]
            if root.findtext(f"{ns}IsTruncated") != "true":
                return keys
            token = root.findtext(f"{ns}NextContinuationToken")

    def delete(self, key):
        _, _, conn = self._request("DELETE", key)
        conn.close()

    def download(self, key, dest):
        _, resp, conn = self._request("GET", key)
        try:
            with dest.open("wb") as out:
                while chunk := resp.read(CHUNK):
                    out.write(chunk)
        finally:
            conn.close()


# ── Backup run ──────────────────────────────────────────────────────────────

def config(env=os.environ):
    required = ("BACKUP_BUCKET", "BACKUP_ACCESS_KEY_ID", "BACKUP_SECRET_ACCESS_KEY", "BACKUP_AGE_RECIPIENT")
    missing = [name for name in required if not env.get(name)]
    endpoint = env.get("BACKUP_S3_ENDPOINT") or (
        f"https://{env['BACKUP_R2_ACCOUNT_ID']}.r2.cloudflarestorage.com" if env.get("BACKUP_R2_ACCOUNT_ID") else "")
    if not endpoint:
        missing.append("BACKUP_R2_ACCOUNT_ID")
    if missing:
        return None
    if not re.fullmatch(r"age1[0-9a-z]{58}", env["BACKUP_AGE_RECIPIENT"]):
        raise BackupError("BACKUP_AGE_RECIPIENT is not an age public key")
    days = int(env.get("BACKUP_RETENTION_DAYS") or 30)
    if not 1 <= days <= 3650:
        raise BackupError("BACKUP_RETENTION_DAYS out of range")
    return {"endpoint": endpoint, "bucket": env["BACKUP_BUCKET"], "access_key": env["BACKUP_ACCESS_KEY_ID"],
            "secret_key": env["BACKUP_SECRET_ACCESS_KEY"], "recipient": env["BACKUP_AGE_RECIPIENT"],
            "retention_days": days}


def dump_command(deploy_path):
    return ["docker", "compose", "--project-directory", str(deploy_path), "exec", "-T", "db",
            "pg_dump", "-U", "postgres", "-Fc", "vesting"]


def encrypted_dump(cmd, recipient, dest):
    """pg_dump stdout -> age stdin -> dest. Returns plaintext size; checks the PGDMP header."""
    with dest.open("wb") as out:
        age = subprocess.Popen(["age", "-r", recipient], stdin=subprocess.PIPE, stdout=out, stderr=subprocess.DEVNULL)
        dump = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        size, head = 0, b""
        try:
            while chunk := dump.stdout.read(CHUNK):
                if len(head) < 5:
                    head += chunk[:5]
                size += len(chunk)
                age.stdin.write(chunk)
        finally:
            age.stdin.close()
            dump_rc, age_rc = dump.wait(), age.wait()
    if dump_rc:
        raise BackupError(f"pg_dump exited {dump_rc}")
    if age_rc:
        raise BackupError(f"age exited {age_rc}")
    if not head.startswith(b"PGDMP"):
        raise BackupError("pg_dump output is not a custom-format archive")
    return size


def encrypted_secrets(secrets_dir, recipient):
    buf = io.BytesIO()
    names = []
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for path in sorted(secrets_dir.iterdir()) if secrets_dir.is_dir() else []:
            if path.is_file() and not path.is_symlink() and path.name not in EXCLUDED_SECRETS:
                tar.add(path, arcname=path.name)
                names.append(path.name)
    result = subprocess.run(["age", "-r", recipient], input=buf.getvalue(), capture_output=True, timeout=60)
    if result.returncode:
        raise BackupError(f"age exited {result.returncode}")
    return result.stdout, names


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def prune(store, environment, now, retention_days):
    """Delete complete runs past retention (always keeping the newest MIN_KEEP) and stale partial runs."""
    runs = {}
    for key in store.list(f"{environment}/"):
        parts = key.split("/")
        if len(parts) == 3 and STAMP_RE.match(parts[1]):
            runs.setdefault(parts[1], []).append(key)
    complete = sorted((s for s, keys in runs.items() if f"{environment}/{s}/manifest.json" in keys), reverse=True)
    deleted = 0
    for stamp, keys in runs.items():
        age = now - datetime.strptime(stamp, STAMP_FORMAT).replace(tzinfo=timezone.utc)
        if stamp in complete:
            expired = complete.index(stamp) >= MIN_KEEP and age > timedelta(days=retention_days)
        else:
            expired = age > timedelta(days=2)
        if expired:
            # Manifest first, so an interrupted prune leaves a partial run, never a "complete" one missing data.
            for key in sorted(keys, key=lambda k: not k.endswith("manifest.json")):
                store.delete(key)
            deleted += 1
    return deleted


def write_status(path, **fields):
    path.parent.mkdir(parents=True, exist_ok=True)
    previous = {}
    try:
        previous = json.loads(path.read_text())
        if not isinstance(previous, dict):
            previous = {}
    except (OSError, ValueError):
        pass
    status = {k: previous.get(k) for k in ("last_success_utc",)}
    status.update(fields)
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    with os.fdopen(fd, "w") as stream:
        json.dump(status, stream)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def run(environment, deploy_path, status_path=STATUS_FILE, env=os.environ, now=None, cmd=None):
    now = now or datetime.now(timezone.utc)
    attempt = now.isoformat()
    try:
        cfg = config(env)
    except (BackupError, ValueError) as exc:
        write_status(status_path, environment=environment, configured=True, last_attempt_utc=attempt,
                     last_result="failed", error=str(exc)[:120])
        raise
    if cfg is None:
        write_status(status_path, environment=environment, configured=False, last_attempt_utc=attempt,
                     last_result="unconfigured", error=None)
        print("Backup storage is not configured; nothing uploaded.", file=sys.stderr)
        return 0
    store = Store(cfg["endpoint"], cfg["bucket"], cfg["access_key"], cfg["secret_key"])
    stamp = now.strftime(STAMP_FORMAT)
    prefix = f"{environment}/{stamp}"
    try:
        with tempfile.TemporaryDirectory(prefix="epic-stocks-backup-") as tmp:
            os.chmod(tmp, 0o700)
            dump_path = Path(tmp) / "database.dump.age"
            plain_size = encrypted_dump(cmd or dump_command(deploy_path), cfg["recipient"], dump_path)
            dump_hash = sha256_file(dump_path)
            secrets_blob, secret_names = encrypted_secrets(Path(deploy_path) / ".secrets", cfg["recipient"])
            store.put_file(f"{prefix}/database.dump.age", dump_path, dump_hash)
            store.put_bytes(f"{prefix}/secrets.tar.age", secrets_blob)
            manifest = {"environment": environment, "created_at_utc": attempt, "format": 1,
                        "commit": _commit(deploy_path), "database_plaintext_bytes": plain_size,
                        "database_encrypted_sha256": dump_hash,
                        "secrets_encrypted_sha256": hashlib.sha256(secrets_blob).hexdigest(),
                        "secret_files": secret_names, "kek_included": False}
            store.put_bytes(f"{prefix}/manifest.json", json.dumps(manifest, indent=2).encode())
        deleted = prune(store, environment, now, cfg["retention_days"])
    except (BackupError, OSError, ValueError, ET.ParseError) as exc:
        write_status(status_path, environment=environment, configured=True, last_attempt_utc=attempt,
                     last_result="failed", error=str(exc)[:120] if isinstance(exc, BackupError) else type(exc).__name__)
        raise
    write_status(status_path, environment=environment, configured=True, last_attempt_utc=attempt,
                 last_result="success", last_success_utc=attempt, last_run=stamp, error=None,
                 database_plaintext_bytes=plain_size, pruned_runs=deleted)
    print(f"Uploaded {prefix} ({plain_size} database bytes); pruned {deleted} old run(s).")
    return 0


def _commit(deploy_path):
    try:
        for line in (Path(deploy_path) / ".env").read_text().splitlines():
            if line.startswith("COMMIT_SHA="):
                value = line.split("=", 1)[1].strip()
                return value if re.fullmatch(r"[a-f0-9]{7,40}", value) else None
    except OSError:
        pass
    return None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p_run = sub.add_parser("run", help="Dump, encrypt, upload and prune")
    p_run.add_argument("--environment", choices=("staging", "production"), required=True)
    p_run.add_argument("--deploy-path", type=Path, required=True)
    p_run.add_argument("--status-file", type=Path, default=STATUS_FILE)
    p_list = sub.add_parser("list", help="List complete runs (for restores; needs the BACKUP_* storage variables)")
    p_list.add_argument("--environment", choices=("staging", "production"), required=True)
    p_fetch = sub.add_parser("fetch", help="Download one run's encrypted files")
    p_fetch.add_argument("--environment", choices=("staging", "production"), required=True)
    p_fetch.add_argument("--run", default="latest")
    p_fetch.add_argument("--dest", type=Path, default=Path("."))
    args = parser.parse_args(argv)
    try:
        if args.command == "run":
            return run(args.environment, args.deploy_path, args.status_file)
        env = dict(os.environ)
        env.setdefault("BACKUP_AGE_RECIPIENT", "age1" + "q" * 58)  # listing and fetching never encrypt
        cfg = config(env)
        if cfg is None:
            raise BackupError("Set BACKUP_R2_ACCOUNT_ID, BACKUP_BUCKET, BACKUP_ACCESS_KEY_ID and BACKUP_SECRET_ACCESS_KEY")
        store = Store(cfg["endpoint"], cfg["bucket"], cfg["access_key"], cfg["secret_key"])
        keys = store.list(f"{args.environment}/")
        complete = sorted({k.split("/")[1] for k in keys if k.endswith("/manifest.json")}, reverse=True)
        if args.command == "list":
            print("\n".join(complete) or "No complete backups.")
            return 0
        stamp = complete[0] if args.run == "latest" and complete else args.run
        if stamp not in complete:
            raise BackupError("No such complete backup run")
        args.dest.mkdir(parents=True, exist_ok=True)
        for name in ("manifest.json", "database.dump.age", "secrets.tar.age"):
            store.download(f"{args.environment}/{stamp}/{name}", args.dest / name)
        manifest = json.loads((args.dest / "manifest.json").read_text())
        for name, field in (("database.dump.age", "database_encrypted_sha256"),
                            ("secrets.tar.age", "secrets_encrypted_sha256")):
            if sha256_file(args.dest / name) != manifest[field]:
                raise BackupError(f"Downloaded {name} does not match its manifest")
        print(f"Fetched {args.environment}/{stamp} into {args.dest}")
        return 0
    except BackupError as exc:
        print(f"Backup error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
