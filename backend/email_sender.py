"""Email notification sending via Resend API."""
import logging
import os

import httpx

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


def app_url() -> str:
    return os.getenv("APP_URL", "").rstrip("/")


def email_configured() -> bool:
    return bool(os.getenv("RESEND_API_KEY", "")) and bool(os.getenv("RESEND_FROM", ""))


def send_email(to_email: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
    api_key = os.getenv("RESEND_API_KEY", "")
    from_email = os.getenv("RESEND_FROM", "")
    missing = [k for k, v in [("RESEND_API_KEY", api_key), ("RESEND_FROM", from_email)] if not v]
    if missing:
        logger.warning("%s not set, skipping email", " and ".join(missing))
        return False

    payload = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "text": body_text,
    }
    if body_html:
        payload["html"] = body_html

    try:
        resp = httpx.post(
            RESEND_API_URL,
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10,
        )
        resp.raise_for_status()
        return True
    except httpx.HTTPStatusError as e:
        detail = e.response.text
        logger.error("Resend HTTP error %s: %s", e.response.status_code, detail)
        raise httpx.HTTPStatusError(
            f"{e} — Resend response: {detail}",
            request=e.request,
            response=e.response,
        ) from e
    except Exception:
        logger.exception("Failed to send email to %s", to_email)
        raise


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
