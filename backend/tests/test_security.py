"""Security tests: JWT tampering, IDOR, file upload abuse, admin access control."""
import io
import sys
import os
import time
import json
import base64
import hmac
import hashlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user, auth_header


# ============================================================
# JWT TAMPERING
# ============================================================

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _make_token(payload: dict, secret: str = "dev-secret-change-me") -> str:
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload_enc = _b64url_encode(json.dumps(payload).encode())
    sig_input = f"{header}.{payload_enc}".encode()
    sig = _b64url_encode(hmac.new(secret.encode(), sig_input, hashlib.sha256).digest())
    return f"{header}.{payload_enc}.{sig}"


def test_jwt_wrong_signature_rejected(client):
    token = register_user(client)
    # Tamper: replace first char of signature (guaranteed to flip real bits,
    # unlike the last char which may only carry padding zeros in base64url)
    parts = token.split(".")
    bad_sig = ("A" if parts[2][0] != "A" else "B") + parts[2][1:]
    bad_token = ".".join([parts[0], parts[1], bad_sig])
    resp = client.get("/api/me", headers=auth_header(bad_token))
    assert resp.status_code == 401


def test_jwt_modified_payload_rejected(client):
    token = register_user(client)
    # Decode payload, change user id, re-encode with same header/sig (invalid sig)
    parts = token.split(".")
    padding = 4 - len(parts[1]) % 4
    payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * padding))
    payload["sub"] = "9999"
    new_payload = _b64url_encode(json.dumps(payload).encode())
    bad_token = f"{parts[0]}.{new_payload}.{parts[2]}"
    resp = client.get("/api/me", headers=auth_header(bad_token))
    assert resp.status_code == 401


def test_jwt_expired_token_rejected(client):
    register_user(client)
    expired_token = _make_token({"sub": "1", "exp": int(time.time()) - 3600})
    resp = client.get("/api/me", headers=auth_header(expired_token))
    assert resp.status_code == 401


def test_jwt_malformed_token_rejected(client):
    for bad in ["not.a.token", "Bearer xyz", "", "x.y"]:
        resp = client.get("/api/me", headers=auth_header(bad))
        assert resp.status_code == 401, f"expected 401 for token: {bad!r}"


def test_jwt_wrong_secret_rejected(client):
    token = _make_token({"sub": "1", "exp": int(time.time()) + 3600}, secret="wrong-secret")
    resp = client.get("/api/me", headers=auth_header(token))
    assert resp.status_code == 401


# ============================================================
# IDOR — user A cannot access user B's data
# ============================================================

def _create_grant(client, token):
    resp = client.post("/api/grants", json={
        "year": 2020, "type": "Purchase", "shares": 100, "price": 5.0,
        "vest_start": "2020-01-01", "periods": 5, "exercise_date": "2025-01-01",
    }, headers=auth_header(token))
    assert resp.status_code == 201
    return resp.json()["id"]


def _create_loan(client, token):
    resp = client.post("/api/loans", json={
        "grant_year": 2020, "grant_type": "Purchase", "loan_type": "Interest",
        "loan_year": 2020, "amount": 1000, "interest_rate": 0.05,
        "due_date": "2025-01-01",
    }, headers=auth_header(token))
    assert resp.status_code == 201
    return resp.json()["id"]


def _create_price(client, token):
    resp = client.post("/api/prices", json={
        "effective_date": "2020-01-01", "price": 10.0,
    }, headers=auth_header(token))
    assert resp.status_code == 201
    return resp.json()["id"]


def test_idor_grant_read(client):
    token_a = register_user(client, "a@example.com")
    token_b = register_user(client, "b@example.com")
    grant_id = _create_grant(client, token_a)
    # User B tries to update user A's grant
    resp = client.put(f"/api/grants/{grant_id}", json={"shares": 999}, headers=auth_header(token_b))
    assert resp.status_code == 404


