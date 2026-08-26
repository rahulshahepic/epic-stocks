"""Authorization-URL construction for the OIDC login flow."""

import json
from urllib.parse import parse_qs, urlparse

import pytest

from scaffold.providers.auth import get_provider
from scaffold.providers.auth.oidc import (
    OIDCProvider,
    OIDCProviderConfig,
    _oidc_config_cache,
    get_providers,
)

DISCOVERY = "https://idp.test/.well-known/openid-configuration"
AUTH_ENDPOINT = "https://idp.test/authorize"


@pytest.fixture(autouse=True)
def _stub_discovery():
    """Seed the discovery cache so no network call is made."""
    _oidc_config_cache[DISCOVERY] = {
        "authorization_endpoint": AUTH_ENDPOINT,
        "token_endpoint": "https://idp.test/token",
        "issuer": "https://idp.test",
        "jwks_uri": "https://idp.test/jwks",
    }
    yield
    _oidc_config_cache.pop(DISCOVERY, None)


def build_url(**overrides) -> dict[str, list[str]]:
    config = OIDCProviderConfig(
        name="google", client_id="client-123", discovery_url=DISCOVERY, **overrides
    )
    url = OIDCProvider(config).get_authorization_url(
        state="st", code_challenge="ch", redirect_uri="https://app.test/auth/callback"
    )
    assert url.startswith(AUTH_ENDPOINT + "?")
    return parse_qs(urlparse(url).query)


def test_defaults_to_select_account():
    """Without prompt=select_account the IdP silently reuses the browser's
    existing session, so signing out and back in never offers the chooser."""
    assert build_url()["prompt"] == ["select_account"]


def test_prompt_is_configurable():
    assert build_url(prompt="login")["prompt"] == ["login"]


def test_empty_prompt_omits_the_parameter():
    assert "prompt" not in build_url(prompt="")


def test_other_params_unchanged():
    params = build_url()
    assert params["client_id"] == ["client-123"]
    assert params["response_type"] == ["code"]
    assert params["code_challenge_method"] == ["S256"]
    assert params["redirect_uri"] == ["https://app.test/auth/callback"]
    assert params["state"] == ["st"]
    assert params["scope"] == ["openid email profile"]


def test_prompt_parsed_from_env(monkeypatch):
    monkeypatch.setenv(
        "OIDC_PROVIDERS",
        json.dumps(
            [
                {"name": "google", "client_id": "a", "discovery_url": DISCOVERY},
                {
                    "name": "azure",
                    "client_id": "b",
                    "discovery_url": DISCOVERY,
                    "prompt": "",
                },
            ]
        ),
    )
    by_name = {p.config.name: p for p in get_providers()}
    assert by_name["google"].config.prompt == "select_account"
    assert by_name["azure"].config.prompt == ""
    assert "prompt=select_account" in get_provider("google").get_authorization_url(
        "st", "ch", "https://app.test/auth/callback"
    )


def test_login_endpoint_returns_url_with_prompt(client, monkeypatch):
    monkeypatch.setenv(
        "OIDC_PROVIDERS",
        json.dumps([{"name": "google", "client_id": "a", "discovery_url": DISCOVERY}]),
    )
    resp = client.get(
        "/api/auth/login",
        params={
            "provider": "google",
            "code_challenge": "ch",
            "redirect_uri": "https://app.test/auth/callback",
            "state": "st",
        },
    )
    assert resp.status_code == 200
    assert "prompt=select_account" in resp.json()["authorization_url"]
