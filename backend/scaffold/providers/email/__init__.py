import os


def get_email_provider():
    """Return the configured email provider based on EMAIL_PROVIDER env var."""
    provider = os.getenv("EMAIL_PROVIDER", "resend").lower()
    if provider == "smtp":
        from .smtp import SmtpEmailProvider
        return SmtpEmailProvider()
    from .resend import ResendEmailProvider
    return ResendEmailProvider()


def email_configured() -> bool:
    """Return True if the active email provider has sufficient configuration."""
    return get_email_provider().is_configured()
