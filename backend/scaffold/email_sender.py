"""Email sending — delegates to the configured EmailProvider (Resend or SMTP)."""
import logging
import os

logger = logging.getLogger(__name__)


def app_url() -> str:
    return os.getenv("APP_URL", "").rstrip("/")


def email_configured() -> bool:
    from scaffold.providers.email import email_configured as _provider_configured
    return _provider_configured()


def send_email(to_email: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
    from scaffold.providers.email import get_email_provider
    return get_email_provider().send(to_email, subject, body_text, body_html)


def build_event_email(events: list[dict]) -> tuple[str, str, str]:
    """Build subject, text body, and HTML body for event notification."""
    from collections import Counter
    counts = Counter(e["event_type"] for e in events)
    total = sum(counts.values())
    parts = [f"{count} {etype}" for etype, count in sorted(counts.items())]
    subject = f"Equity Tracker: {total} event{'s' if total != 1 else ''} today"
    url = app_url()
    link_text = f' <a href="{url}">Log in to view details.</a>' if url else " Log in to view details."
    text = f"You have {total} event{'s' if total != 1 else ''} today: {', '.join(parts)}\n\n{'Log in at ' + url if url else 'Log in to view details.'}"
    html = f"""<div style="font-family: sans-serif; max-width: 480px;">
  <h2 style="color: #4472C4;">Equity Tracker</h2>
  <p>You have <strong>{total}</strong> event{'s' if total != 1 else ''} today:</p>
  <ul>{''.join(f'<li>{count} {etype}</li>' for etype, count in sorted(counts.items()))}</ul>
  <p>{link_text.strip()}</p>
</div>"""
    return subject, text, html
