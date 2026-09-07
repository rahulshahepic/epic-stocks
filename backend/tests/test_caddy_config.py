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


def _policy_in_handle(config: str, matcher: str) -> str | None:
    """The Content-Security-Policy inside `handle <matcher> { ... }`.

    Read out of the block itself rather than picked from the set of policies in
    the file. Two blocks serve a `default-src 'none'` policy with no
    form-action — this one and the maintenance page — so choosing by shape
    picked whichever the set happened to yield first, which varies with
    Python's per-process hash seed. It passed locally and failed on CI.
    """
    start = config.find("handle %s {" % matcher)
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(config)):
        if config[i] == "{":
            depth += 1
        elif config[i] == "}":
            depth -= 1
            if depth == 0:
                found = re.search(
                    r'header Content-Security-Policy "([^"]+)"', config[start:i]
                )
                return found.group(1) if found else None
    return None


def test_the_oauth_paths_are_exempt_from_form_action():
    """Approving a connection ends in a redirect to the AI provider, and
    `form-action 'self'` blocks exactly that — browsers apply it to redirects,
    not only to the form's own action."""
    for name in ("app.caddy", "Caddyfile"):
        config = _read(name)
        assert "@oauth path /oauth/*" in config, f"{name} has no /oauth matcher"

        policy = _policy_in_handle(config, "@oauth")
        assert policy, f"{name}: the @oauth handle serves no Content-Security-Policy"
        assert "form-action" not in policy, (
            f"{name}: the @oauth policy still restricts form-action, so the "
            f"consent screen's redirect back to the provider will be blocked\n  {policy}"
        )
        assert "style-src 'self'" in policy, (
            f"{name}: the consent screen loads /oauth/consent.css, which needs "
            f"style-src 'self'\n  {policy}"
        )


def test_the_oauth_handle_reaches_the_app():
    """A handle block that matches but does not proxy would black-hole the path."""
    for name in ("app.caddy", "Caddyfile"):
        config = _read(name)
        start = config.find("handle @oauth {")
        block = config[start:config.find("}", config.find("reverse_proxy", start))]
        assert "reverse_proxy" in block, f"{name}: @oauth does not forward to the app"


def test_the_rest_of_the_site_keeps_form_action():
    """The exception is meant to be scoped to /oauth, not a site-wide loosening."""
    for name in ("app.caddy", "Caddyfile"):
        policies = _policies(_read(name))
        assert any("form-action 'self'" in p for p in policies), (
            f"{name} no longer restricts form-action anywhere"
        )
