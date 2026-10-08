import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "build-chatgpt-plugin.py"
spec = importlib.util.spec_from_file_location("plugin_builder", SCRIPT)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def test_package_has_portable_transport_and_existing_assets(tmp_path):
    output = tmp_path / "package"
    builder.build("https://equity.example.com/mcp", output)
    config = json.loads((output / "mcp.json").read_text())
    assert config["mcpServers"]["epic-stocks"] == {"type": "streamable-http", "url": "https://equity.example.com/mcp"}
    manifest = json.loads((output / "plugin.json").read_text())
    interface = manifest["extensions"]["com.openai"]["interface"]
    assert (output / interface["logo"]).is_file()
    assert not (output / ".app.json").exists()  # Never invent a registered app ID.


@pytest.mark.parametrize("url", ["http://equity.example.com/mcp", "https://user:pass@equity.example.com/mcp", "https://equity.example.com/mcp?token=secret", "https://equity.example.com/api", "https://equity.example.com/mcp#token"])
def test_package_rejects_credentials_and_wrong_endpoint(tmp_path, url):
    with pytest.raises(ValueError):
        builder.build(url, tmp_path / "package")
    assert not (tmp_path / "package").exists()
