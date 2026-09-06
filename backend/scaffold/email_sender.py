"""Email sending — delegates to the configured EmailProvider (Resend or SMTP)."""
import hashlib
import hmac
import logging
import os
from urllib.parse import quote

logger = logging.getLogger(__name__)


def app_url() -> str:
    return os.getenv("APP_URL", "").rstrip("/")


# An invitation email is a cold message asking someone to click a link and sign
# in with a work account — the exact shape of a phishing mail. Say plainly whose
# app this is, in every invitation, so the recipient can judge it.
APP_DISCLAIMER = (
    "Epic Stocks is an independent, personal project. It is not built, endorsed, "
    "or supported by Epic Systems Corporation."
)


# ── Unsubscribe token helpers (HMAC-based, stateless) ─────────────────────

def _unsubscribe_secret() -> bytes:
    """Return the secret used for unsubscribe HMAC tokens.

    Prefers UNSUBSCRIBE_SECRET env var so the tokens survive JWT_SECRET rotation.
    Falls back to a JWT_SECRET-derived value for environments that haven't set
    the dedicated var yet (backward-compatible; links issued before setting
    UNSUBSCRIBE_SECRET will stop working on next rotation).
    """
    dedicated = os.getenv("UNSUBSCRIBE_SECRET", "")
    if dedicated:
        return dedicated.encode()
    from scaffold.auth import JWT_SECRET
    return f"unsubscribe:{JWT_SECRET}".encode()


def generate_unsubscribe_token(email: str, category: str) -> str:
    """Generate an HMAC token for one-click unsubscribe.

    category: 'invite' (invitation emails) or 'notify' (event notifications).
    """
    msg = f"{email.lower().strip()}:{category}".encode()
    return hmac.new(_unsubscribe_secret(), msg, hashlib.sha256).hexdigest()


def verify_unsubscribe_token(token: str, email: str, category: str) -> bool:
    """Constant-time check of an unsubscribe link's HMAC.

    The token comes off a query string, so it is arbitrary text.
    hmac.compare_digest raises TypeError when handed a str with any non-ASCII
    character in it, which turned `?token=é` into an unauthenticated 500 — and
    every 500 writes an error_logs row that pushes a real traceback out of the
    500-row window. Compared as bytes instead: a token that is not ASCII cannot
    equal a hex digest, so it is simply wrong rather than exceptional.
    """
    msg = f"{email.lower().strip()}:{category}".encode()
    expected = hmac.new(_unsubscribe_secret(), msg, hashlib.sha256).hexdigest()
    try:
        supplied = (token or "").encode("ascii")
    except UnicodeEncodeError:
        return False
    return hmac.compare_digest(supplied, expected.encode("ascii"))


def _unsubscribe_query(email: str, category: str) -> str:
    """The token/email/type query string both unsubscribe URLs carry.

    The address is percent-encoded. A query string decodes "+" as a space, so
    an unencoded plus-addressed recipient (bob+epic@…) arrived back as
    "bob epic@…", hashed to something else, and was told their own
    unsubscribe link was invalid.
    """
    token = generate_unsubscribe_token(email, category)
    e = quote(email.lower().strip(), safe="")
    return f"token={token}&email={e}&type={quote(category, safe='')}"


def unsubscribe_url(email: str, category: str) -> str:
    """The page a person lands on from the footer link: confirm, then unsubscribe."""
    base = app_url()
    if not base:
        return ""
    return f"{base}/unsubscribe?{_unsubscribe_query(email, category)}"


def one_click_unsubscribe_url(email: str, category: str) -> str:
    """The URI for the List-Unsubscribe header — an endpoint, not the SPA page.

    A mail client acts on this without a person present, so it has to be
    something that can answer a POST. GET on it redirects to the page above,
    for the clients that render the header as an ordinary link.
    """
    base = app_url()
    if not base:
        return ""
    return f"{base}/api/unsubscribe/one-click?{_unsubscribe_query(email, category)}"


