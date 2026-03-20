"""Email notification sending via SMTP."""
import logging
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger(__name__)


def smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST", ""))


def _get_smtp_config() -> dict:
    return {
        "host": os.environ["SMTP_HOST"],
        "port": int(os.getenv("SMTP_PORT", "587")),
        "user": os.getenv("SMTP_USER", ""),
        "password": os.getenv("SMTP_PASSWORD", ""),
        "from_email": os.getenv("SMTP_FROM", os.getenv("SMTP_USER", "")),
        "use_tls": os.getenv("SMTP_TLS", "true").lower() == "true",
    }


def send_email(to_email: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
    if not smtp_configured():
        logger.warning("SMTP not configured, skipping email")
        return False

    cfg = _get_smtp_config()
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = cfg["from_email"]
    msg["To"] = to_email
    msg.attach(MIMEText(body_text, "plain"))
    if body_html:
        msg.attach(MIMEText(body_html, "html"))

    try:
        if cfg["use_tls"]:
            server = smtplib.SMTP(cfg["host"], cfg["port"])
            server.starttls()
        else:
            server = smtplib.SMTP(cfg["host"], cfg["port"])
        if cfg["user"]:
            server.login(cfg["user"], cfg["password"])
        server.sendmail(cfg["from_email"], [to_email], msg.as_string())
        server.quit()
        return True
    except Exception:
        logger.exception("Failed to send email to %s", to_email)
        return False


def build_event_email(events: list[dict]) -> tuple[str, str, str]:
    """Build subject, text body, and HTML body for event notification."""
    from collections import Counter
    counts = Counter(e["event_type"] for e in events)
    total = sum(counts.values())
    parts = [f"{count} {etype}" for etype, count in sorted(counts.items())]
    subject = f"Equity Tracker: {total} event{'s' if total != 1 else ''} today"
    text = f"You have {total} event{'s' if total != 1 else ''} today: {', '.join(parts)}\n\nLog in to view details."
    html = f"""<div style="font-family: sans-serif; max-width: 480px;">
  <h2 style="color: #4472C4;">Equity Tracker</h2>
  <p>You have <strong>{total}</strong> event{'s' if total != 1 else ''} today:</p>
  <ul>{''.join(f'<li>{count} {etype}</li>' for etype, count in sorted(counts.items()))}</ul>
  <p>Log in to view details.</p>
</div>"""
    return subject, text, html
