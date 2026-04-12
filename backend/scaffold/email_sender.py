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


def build_invitation_email(inviter_name: str, token: str, short_code: str) -> tuple[str, str, str]:
    """Build subject, text body, and HTML body for an invitation email."""
    url = app_url()
    link = f"{url}/invite?token={token}" if url else ""
    subject = f"{inviter_name} invited you to view their equity data"
    text = (
        f"{inviter_name} has invited you to view their equity vesting data.\n\n"
        + (f"Accept the invitation: {link}\n\n" if link else "")
        + f"Or sign in and enter this code: {short_code}\n\n"
        "You can sign in with any account (Google, Microsoft, etc.) — "
        "it does not need to match this email address.\n"
        "If you don't have an account yet, one will be created when you sign in.\n\n"
        "If you didn't expect this invitation, you can safely ignore this email."
    )
    btn = (
        f'<a href="{link}" style="display:inline-block;padding:10px 24px;background:#b91c1c;'
        'color:white;border-radius:8px;text-decoration:none;font-weight:600;">Accept Invitation</a>'
    ) if link else ""
    html = f"""<div style="font-family: sans-serif; max-width: 480px;">
  <h2 style="color: #4472C4;">Equity Vesting Tracker</h2>
  <p><strong>{inviter_name}</strong> has invited you to view their equity vesting data.</p>
  {f'<p style="margin:24px 0;">{btn}</p>' if btn else ''}
  <p style="margin-top:16px;font-size:13px;color:#666;">
    Or enter this code manually after signing in:<br>
    <strong style="font-size:18px;letter-spacing:2px;">{short_code}</strong>
  </p>
  <hr style="border:none;border-top:1px solid #e5e5e5;margin:20px 0;">
  <p style="font-size:12px;color:#888;">
    You can sign in with any account (Google, Microsoft, etc.) &mdash;
    it does not need to match this email address.
    If you don&rsquo;t have an account yet, one will be created when you sign in.
  </p>
  <p style="font-size:12px;color:#888;">
    If you didn&rsquo;t expect this invitation, you can safely ignore this email.
  </p>
</div>"""
    return subject, text, html
