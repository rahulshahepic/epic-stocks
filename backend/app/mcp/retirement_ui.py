"""MCP Apps resources for retirement planning and comparison."""
from pathlib import Path

from .retirement_tools import RETIREMENT_COMPARE_RESOURCE_URIS, RETIREMENT_RESOURCE_URI, RETIREMENT_RESOURCE_URIS
from .ui_tools import MIME_TYPE, resource_contents


def retirement_resource_descriptor(uri: str = RETIREMENT_RESOURCE_URI):
    if uri not in RETIREMENT_RESOURCE_URIS:
        raise ValueError("Unknown retirement resource")
    comparison = uri in RETIREMENT_COMPARE_RESOURCE_URIS
    return {
        "uri": uri,
        "name": "epic-stocks-retirement-comparison" if comparison else "epic-stocks-retirement",
        "title": "Epic Stocks retirement comparison" if comparison else "Epic Stocks retirement planner",
        "mimeType": MIME_TYPE,
    }


def retirement_resource_contents(uri: str = RETIREMENT_RESOURCE_URI):
    # Share the validated HTTPS origin, no-network CSP and display modes.
    base = resource_contents()
    comparison = uri in RETIREMENT_COMPARE_RESOURCE_URIS
    filename = "retirement_compare.html" if comparison else "retirement.html"
    return {
        **retirement_resource_descriptor(uri),
        "text": Path(__file__).with_name(filename).read_text(encoding="utf-8"),
        "_meta": {
            **base["_meta"],
            "openai/widgetDescription": (
                "Side-by-side retirement scenario comparison with starting assets, funding risk and ending wealth."
                if comparison else
                "Interactive retirement Monte Carlo results and scenario controls. "
                "Displays funding-shortfall and exhaustion risks separately. "
                "What-if edits are unsaved until explicitly saved."
            ),
        },
    }
