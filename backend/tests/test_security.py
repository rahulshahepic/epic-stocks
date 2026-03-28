"""Security tests: session cookie tampering, IDOR, file upload abuse, admin access control."""
import io
import sys
import os
import time
import json
import base64
import hmac
import hashlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user


# ============================================================
# SESSION COOKIE TAMPERING
# ============================================================

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def test_jwt_wrong_signature_rejected(client):
    register_user(client)
    session = client.cookies.get("session")
    parts = session.split(".")
    bad_sig = ("A" if parts[2][0] != "A" else "B") + parts[2][1:]
    bad_cookie = ".".join([parts[0], parts[1], bad_sig])
    resp = client.get("/api/me", cookies={"session": bad_cookie})
    assert resp.status_code == 401


def test_jwt_modified_payload_rejected(client):
    register_user(client)
    session = client.cookies.get("session")
    # Decode payload, change user id, re-encode with same header/sig (invalid sig)
    parts = session.split(".")
    padding = 4 - len(parts[1]) % 4
    payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * padding))
    payload["sub"] = "9999"
    new_payload = _b64url_encode(json.dumps(payload).encode())
    bad_cookie = f"{parts[0]}.{new_payload}.{parts[2]}"
    resp = client.get("/api/me", cookies={"session": bad_cookie})
    assert resp.status_code == 401


def test_jwt_expired_token_rejected(client):
    register_user(client)
    session = client.cookies.get("session")
    parts = session.split(".")
    # Replace payload with one that has an expired exp
    expired_payload = _b64url_encode(json.dumps({"sub": "1", "exp": int(time.time()) - 3600}).encode())
    bad_cookie = f"{parts[0]}.{expired_payload}.{parts[2]}"
    resp = client.get("/api/me", cookies={"session": bad_cookie})
    assert resp.status_code == 401


def test_jwt_malformed_token_rejected(client):
    for bad in ["not.a.token", "Bearer xyz", "", "x.y"]:
        resp = client.get("/api/me", cookies={"session": bad})
        assert resp.status_code == 401, f"expected 401 for cookie: {bad!r}"


def test_jwt_wrong_secret_rejected(client):
    register_user(client)
    # Craft a well-formed JWT but signed with the wrong secret
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload_enc = _b64url_encode(json.dumps({"sub": "1", "exp": int(time.time()) + 3600}).encode())
    sig_input = f"{header}.{payload_enc}".encode()
    sig = _b64url_encode(hmac.new(b"wrong-secret", sig_input, hashlib.sha256).digest())
    bad_cookie = f"{header}.{payload_enc}.{sig}"
    resp = client.get("/api/me", cookies={"session": bad_cookie})
    assert resp.status_code == 401


# ============================================================
# IDOR — user A cannot access user B's data
# ============================================================

def _create_grant(client):
    resp = client.post("/api/grants", json={
        "year": 2020, "type": "Purchase", "shares": 100, "price": 5.0,
        "vest_start": "2020-01-01", "periods": 5, "exercise_date": "2025-01-01",
    })
    assert resp.status_code == 201
    return resp.json()["id"]


def _create_loan(client):
    resp = client.post("/api/loans", json={
        "grant_year": 2020, "grant_type": "Purchase", "loan_type": "Interest",
        "loan_year": 2020, "amount": 1000, "interest_rate": 0.05,
        "due_date": "2025-01-01",
    })
    assert resp.status_code == 201
    return resp.json()["id"]


def _create_price(client):
    resp = client.post("/api/prices", json={
        "effective_date": "2020-01-01", "price": 10.0,
    })
    assert resp.status_code == 201
    return resp.json()["id"]


def test_idor_grant_read(client, make_client):
    register_user(client, "a@example.com")
    grant_id = _create_grant(client)
    # User B tries to update user A's grant
    with make_client("b@example.com") as client_b:
        resp = client_b.put(f"/api/grants/{grant_id}", json={"shares": 999})
        assert resp.status_code == 404


def test_idor_grant_delete(client, make_client):
    register_user(client, "a@example.com")
    grant_id = _create_grant(client)
    with make_client("b@example.com") as client_b:
        resp = client_b.delete(f"/api/grants/{grant_id}")
        assert resp.status_code == 404
    # Grant still exists for A
    resp = client.get("/api/grants")
    assert any(g["id"] == grant_id for g in resp.json())


def test_idor_loan_update(client, make_client):
    register_user(client, "a@example.com")
    loan_id = _create_loan(client)
    with make_client("b@example.com") as client_b:
        resp = client_b.put(f"/api/loans/{loan_id}", json={"amount": 1})
        assert resp.status_code == 404


def test_idor_price_delete(client, make_client):
    register_user(client, "a@example.com")
    price_id = _create_price(client)
    with make_client("b@example.com") as client_b:
        resp = client_b.delete(f"/api/prices/{price_id}")
        assert resp.status_code == 404


def test_events_isolated_per_user(client, make_client):
    register_user(client, "a@example.com")
    _create_grant(client)
    _create_price(client)
    # User B sees no events (their data is empty)
    with make_client("b@example.com") as client_b:
        resp = client_b.get("/api/events")
        assert resp.status_code == 200
        assert resp.json() == []


# ============================================================
# FILE UPLOAD ABUSE
# ============================================================

def test_upload_rejects_oversized_file(client):
    register_user(client)
    # XLSX magic bytes but 6 MB of content
    big_content = b"PK\x03\x04" + b"x" * (6 * 1024 * 1024)
    resp = client.post(
        "/api/import/excel",
        files={"file": ("big.xlsx", io.BytesIO(big_content), "application/octet-stream")},
    )
    assert resp.status_code == 400
    assert "large" in resp.json()["detail"].lower()


def test_upload_rejects_non_xlsx_magic(client):
    register_user(client)
    # Valid size but wrong magic bytes (e.g. a PNG header)
    fake_content = b"\x89PNG\r\n\x1a\n" + b"x" * 100
    resp = client.post(
        "/api/import/excel",
        files={"file": ("evil.xlsx", io.BytesIO(fake_content), "application/octet-stream")},
    )
    assert resp.status_code == 400
    assert "valid" in resp.json()["detail"].lower()


def test_upload_rejects_wrong_extension(client):
    register_user(client)
    resp = client.post(
        "/api/import/excel",
        files={"file": ("file.csv", io.BytesIO(b"PK\x03\x04"), "text/csv")},
    )
    assert resp.status_code == 400


# ============================================================
# ADMIN ACCESS CONTROL
# ============================================================

def test_admin_stats_requires_admin(client):
    register_user(client)
    resp = client.get("/api/admin/stats")
    assert resp.status_code == 403


def test_admin_users_requires_admin(client):
    register_user(client)
    resp = client.get("/api/admin/users")
    assert resp.status_code == 403


def test_admin_delete_user_requires_admin(client):
    register_user(client)
    resp = client.delete("/api/admin/users/1")
    assert resp.status_code == 403


def test_admin_blocked_requires_admin(client):
    register_user(client)
    resp = client.get("/api/admin/blocked")
    assert resp.status_code == 403


def test_admin_errors_requires_admin(client):
    register_user(client)
    resp = client.get("/api/admin/errors")
    assert resp.status_code == 403


def test_admin_endpoints_unauthenticated(client):
    for path in ["/api/admin/stats", "/api/admin/users", "/api/admin/blocked", "/api/admin/errors"]:
        resp = client.get(path)
        assert resp.status_code == 401, f"expected 401 for {path}"
