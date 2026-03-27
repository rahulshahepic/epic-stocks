from .oidc import OIDCProvider, get_providers


def get_provider(name: str) -> OIDCProvider:
    """Return the provider with the given name, or raise ValueError."""
    providers = get_providers()
    provider = next((p for p in providers if p.config.name == name), None)
    if not provider:
        raise ValueError(f"Unknown auth provider: {name!r}")
    return provider
