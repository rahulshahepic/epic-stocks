"""Email sending — delegates to the configured EmailProvider (Resend or SMTP)."""
import hashlib
import hmac
import logging
import os

logger = logging.getLogger(__name__)


def app_url() -> str:
    return os.getenv("APP_URL", "").rstrip("/")


# ── Unsubscribe token helpers (HMAC-based, stateless) ─────────────────────

def _unsubscribe_secret() -> bytes:
    """Derive a stable secret for unsubscribe HMAC tokens."""
    from scaffold.auth import JWT_SECRET
    return f"unsubscribe:{JWT_SECRET}".encode()


def generate_unsubscribe_token(email: str, category: str) -> str:
    """Generate an HMAC token for one-click unsubscribe.

    category: 'invite' (invitation emails) or 'notify' (event notifications).
    """
    msg = f"{email.lower().strip()}:{category}".encode()
    return hmac.new(_unsubscribe_secret(), msg, hashlib.sha256).hexdigest()


def verify_unsubscribe_token(token: str, email: str, category: str) -> bool:
    msg = f"{email.lower().strip()}:{category}".encode()
    expected = hmac.new(_unsubscribe_secret(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(token, expected)


def unsubscribe_url(email: str, category: str) -> str:
    """Build the full unsubscribe URL for an email footer."""
    base = app_url()
    if not base:
        return ""
    token = generate_unsubscribe_token(email, category)
    e = email.lower().strip()
    return f"{base}/unsubscribe?token={token}&email={e}&type={category}"


def list_unsubscribe_headers(email: str, category: str) -> dict[str, str]:
    """Build RFC 8058 List-Unsubscribe headers for email deliverability."""
    url = unsubscribe_url(email, category)
    if not url:
        return {}
    # POST URL for one-click unsubscribe (RFC 8058)
    post_url = app_url().rstrip("/") + "/api/unsubscribe"
    return {
        "List-Unsubscribe": f"<{url}>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }


def _unsubscribe_footer_text(email: str, category: str) -> str:
    url = unsubscribe_url(email, category)
    if not url:
        return ""
    return f"\n\n---\nTo unsubscribe from these emails: {url}\n"


def _unsubscribe_footer_html(email: str, category: str) -> str:
    url = unsubscribe_url(email, category)
    if not url:
        return ""
    return (
        '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e5;'
        'font-size:11px;color:#999;">'
        f'<a href="{url}" style="color:#999;text-decoration:underline;">Unsubscribe</a>'
        ' from these emails.'
        '</div>'
    )


def email_configured() -> bool:
    from scaffold.providers.email import email_configured as _provider_configured
    return _provider_configured()


def send_email(to_email: str, subject: str, body_text: str, body_html: str | None = None, *, headers: dict[str, str] | None = None) -> bool:
    from scaffold.providers.email import get_email_provider
    return get_email_provider().send(to_email, subject, body_text, body_html, headers=headers)


def build_event_email(events: list[dict], recipient_email: str = "") -> tuple[str, str, str, dict[str, str]]:
    """Build subject, text body, HTML body, and headers for event notification."""
    from collections import Counter
    counts = Counter(e["event_type"] for e in events)
    total = sum(counts.values())
    parts = [f"{count} {etype}" for etype, count in sorted(counts.items())]
    subject = f"Equity Tracker: {total} event{'s' if total != 1 else ''} today"
    url = app_url()
    link_text = f' <a href="{url}">Log in to view details.</a>' if url else " Log in to view details."
    unsub_text = _unsubscribe_footer_text(recipient_email, "notify") if recipient_email else ""
    unsub_html = _unsubscribe_footer_html(recipient_email, "notify") if recipient_email else ""
    hdrs = list_unsubscribe_headers(recipient_email, "notify") if recipient_email else {}
    text = f"You have {total} event{'s' if total != 1 else ''} today: {', '.join(parts)}\n\n{'Log in at ' + url if url else 'Log in to view details.'}{unsub_text}"
    html = f"""<div style="font-family: sans-serif; max-width: 480px;">
  <h2 style="color: #4472C4;">Equity Tracker</h2>
  <p>You have <strong>{total}</strong> event{'s' if total != 1 else ''} today:</p>
  <ul>{''.join(f'<li>{count} {etype}</li>' for etype, count in sorted(counts.items()))}</ul>
  <p>{link_text.strip()}</p>
  {unsub_html}
</div>"""
    return subject, text, html, hdrs


def build_invitation_email(inviter_name: str, token: str, short_code: str, recipient_email: str = "") -> tuple[str, str, str, dict[str, str]]:
    """Build subject, text body, HTML body, and headers for an invitation email."""
    url = app_url()
    link = f"{url}/invite?token={token}" if url else ""
    unsub_text = _unsubscribe_footer_text(recipient_email, "invite") if recipient_email else ""
    unsub_html = _unsubscribe_footer_html(recipient_email, "invite") if recipient_email else ""
    hdrs = list_unsubscribe_headers(recipient_email, "invite") if recipient_email else {}
    subject = f"{inviter_name} invited you to view their equity data"
    text = (
        f"{inviter_name} has invited you to view their equity vesting data.\n\n"
        + (f"Accept the invitation: {link}\n\n" if link else "")
        + f"Or sign in and enter this code: {short_code}\n\n"
        "You can sign in with any account (Google, Microsoft, etc.) — "
        "it does not need to match this email address.\n"
        "If you don't have an account yet, one will be created when you sign in.\n\n"
        "If you didn't expect this invitation, you can safely ignore this email."
        + unsub_text
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
  {unsub_html}
</div>"""
    return subject, text, html, hdrs
