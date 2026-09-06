"""The two Caddy configs have to agree, because only one of them deploys.

`caddy/app.caddy` is the per-app snippet the deploy script copies into the
shared Caddy and reloads. `caddy/Caddyfile` is the single-app config used by
docker-compose. They are near-identical, and a change to the wrong one is
invisible: the app deploys, the header does not change, and CI stays green
because the validate job only ever looks at app.caddy.

That is not hypothetical — the CSP exception for the OAuth consent screen was
written into Caddyfile alone, merged, deployed, and had no effect on the
running site.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

_CADDY_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "caddy")


def _read(name: str) -> str:
    with open(os.path.join(_CADDY_DIR, name)) as fh:
        return fh.read()


def _policies(config: str) -> set[str]:
    """Every Content-Security-Policy this config can serve."""
    return set(re.findall(r'header Content-Security-Policy "([^"]+)"', config))


def _matchers(config: str) -> set[str]:
    """Named path matchers, e.g. `@oauth path /oauth/*`."""
    return set(re.findall(r'^\s*(@\w+)\s+path\s+(.+)$', config, re.MULTILINE))


def test_both_configs_serve_the_same_set_of_policies():
    app, single = _policies(_read("app.caddy")), _policies(_read("Caddyfile"))
    assert app == single, (
        "caddy/app.caddy and caddy/Caddyfile disagree about Content-Security-Policy.\n"
        f"only in app.caddy:  {sorted(app - single)}\n"
        f"only in Caddyfile:  {sorted(single - app)}\n"
        "app.caddy is the one the deploy script ships — a change to Caddyfile "
        "alone silently does nothing on the reference deployment."
    )


def test_both_configs_route_the_same_paths():
    app, single = _matchers(_read("app.caddy")), _matchers(_read("Caddyfile"))
    assert app == single, (
        "the two Caddy configs match different paths.\n"
        f"only in app.caddy: {sorted(app - single)}\n"
        f"only in Caddyfile: {sorted(single - app)}"
    )


def test_the_oauth_paths_are_exempt_from_form_action():
    """Approving a connection ends in a redirect to the AI provider, and
    `form-action 'self'` blocks exactly that — browsers apply it to redirects,
    not only to the form's own action."""
    for name in ("app.caddy", "Caddyfile"):
        config = _read(name)
        assert "@oauth path /oauth/*" in config, f"{name} has no /oauth matcher"

        oauth_policy = next(
            (p for p in _policies(config) if "form-action" not in p and "default-src 'none'" in p),
            None,
        )
        assert oauth_policy, (
            f"{name} has no policy without form-action — the consent screen's "
            "redirect back to the provider will be blocked"
        )
        assert "style-src 'self'" in oauth_policy, (
            f"{name}: the consent screen loads /oauth/consent.css, which needs style-src 'self'"
        )


def test_the_rest_of_the_site_keeps_form_action():
    """The exception is meant to be scoped to /oauth, not a site-wide loosening."""
    for name in ("app.caddy", "Caddyfile"):
        policies = _policies(_read(name))
        assert any("form-action 'self'" in p for p in policies), (
            f"{name} no longer restricts form-action anywhere"
        )
