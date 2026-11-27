"""Issue #818: /openapi.json, /docs and /redoc must not be public on a
deployed environment. They publish the full API surface — including the
admin API's shape — to anyone who asks. Local development keeps them.
"""
import os
import subprocess
import sys

import pytest

import main as main_module


@pytest.mark.parametrize(
    "env, expected",
    [
        ({}, True),  # local development: neither variable set
        ({"APP_ENV": "development"}, True),
        ({"APP_ENV": "staging"}, False),
        ({"APP_ENV": "production"}, False),
        ({"DOMAIN": "staging.epic-stocks.com"}, False),
        ({"DOMAIN": "epic-stocks.com"}, False),
        ({"DOMAIN": "epic-stocks.com", "APP_ENV": "development"}, False),
    ],
)
def test_api_docs_enabled_only_in_local_development(monkeypatch, env, expected):
    monkeypatch.delenv("DOMAIN", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    assert main_module._api_docs_enabled() is expected


def test_docs_served_in_the_test_apps_own_configuration(client):
    # The suite runs undeployed (no DOMAIN / APP_ENV), so the docs stay
    # available here — this pins the development half of the gate.
    assert client.get("/openapi.json").status_code == 200
    assert client.get("/docs").status_code == 200


_PROBE = """
from starlette.testclient import TestClient
from main import _fastapi_app
c = TestClient(_fastapi_app, raise_server_exceptions=False)
for path in ("/openapi.json", "/docs", "/redoc"):
    print(path, c.get(path).status_code)
print("health", c.get("/api/health").status_code)
"""


@pytest.mark.parametrize(
    "env",
    [
        {"DOMAIN": "staging.epic-stocks.com", "APP_ENV": "staging"},
        {"DOMAIN": "epic-stocks.com", "APP_ENV": "production"},
    ],
)
def test_docs_not_served_when_deployed(env):
    # Import the app fresh in a subprocess configured the way a deploy is:
    # DOMAIN and APP_ENV set, and E2E_TEST absent (the app refuses to boot
    # with E2E_TEST alongside a deployment, by design).
    child_env = {k: v for k, v in os.environ.items() if k != "E2E_TEST"}
    # Without E2E_TEST the app requires a real-shaped JWT secret; this one
    # is a throwaway for the probe process only.
    child_env.setdefault("JWT_SECRET", "test-only-probe-secret-" + "0" * 32)
    child_env.update(env)
    backend_dir = os.path.join(os.path.dirname(__file__), "..")
    result = subprocess.run(
        [sys.executable, "-c", _PROBE],
        cwd=backend_dir,
        env=child_env,
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    lines = dict(line.rsplit(" ", 1) for line in result.stdout.strip().splitlines())
    for path in ("/openapi.json", "/docs", "/redoc"):
        assert lines[path] == "404", f"{path} returned {lines[path]} under {env}"
    assert lines["health"] == "200"