def list_unsubscribe_headers(email: str, category: str) -> dict[str, str]:
    """Build RFC 8058 List-Unsubscribe headers for email deliverability."""
    url = one_click_unsubscribe_url(email, category)
    if not url:
        return {}
    headers = {"List-Unsubscribe": f"<{url}>"}
    # List-Unsubscribe-Post is a promise that one POST to the URI above
    # unsubscribes with no further confirmation, and RFC 8058 §7 requires that
    # URI be https — a client is entitled to ignore anything else. Advertising
    # it from a plain-http APP_URL (local dev) would be a promise about a URI no
    # client should honour, so the header is only added when it can be kept.
    if url.startswith("https://"):
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    return headers


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
    subject = f"Epic Stocks: {total} event{'s' if total != 1 else ''} today"
    url = app_url()
    link_text = f' <a href="{url}">Log in to view details.</a>' if url else " Log in to view details."
    unsub_text = _unsubscribe_footer_text(recipient_email, "notify") if recipient_email else ""
    unsub_html = _unsubscribe_footer_html(recipient_email, "notify") if recipient_email else ""
    hdrs = list_unsubscribe_headers(recipient_email, "notify") if recipient_email else {}
    text = f"You have {total} event{'s' if total != 1 else ''} today: {', '.join(parts)}\n\n{'Log in at ' + url if url else 'Log in to view details.'}\n\n{APP_DISCLAIMER}{unsub_text}"
    html = f"""<div style="font-family: sans-serif; max-width: 480px;">
  <h2 style="color: #4472C4;">Epic Stocks</h2>
  <p>You have <strong>{total}</strong> event{'s' if total != 1 else ''} today:</p>
  <ul>{''.join(f'<li>{count} {etype}</li>' for etype, count in sorted(counts.items()))}</ul>
  <p>{link_text.strip()}</p>
  <p style="font-size:12px;color:#888;">{APP_DISCLAIMER}</p>
  {unsub_html}
</div>"""
    return subject, text, html, hdrs


# How much of a display name an invitation will show. The name comes from the
# inviter's identity provider, so it is whatever they last set it to — long
# enough to be a name, short enough that it cannot push the disclaimer and the
# account address out of a mail client's preview.
MAX_INVITER_NAME = 80


def build_invitation_email(inviter_name: str, token: str, short_code: str,
                           recipient_email: str = "", inviter_email: str = "") -> tuple[str, str, str, dict[str, str]]:
    """Build subject, text body, HTML body, and headers for an invitation email.

    An invitation is a cold email asking a stranger to click a link and sign in,
    and `inviter_name` is a string its sender chose at their identity provider —
    "Epic IT Security" is a valid Google display name. It is escaped, so this is
    not injection, but a name alone is not something a recipient can judge. The
    account address that actually sent it goes beside the name wherever the name
    appears, and the name itself is bounded.
    """
    from html import escape as _esc
    inviter_name = (inviter_name or "").strip()[:MAX_INVITER_NAME] or "Someone"
    inviter_email = (inviter_email or "").strip()
    # "Name (account@example.com)" wherever there is an address to show.
    who = f"{inviter_name} ({inviter_email})" if inviter_email else inviter_name
    url = app_url()
    link = f"{url}/invite?token={token}" if url else ""
    unsub_text = _unsubscribe_footer_text(recipient_email, "invite") if recipient_email else ""
    unsub_html = _unsubscribe_footer_html(recipient_email, "invite") if recipient_email else ""
    hdrs = list_unsubscribe_headers(recipient_email, "invite") if recipient_email else {}
    subject = f"{inviter_name} invited you to view their equity data"
    text = (
        f"{who} has invited you to view their equity vesting data.\n\n"
        + (f"Accept the invitation: {link}\n\n" if link else "")
        + f"Or sign in and enter this code: {short_code}\n\n"
        "You can sign in with any account (Google, Microsoft, etc.) — "
        "it does not need to match this email address.\n"
        "If you don't have an account yet, one will be created when you sign in.\n\n"
        "If you didn't expect this invitation, you can safely ignore this email.\n\n"
        + APP_DISCLAIMER
        + unsub_text
    )
    btn = (
        f'<a href="{link}" style="display:inline-block;padding:10px 24px;background:#b91c1c;'
        'color:white;border-radius:8px;text-decoration:none;font-weight:600;">Accept Invitation</a>'
    ) if link else ""
    safe_name = _esc(inviter_name)
    safe_from = (f' <span style="color:#666;">({_esc(inviter_email)})</span>'
                 if inviter_email else "")
    html = f"""<div style="font-family: sans-serif; max-width: 480px;">
  <h2 style="color: #4472C4;">Epic Stocks</h2>
  <p><strong>{safe_name}</strong>{safe_from} has invited you to view their equity vesting data.</p>
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
  <p style="font-size:12px;color:#888;">
    <strong>{APP_DISCLAIMER}</strong>
  </p>
  {unsub_html}
</div>"""
    return subject, text, html, hdrs
