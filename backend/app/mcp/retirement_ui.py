"""ChatGPT MCP Apps resource for the retirement planner."""
from pathlib import Path

from .retirement_tools import RETIREMENT_RESOURCE_URI
from .ui_tools import MIME_TYPE, resource_contents


def retirement_resource_descriptor():
    return {
        "uri": RETIREMENT_RESOURCE_URI,
        "name": "epic-stocks-retirement",
        "title": "Epic Stocks retirement planner",
        "mimeType": MIME_TYPE,
    }


def retirement_resource_contents():
    # Share the validated HTTPS origin, no-network CSP and display modes.
    base = resource_contents()
    return {
        **retirement_resource_descriptor(),
        "text": Path(__file__).with_name("retirement.html").read_text(encoding="utf-8"),
        "_meta": {
            **base["_meta"],
            "openai/widgetDescription": (
                "Interactive retirement Monte Carlo results and scenario controls. "
                "Displays funding-shortfall and exhaustion risks separately. "
                "What-if edits are unsaved until explicitly saved."
            ),
        },
    }
