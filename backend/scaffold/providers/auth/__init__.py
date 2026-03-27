import os


def get_auth_provider():
    """Return the configured auth provider instance based on AUTH_PROVIDER env var."""
    provider = os.getenv("AUTH_PROVIDER", "google").lower()
    if provider == "azure_entra":
        from .azure_entra import AzureEntraAuthProvider
        return AzureEntraAuthProvider()
    from .google import GoogleAuthProvider
    return GoogleAuthProvider()
