"""The consent screen, rendered by the server.

Server-rendered rather than handed to the SPA: this page is the one place a
user decides what an outside party may read, and it should not depend on the
app's client-side router, its auth guard, or a bundle load to say so
truthfully. It also keeps the authorization request out of the SPA's URL.

Styling is deliberately self-contained and matches the app's light/dark
palette. There is no script on the page.
"""
import html


def _esc(value: str) -> str:
    return html.escape(value or "", quote=True)


_STYLE = """
:root { color-scheme: light dark; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f9fafb; color: #111827;
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; padding: 1rem; line-height: 1.5;
}
.card {
  width: 100%; max-width: 26rem; background: #fff; border: 1px solid #e5e7eb;
  border-radius: 0.75rem; padding: 1.5rem;
}
h1 { font-size: 1.125rem; font-weight: 600; margin-bottom: 0.25rem; }
.origin { font-size: 0.8125rem; color: #6b7280; margin-bottom: 1.25rem; word-break: break-all; }
.origin code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
ul { list-style: none; margin: 0 0 1.25rem; }
li { display: flex; gap: 0.625rem; padding: 0.5rem 0; font-size: 0.9375rem; align-items: flex-start; }
li svg { flex: none; margin-top: 0.1875rem; }
.note {
  font-size: 0.8125rem; color: #6b7280; background: #f3f4f6;
  border-radius: 0.5rem; padding: 0.625rem 0.75rem; margin-bottom: 1.25rem;
}
.who { font-size: 0.8125rem; color: #6b7280; margin-bottom: 1.25rem; }
.actions { display: flex; gap: 0.625rem; }
button {
  flex: 1; font: inherit; font-weight: 500; padding: 0.625rem 1rem;
  border-radius: 0.5rem; cursor: pointer; border: 1px solid transparent;
}
.allow { background: #2563eb; color: #fff; }
.allow:hover { background: #1d4ed8; }
.deny { background: #fff; color: #374151; border-color: #d1d5db; }
.deny:hover { background: #f9fafb; }
.err { font-size: 0.9375rem; }
.err h1 { margin-bottom: 0.75rem; }
@media (prefers-color-scheme: dark) {
  body { background: #0b0f19; color: #e5e7eb; }
  .card { background: #111827; border-color: #1f2937; }
  .origin, .who, .note { color: #9ca3af; }
  .note { background: #1f2937; }
  .deny { background: #1f2937; color: #e5e7eb; border-color: #374151; }
  .deny:hover { background: #263141; }
}
"""

_CHECK = (
    '<svg width="16" height="16" viewBox="0 0 20 20" fill="#16a34a" aria-hidden="true">'
    '<path fill-rule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 '
    '011.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" clip-rule="evenodd"/></svg>'
)


def _page(title: str, body: str) -> str:
    return (
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>{_esc(title)}</title><style>{_STYLE}</style></head>"
        f"<body><div class=\"card\">{body}</div></body></html>"
    )


def render_consent(*, client_name: str, redirect_origin: str, account_email: str,
                   scope_labels: list[str], request_token: str, csrf: str,
                   app_name: str = "Epic Stocks") -> str:
    items = "".join(f"<li>{_CHECK}<span>{_esc(label)}</span></li>" for label in scope_labels)
    body = (
        f"<h1>{_esc(client_name)} wants to connect to {_esc(app_name)}</h1>"
        f"<p class=\"origin\">It will return you to <code>{_esc(redirect_origin)}</code></p>"
        f"<ul>{items}</ul>"
        "<p class=\"note\">It will not be able to change anything — this connection is "
        "read-only. You can disconnect it at any time in Settings.</p>"
        f"<p class=\"who\">Signed in as {_esc(account_email)}</p>"
        "<form method=\"post\">"
        f"<input type=\"hidden\" name=\"request\" value=\"{_esc(request_token)}\">"
        f"<input type=\"hidden\" name=\"csrf\" value=\"{_esc(csrf)}\">"
        "<div class=\"actions\">"
        "<button class=\"deny\" type=\"submit\" name=\"decision\" value=\"deny\">Cancel</button>"
        "<button class=\"allow\" type=\"submit\" name=\"decision\" value=\"allow\">Connect</button>"
        "</div></form>"
    )
    return _page(f"Connect {client_name}", body)


def render_error(title: str, message: str) -> str:
    """For failures that must not be redirected — an unknown client, a bad redirect URI.

    Redirecting these would mean sending the browser somewhere the request
    itself failed to prove we should send it.
    """
    body = f"<div class=\"err\"><h1>{_esc(title)}</h1><p>{_esc(message)}</p></div>"
    return _page(title, body)