def test_idor_grant_delete(client):
    token_a = register_user(client, "a@example.com")
    token_b = register_user(client, "b@example.com")
    grant_id = _create_grant(client, token_a)
    resp = client.delete(f"/api/grants/{grant_id}", headers=auth_header(token_b))
    assert resp.status_code == 404
    # Grant still exists for A
    resp = client.get("/api/grants", headers=auth_header(token_a))
    assert any(g["id"] == grant_id for g in resp.json())


def test_idor_loan_update(client):
    token_a = register_user(client, "a@example.com")
    token_b = register_user(client, "b@example.com")
    loan_id = _create_loan(client, token_a)
    resp = client.put(f"/api/loans/{loan_id}", json={"amount": 1}, headers=auth_header(token_b))
    assert resp.status_code == 404


def test_idor_price_delete(client):
    token_a = register_user(client, "a@example.com")
    token_b = register_user(client, "b@example.com")
    price_id = _create_price(client, token_a)
    resp = client.delete(f"/api/prices/{price_id}", headers=auth_header(token_b))
    assert resp.status_code == 404


def test_events_isolated_per_user(client):
    token_a = register_user(client, "a@example.com")
    token_b = register_user(client, "b@example.com")
    _create_grant(client, token_a)
    _create_price(client, token_a)
    # User B sees no events (their data is empty)
    resp = client.get("/api/events", headers=auth_header(token_b))
    assert resp.status_code == 200
    assert resp.json() == []


# ============================================================
# FILE UPLOAD ABUSE
# ============================================================

def test_upload_rejects_oversized_file(client):
    token = register_user(client)
    # XLSX magic bytes but 6 MB of content
    big_content = b"PK\x03\x04" + b"x" * (6 * 1024 * 1024)
    resp = client.post(
        "/api/import/excel",
        files={"file": ("big.xlsx", io.BytesIO(big_content), "application/octet-stream")},
        headers=auth_header(token),
    )
    assert resp.status_code == 400
    assert "large" in resp.json()["detail"].lower()


def test_upload_rejects_non_xlsx_magic(client):
    token = register_user(client)
    # Valid size but wrong magic bytes (e.g. a PNG header)
    fake_content = b"\x89PNG\r\n\x1a\n" + b"x" * 100
    resp = client.post(
        "/api/import/excel",
        files={"file": ("evil.xlsx", io.BytesIO(fake_content), "application/octet-stream")},
        headers=auth_header(token),
    )
    assert resp.status_code == 400
    assert "valid" in resp.json()["detail"].lower()


def test_upload_rejects_wrong_extension(client):
    token = register_user(client)
    resp = client.post(
        "/api/import/excel",
        files={"file": ("file.csv", io.BytesIO(b"PK\x03\x04"), "text/csv")},
        headers=auth_header(token),
    )
    assert resp.status_code == 400


# ============================================================
# ADMIN ACCESS CONTROL
# ============================================================

def test_admin_stats_requires_admin(client):
    token = register_user(client)
    resp = client.get("/api/admin/stats", headers=auth_header(token))
    assert resp.status_code == 403


def test_admin_users_requires_admin(client):
    token = register_user(client)
    resp = client.get("/api/admin/users", headers=auth_header(token))
    assert resp.status_code == 403


def test_admin_delete_user_requires_admin(client):
    token = register_user(client)
    resp = client.delete("/api/admin/users/1", headers=auth_header(token))
    assert resp.status_code == 403


def test_admin_blocked_requires_admin(client):
    token = register_user(client)
    resp = client.get("/api/admin/blocked", headers=auth_header(token))
    assert resp.status_code == 403


def test_admin_errors_requires_admin(client):
    token = register_user(client)
    resp = client.get("/api/admin/errors", headers=auth_header(token))
    assert resp.status_code == 403


def test_admin_endpoints_unauthenticated(client):
    for path in ["/api/admin/stats", "/api/admin/users", "/api/admin/blocked", "/api/admin/errors"]:
        resp = client.get(path)
        assert resp.status_code == 401, f"expected 401 for {path}"
