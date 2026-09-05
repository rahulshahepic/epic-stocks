"""A request body over the ceiling must die above the application.

Reproduced against staging: a multipart POST is fully spooled by the parser
before any dependency runs, so an anonymous caller got a 401 *after* six
megabytes had been written to disk — and file parts an endpoint does not even
declare were spooled just the same, because the parser reads the whole body
before FastAPI decides which fields it wanted. Chunked requests declare no
length at all, so a Content-Length check alone is not a fix.
"""
import io
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scaffold.body_limit import BodyLimitMiddleware
from tests.conftest import register_user

_MB = 1024 * 1024


def _multipart(fields: dict[str, bytes]) -> tuple[bytes, str]:
    """A multipart body built by hand, so the test controls the exact size."""
    boundary = "----epicstockstest"
    parts = []
    for name, content in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; '
            f'filename="{name}.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'
            .encode() + content + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


# ── The limit table ─────────────────────────────────────────────────────────

def test_the_limit_is_the_longest_matching_prefix():
    mw = BodyLimitMiddleware(None, limits=(("/api/", 10), ("/api/upload", 999)), default=1)
    assert mw.limit_for("/api/upload/thing") == 999
    assert mw.limit_for("/api/grants") == 10
    assert mw.limit_for("/anything-else") == 1


# ── Through the app ─────────────────────────────────────────────────────────

def test_an_oversized_body_is_refused_before_authentication(client):
    """No session at all: the 413 must arrive instead of the 401, not after it.

    A 401 here would mean the body was read and parsed first, which is exactly
    the flood the ceiling exists to stop.
    """
    body, content_type = _multipart({"share_csv": b"x" * (17 * _MB)})
    resp = client.post(
        "/api/epic-import/analyze",
        content=body,
        headers={"Content-Type": content_type},
    )
    assert resp.status_code == 413
    assert "too large" in resp.json()["detail"].lower()


def test_an_undeclared_file_field_cannot_exceed_the_ceiling(client):
    """The parser spools parts the endpoint never declared; the ceiling covers them."""
    body, content_type = _multipart({
        "share_csv": b"a,b\n1,2\n",
        "ignored_by_the_endpoint": b"x" * (12 * _MB),
    })
    resp = client.post(
        "/api/trial/analyze",
        content=body,
        headers={"Content-Type": content_type},
    )
    assert resp.status_code == 413


def test_a_json_endpoint_has_a_much_tighter_ceiling(client):
    register_user(client)
    resp = client.post(
        "/api/loans/bulk",
        content=b'{"padding":"' + b"x" * (2 * _MB) + b'"}',
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 413


def test_a_chunked_body_is_counted_as_it_arrives(client):
    """No Content-Length to check, so the bytes themselves have to be counted.

    httpx sends a generator body with Transfer-Encoding: chunked. The stream is
    abandoned the moment it passes the ceiling, so at most one ceiling's worth
    is ever held.
    """
    def _chunks():
        for _ in range(20):
            yield b"x" * _MB

    resp = client.post(
        "/api/epic-import/analyze",
        content=_chunks(),
        headers={"Content-Type": "application/octet-stream"},
    )
    assert resp.status_code == 413


def test_a_chunked_body_under_the_ceiling_still_reaches_the_endpoint(client):
    """The counting must not break the ordinary case."""
    register_user(client)

    def _chunks():
        yield b'{"effective_date": "2020-01-01", '
        yield b'"price": 10.0}'

    resp = client.post(
        "/api/prices",
        content=_chunks(),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 201
    assert resp.json()["price"] == 10.0


def test_a_lying_content_length_is_refused(client):
    """A Content-Length that is not a number is not a request worth parsing."""
    resp = client.post(
        "/api/prices",
        content=b"{}",
        headers={"Content-Type": "application/json", "Content-Length": "not-a-number"},
    )
    assert resp.status_code == 413


def test_an_ordinary_upload_is_unaffected(client):
    """The ceiling sits above what every endpoint legitimately accepts."""
    register_user(client)
    resp = client.post(
        "/api/import/excel",
        files={"file": ("small.xlsx", io.BytesIO(b"PK\x03\x04" + b"x" * 100),
                        "application/octet-stream")},
    )
    # Not a real workbook, so the handler rejects it — but it reached the handler.
    assert resp.status_code == 400
    assert "large" not in resp.json()["detail"].lower()


def test_a_get_is_never_intercepted(client):
    register_user(client)
    assert client.get("/api/health").status_code == 200
