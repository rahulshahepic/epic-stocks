"""Credential-free assistant plugin archives for phone-friendly connection setup."""

import io
import json
import os
import re
import zipfile
from enum import Enum
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from scaffold.auth import get_admin_user, get_current_user
from scaffold.financial_notice import FINANCIAL_NOTICE
from scaffold.models import User

router = APIRouter(tags=["AI connections"])

PRODUCTION = "https://epic-stocks.com"
STAGING = "https://staging.epic-stocks.com"


class Platform(str, Enum):
    chatgpt = "chatgpt"
    claude = "claude"


def package_files(platform: str, name: str, description: str, url: str) -> dict[str, dict | str]:
    if platform == "admin":
        return {**package_files("chatgpt", name, description, url),
                **package_files("claude", name, description, url)}
    backend_root = Path(__file__).resolve().parents[2]
    source = backend_root.parent / "plugins" / "epic-stocks"
    if not source.exists():
        source = backend_root / "plugins" / "epic-stocks"
    manifest = json.loads((source / "plugin.json").read_text(encoding="utf-8"))
    origin = url.rsplit("/", 1)[0]
    manifest["homepage"] = origin
    display_name = description.split(" — ")[0]
    account_plugin = url.endswith("/mcp")
    account_notice = "Epic Stocks cannot service, refinance, or repay loans. " + FINANCIAL_NOTICE
    if account_plugin:
        description += ". Track entered or imported equity and stock loan records and model scenario impacts. " + account_notice
    if platform == "chatgpt":
        manifest["name"] = name
        manifest["description"] = description
        interface = manifest["extensions"]["com.openai"]["interface"]
        interface["displayName"] = display_name if len(display_name) <= 30 else "Epic Stocks Site Admin"
        interface.update(
            websiteURL=origin,
            supportURL=f"{origin}/support",
            privacyPolicyURL=f"{origin}/privacy-policy",
            termsOfServiceURL=f"{origin}/terms",
        )
        if url.endswith("/admin-mcp"):
            interface["shortDescription"] = "Read-only site diagnostics"
            interface["longDescription"] = (
                "Read deployment status, system metrics and redacted application errors "
                "from this Epic Stocks environment. Requires an administrator sign-in. "
                "No personal account-data tools are included."
            )
            interface["capabilities"] = ["Read"]
            interface["defaultPrompt"] = ["Check Epic Stocks deployment and errors"]
        if "staging-test" in name:
            interface["longDescription"] = description + " Never treat this environment as a source for personal finances or production data."
            interface["defaultPrompt"] = ["Test the fictional staging account workflows"]
        elif account_plugin:
            interface["longDescription"] += " " + account_notice
        return {
            "plugin.json": manifest,
            "assets/icon.svg": (source / "assets" / "icon.svg").read_text(encoding="utf-8"),
            "mcp.json": {
                "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
                "mcpServers": {
                    name: {
                        "type": "streamable-http",
                        "url": url,
                        "extensions": {
                            "com.openai": {
                                "auth": {"type": "oauth", "client": {"mode": "dcr"}}
                            }
                        },
                    }
                },
            },
        }
    return {
        ".claude-plugin/plugin.json": {
            "name": name,
            "displayName": display_name,
            "version": "1.0.1",
            "author": manifest["author"],
            "homepage": f"{origin}/mcp-setup",
            "supportUrl": f"{origin}/support",
            "privacyPolicyUrl": f"{origin}/privacy-policy",
            "repository": manifest["repository"],
            "license": manifest["license"],
            "keywords": manifest["keywords"],
            "description": description,
        },
        ".mcp.json": {"mcpServers": {name: {"type": "http", "url": url}}},
    }


def archive(platform: str, name: str, description: str, url: str) -> Response:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for path, value in package_files(platform, name, description, url).items():
            bundle.writestr(path, json.dumps(value, indent=2) + "\n" if isinstance(value, dict) else value)
    filename = name if platform == "admin" else f"{name}-{platform}"
    return Response(
        content=output.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}.zip"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


def site_origin() -> str | None:
    domain = os.getenv("DOMAIN", "").strip().lower()
    if domain and re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", domain):
        return f"https://{domain}"
    return None


def account_origin() -> str:
    origin = site_origin()
    return origin or PRODUCTION


@router.get("/api/ai/plugin/{platform}")
def account_plugin(platform: Platform, user: User = Depends(get_current_user)):
    origin = account_origin()
    if origin == STAGING:
        return archive(platform.value, "epic-stocks-staging-test",
                       "Epic Stocks Staging Test — fictional data only; never sync to personal finances", f"{origin}/mcp")
    return archive(platform.value, "epic-stocks", "Epic Stocks — account data", f"{origin}/mcp")


@router.get("/api/admin/ai/plugin")
def admin_plugin(admin: User = Depends(get_admin_user)):
    origin = site_origin()
    if origin is None:
        raise HTTPException(status_code=503, detail="Site domain is not configured")
    site = ("staging" if origin == STAGING else
            "production" if origin == PRODUCTION else origin.removeprefix("https://"))
    display_site = site.title() if site in {"staging", "production"} else site
    return archive("admin", f"epic-stocks-{site.replace('.', '-')}-admin",
                   f"Epic Stocks {display_site} Admin — diagnostics only",
                   f"{origin}/admin-mcp")
