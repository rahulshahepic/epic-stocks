"""Issue #821: cookie-authenticated writes must not be accepted from a
foreign Origin. SameSite=Lax mitigates this in browsers, but the server
never checked for itself — the Nov 27 pen test drove a grant POST with
the session cookie and `Origin: https://evil.example` through (201).
"""
from tests.conftest import register_user

_GRANT = {
    "year": 2024,
    "type": "Free",
    "shares": 100,
    "price": 0,
    "vest_start": "2025-01-01",
    "periods": 1,
    "exercise_date": "2024-01-01",
}


def test_foreign_origin_cookie_write_is_rejected(client):
    register_user(client)
    resp = client.post("/api/grants", json=_GRANT, headers={"Origin": "https://evil.example"})
    assert resp.status_code == 403
    # And nothing was written.
    assert client.get("/api/grants").json() == []


def test_foreign_referer_cookie_write_is_rejected(client):
    register_user(client)
    resp = client.post(
        "/api/grants", json=_GRANT, headers={"Referer": "https://evil.example/phish"}
    )
    assert resp.status_code == 403
    assert client.get("/api/grants").json() == []


def test_same_origin_cookie_write_is_allowed(client):
    register_user(client)
    # TestClient's own origin is http://testserver.
    resp = client.post("/api/grants", json=_GRANT, headers={"Origin": "http://testserver"})
    assert resp.status_code in (200, 201)
    assert len(client.get("/api/grants").json()) == 1


def test_no_origin_cookie_write_is_allowed(client):
    register_user(client)
    resp = client.post("/api/grants", json=_GRANT)
    assert resp.status_code in (200, 201)


def test_foreign_origin_without_cookie_is_not_the_middlewares_business(client):
    # Unauthenticated callers get the endpoint's own 401, not the origin
    # check's 403: the check exists to protect cookie auth specifically.
    resp = client.post("/api/grants", json=_GRANT, headers={"Origin": "https://evil.example"})
    assert resp.status_code == 401


def test_bearer_write_with_foreign_origin_is_unaffected(client):
    register_user(client)
    # Native shells and connectors authenticate with a Bearer token and
    # load from their own origins; capture the session token and replay
    # it as Bearer with no cookie.
    token = client.cookies.get("session")
    client.cookies.clear()
    resp = client.post(
        "/api/grants",
        json=_GRANT,
        headers={"Origin": "https://evil.example", "Authorization": f"Bearer {token}"},
    )
    assert resp.status_code in (200, 201)


def test_reads_are_not_checked(client):
    register_user(client)
    resp = client.get("/api/grants", headers={"Origin": "https://evil.example"})
    assert resp.status_code == 200


def test_opaque_origin_is_not_rejected(client):
    # `Origin: null` is an opaque origin (e.g. a page served with
    # Referrer-Policy: no-referrer): unvalidatable, not foreign. The
    # reviewer sign-in page was the live case — its policy is now
    # same-origin, and the middleware must not 403 what it cannot
    # attribute either way.
    register_user(client)
    resp = client.post("/api/grants", json=_GRANT, headers={"Origin": "null"})
    assert resp.status_code in (200, 201)


def test_reviewer_login_post_is_not_origin_rejected(client):
    # With a session cookie already held, the reviewer sign-in POST must
    # reach the route (which runs its own CSRF check), not die in the
    # middleware — under either the real origin or an opaque one.
    register_user(client)
    page = client.get("/reviewer-login")
    assert page.headers["Referrer-Policy"] == "same-origin"
    csrf = page.text.split('name="csrf" value="')[1].split('"')[0]
    for origin in ("http://testserver", "null"):
        resp = client.post(
            "/reviewer-login",
            data={"login": "nobody", "password": "wrong", "csrf": csrf},
            headers={"Origin": origin},
            follow_redirects=False,
        )
        assert "Cross-origin request rejected" not in resp.text
