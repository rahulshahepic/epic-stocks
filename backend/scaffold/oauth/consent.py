"""The consent screen, rendered by the server.

Server-rendered rather than handed to the SPA: this page is the one place a
user decides what an outside party may read, and it should not depend on the
app's client-side router, its auth guard, or a bundle load to say so
truthfully. It also keeps the authorization request out of the SPA's URL.

The stylesheet is served from /oauth/consent.css rather than inlined in a
<style> block: the deployment's Content-Security-Policy is `style-src 'self'`,
which blocks an inline style outright, and the page rendered as unstyled
browser defaults on staging because of it. Adding a hash to the CSP would work
until the next time this file is edited. There is no script on the page.

Colours are the app's own tokens rather than a generic palette, so the screen
reads as part of the product a user just signed in to.
"""
import html


def _esc(value: str) -> str:
    return html.escape(value or "", quote=True)


STYLESHEET_PATH = "/oauth/consent.css"

# The app's own tokens, so this does not look like a different product.
STYLESHEET = """
:root {
  color-scheme: light dark;
  --base: #F8F6F4; --surface: #FFFFFF; --raised: #F0EDE9;
  --border: #EAE7E3; --border-strong: #C8C3BC;
  --text: #1A1411; --text-2: #6B5F58; --muted: #78716C;
  --brand: #C41230; --brand-hover: #A80F28;
  --ok: #15803D;
}
@media (prefers-color-scheme: dark) {
  :root {
    --base: #111009; --surface: #1C1917; --raised: #252220;
    --border: rgba(255,255,255,.07); --border-strong: rgba(255,255,255,.14);
    --text: #F2EDE8; --text-2: #A8998F; --muted: #9E9089;
    --brand: #E8334A; --brand-hover: #D42A40;
    --ok: #34D399;
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--base); color: var(--text);
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; padding: 1rem; line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.card {
  width: 100%; max-width: 24rem; background: var(--surface);
  border: 1px solid var(--border); border-radius: 1rem; padding: 1.5rem;
  box-shadow: 0 1px 2px rgba(26,20,17,.04), 0 10px 28px -16px rgba(26,20,17,.16);
}
h1 { font-size: 1.0625rem; font-weight: 600; line-height: 1.35; margin-bottom: .375rem; }
.origin { font-size: .8125rem; color: var(--muted); margin-bottom: 1.25rem; word-break: break-all; }
.origin code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--raised); border-radius: .25rem; padding: .0625rem .25rem;
}
ul { list-style: none; margin: 0 0 1rem; }
li {
  display: flex; gap: .625rem; padding: .4375rem 0; font-size: .875rem;
  align-items: flex-start; color: var(--text-2);
}
li svg { flex: none; margin-top: .1875rem; }
.note {
  font-size: .8125rem; color: var(--text-2); background: var(--raised);
  border-radius: .625rem; padding: .625rem .75rem; margin-bottom: 1rem;
}
.who { font-size: .8125rem; color: var(--muted); margin-bottom: 1.25rem; word-break: break-all; }
.actions { display: flex; gap: .5rem; }
button {
  flex: 1; font: inherit; font-size: .875rem; font-weight: 600;
  padding: .625rem 1rem; border-radius: .625rem; cursor: pointer;
  border: 1px solid transparent; transition: background-color .12s ease;
}
.allow { background: var(--brand); color: #fff; }
.allow:hover { background: var(--brand-hover); }
.deny { background: var(--surface); color: var(--text-2); border-color: var(--border-strong); }
.deny:hover { background: var(--raised); }
.err { font-size: .875rem; color: var(--text-2); }
.err h1 { margin-bottom: .5rem; color: var(--text); }
"""

_CHECK = (
    '<svg width="15" height="15" viewBox="0 0 20 20" fill="var(--ok)" aria-hidden="true">'
    '<path fill-rule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 '
    '011.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" clip-rule="evenodd"/></svg>'
)


def _page(title: str, body: str) -> str:
    return (
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>{_esc(title)}</title>"
        f"<link rel=\"stylesheet\" href=\"{STYLESHEET_PATH}\"></head>"
        f"<body><div class=\"card\">{body}</div></body></html>"
    )


def render_consent(*, client_name: str, redirect_origin: str, account_email: str,
                   scope_labels: list[str], request_token: str, csrf: str,
                   read_only: bool = True, app_name: str = "Epic Stocks") -> str:
    items = "".join(f"<li>{_CHECK}<span>{_esc(label)}</span></li>" for label in scope_labels)
    # The claim has to follow the scopes actually being granted. Saying
    # "read-only" over a connection that can leave an import behind would be
    # the one sentence on this screen a user is entitled to rely on, and wrong.
    note = (
        "It will not be able to change anything — this connection is read-only. "
        "You can disconnect it at any time in Settings."
        if read_only else
        "It cannot change your data on its own. Anything it prepares waits for "
        "you to review and accept it in the app. You can disconnect it at any "
        "time in Settings."
    )
    body = (
        f"<h1>{_esc(client_name)} wants to connect to {_esc(app_name)}</h1>"
        f"<p class=\"origin\">It will return you to <code>{_esc(redirect_origin)}</code></p>"
        f"<ul>{items}</ul>"
        f"<p class=\"note\">{note}</p>"
        f"<p class=\"who\">Signed in as {_esc(account_email)}</p>"
        "<form method=\"post\" action=\"/oauth/authorize\">"
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
