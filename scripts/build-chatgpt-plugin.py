"""Build a portable package for a specific deployment; never bake in credentials."""
import argparse
import json
import shutil
from pathlib import Path
from urllib.parse import urlparse


def build(endpoint: str, output: Path) -> None:
    url = urlparse(endpoint)
    if (url.scheme != "https" or not url.hostname or url.path != "/mcp"
            or url.username or url.password or url.query or url.fragment):
        raise ValueError("Use your deployment's HTTPS /mcp URL without credentials or query parameters")
    source = Path(__file__).resolve().parents[1] / "plugins" / "epic-stocks"
    if output.resolve() == source.resolve() or source.resolve() in output.resolve().parents:
        raise ValueError("Build outside the plugin source directory")
    if output.exists():
        raise ValueError("Choose a new output directory")
    shutil.copytree(source, output)
    config = {
        "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        "mcpServers": {"epic-stocks": {"type": "streamable-http", "url": endpoint}},
    }
    (output / "mcp.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        build(args.url, args.output)
    except ValueError as exc:
        parser.error(str(exc))
