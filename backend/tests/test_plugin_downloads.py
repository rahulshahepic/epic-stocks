import io
import json
import os
import zipfile
from unittest.mock import patch

import pytest

from tests.conftest import register_user


def files(response):
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["cache-control"] == "private, no-store"
    with zipfile.ZipFile(io.BytesIO(response.content)) as bundle:
        return {path: json.loads(bundle.read(path)) for path in bundle.namelist() if path.endswith(".json")}


@pytest.mark.parametrize("platform", ["chatgpt", "claude"])
def test_account_package_is_production_only_and_requires_sign_in(client, platform):
    path = f"/api/ai/plugin/{platform}"
    assert client.get(path).status_code == 401
    register_user(client)
    response = client.get(path)
    assert f'filename="epic-stocks-{platform}.zip"' in response.headers["content-disposition"]
    contents = files(response)
    config = contents["mcp.json" if platform == "chatgpt" else ".mcp.json"]
    server = config["mcpServers"]["epic-stocks"]
    assert server["url"] == "https://epic-stocks.com/mcp"
    assert "clientSecret" not in str(contents)
    if platform == "chatgpt":
        assert contents["plugin.json"]["name"] == "epic-stocks"
        assert server["type"] == "streamable-http"
        assert server["extensions"]["com.openai"]["auth"]["client"]["mode"] == "dcr"
    else:
        assert contents[".claude-plugin/plugin.json"]["name"] == "epic-stocks"
        assert server["type"] == "http"


@pytest.mark.parametrize("domain,site", [
    ("staging.epic-stocks.com", "staging"),
    ("epic-stocks.com", "production"),
    ("my-stocks.example.org", "my-stocks.example.org"),
])
def test_admin_package_is_for_this_site_and_admin_only(client, domain, site):
    path = "/api/admin/ai/plugin"
    assert client.get(path).status_code == 401
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com"}):
        register_user(client, "regular@example.com")
        assert client.get(path).status_code == 403
        client.post("/api/auth/test-login", json={"email": "admin@example.com"})
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com", "DOMAIN": domain}):
        response = client.get(path, headers={"Host": "untrusted.example.net"})
        assert f'filename="epic-stocks-{site.replace(".", "-")}-admin.zip"' in response.headers["content-disposition"]
        with zipfile.ZipFile(io.BytesIO(response.content)) as bundle:
            assert set(bundle.namelist()) == {
                "plugin.json", "mcp.json", "assets/icon.svg",
                ".claude-plugin/plugin.json", ".mcp.json",
            }
        contents = files(response)
    assert set(contents) == {"plugin.json", "mcp.json", ".claude-plugin/plugin.json", ".mcp.json"}
    name = f"epic-stocks-{site.replace('.', '-')}-admin"
    for config in (contents["mcp.json"], contents[".mcp.json"]):
        assert config["mcpServers"][name]["url"] == f"https://{domain}/admin-mcp"
        assert all(not item["url"].endswith("/mcp") for item in config["mcpServers"].values())
    interface = contents["plugin.json"]["extensions"]["com.openai"]["interface"]
    assert interface["capabilities"] == ["Read"]
    assert "No personal account-data tools" in interface["longDescription"]


def test_unknown_package_options_are_rejected(client):
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com"}):
        register_user(client, "admin@example.com")
        assert client.get("/api/ai/plugin/other").status_code == 422
        assert client.get("/api/admin/ai/plugin/other").status_code == 404


def test_admin_package_refuses_missing_site_domain(client):
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com"}):
        register_user(client, "admin@example.com")
    with patch.dict(os.environ, {"ADMIN_EMAIL": "admin@example.com", "DOMAIN": ""}):
        assert client.get("/api/admin/ai/plugin").status_code == 503


def test_fork_package_uses_its_configured_domain(client):
    register_user(client)
    with patch.dict(os.environ, {"DOMAIN": "my-stocks.example.org"}):
        contents = files(client.get("/api/ai/plugin/chatgpt"))
    assert contents["mcp.json"]["mcpServers"]["epic-stocks"]["url"] == (
        "https://my-stocks.example.org/mcp"
    )


def test_official_staging_account_package_points_to_production(client):
    register_user(client)
    with patch.dict(os.environ, {"DOMAIN": "staging.epic-stocks.com"}):
        contents = files(client.get("/api/ai/plugin/claude"))
    assert contents[".mcp.json"]["mcpServers"]["epic-stocks"]["url"] == (
        "https://epic-stocks.com/mcp"
    )
