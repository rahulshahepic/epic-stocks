"""The consent screen, rendered by the server.

Server-rendered rather than handed to the SPA: this page is the one place a
user decides what an outside party may read, and it should not depend on the
app's client-side router, its auth guard, or a bundle load to say so
truthfully. It also keeps the authorization request out of the SPA's URL.

The stylesheet is served from /oauth/consent.css rather than inlined in a
<style> block: the deployment's Content-Security-Policy is `style-src 'self'`,
which blocks an inline style outright, and the page rendered as unstyled
browser defaults on staging because of it. Adding a hash to the CSP would work
until the next time this file is edited. The selection controls use a same-origin external script for the same reason.

Colours are the app's own tokens rather than a generic palette, so the screen
reads as part of the product a user just signed in to.
"""
import html

from . import scopes as scope_defs


def _esc(value: str) -> str:
    return html.escape(value or "", quote=True)


STYLESHEET_PATH = "/oauth/consent.css?v=2"
SCRIPT_PATH = "/oauth/consent.js?v=3"

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
  display: flex; align-items: safe center; justify-content: center;
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
  background: var(--raised); color: var(--text-2); border-radius: .25rem; padding: .0625rem .25rem;
}
[hidden] { display: none !important; }
fieldset { min-width: 0; border: 1px solid var(--border-strong); border-radius: .625rem;
  padding: .25rem .75rem .5rem; margin: 0 0 1rem; }
legend { font-size: .9375rem; font-weight: 600; padding: 0 .25rem; }
.quick { display: flex; gap: .5rem; margin-bottom: .25rem; }
.quick button { min-height: 44px; padding: .375rem .5rem; font-size: .8125rem;
  color: var(--text); background: var(--raised); border-color: var(--border-strong); }
.permission { display: flex; gap: .625rem; align-items: flex-start; min-height: 44px;
  padding: .625rem 0; font-size: .875rem; color: var(--text-2); cursor: pointer; }
.permission input { flex: none; width: 1.125rem; height: 1.125rem; margin-top: .125rem;
  accent-color: var(--brand); }
.permission small { display: block; color: var(--text-2); margin-top: .125rem; }
.help { font-size: .8125rem; color: var(--text-2); margin-bottom: 1rem; }
:focus-visible { outline: 3px solid var(--brand); outline-offset: 3px; }
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
.edits { font-size: .875rem; line-height: 1.45; margin: 0 0 1rem; padding: .625rem .75rem;
  border-radius: .5rem; border: 1px solid #d97706; background: rgba(217,119,6,.12); }
.opt { display: flex; gap: .5rem; align-items: flex-start; font-size: .8125rem; margin: 0 0 1rem; }
.opt input { margin-top: .2rem; }
.who { font-size: .8125rem; color: var(--muted); margin-bottom: 1.25rem; word-break: break-all; }
.actions { display: flex; gap: .5rem; }
button {
  flex: 1; font: inherit; font-size: .875rem; font-weight: 600;
  padding: .625rem 1rem; border-radius: .625rem; cursor: pointer;
  border: 1px solid transparent; transition: background-color .12s ease;
}
.allow { background: #C41230; color: #fff; }
.allow:hover { background: #A80F28; }
.deny { background: var(--surface); color: var(--text-2); border-color: var(--border-strong); }
.deny:hover { background: var(--raised); }
.err { font-size: .875rem; color: var(--text-2); }
.err h1 { margin-bottom: .5rem; color: var(--text); }
.admin-option { padding: .875rem; margin-bottom: 1.25rem; border: 1px solid var(--border-strong);
  border-radius: .625rem; background: var(--raised); font-size: .8125rem; }
.admin-option p { margin: .375rem 0 .75rem; color: var(--text-2); }
.admin-option button { width: 100%; }
.or { margin-bottom: .75rem; color: var(--muted); font-size: .8125rem; }
"""

def _page(title: str, body: str) -> str:
    return (
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>{_esc(title)}</title>"
        f"<link rel=\"stylesheet\" href=\"{STYLESHEET_PATH}\">"
        f"<script src=\"{SCRIPT_PATH}\" defer></script></head>"
        f"<body><div class=\"card\">{body}</div></body></html>"
    )


# Permissions a person must tick themselves, even when the client asks for them.
NEVER_PRESELECTED = frozenset({scope_defs.ADMIN_WRITE})


def render_consent(*, client_name: str, redirect_origin: str, account_email: str,
                   requested_scopes: list[str], request_token: str, csrf: str,
                   admin: bool = False, action: str = "/oauth/authorize",
                   app_name: str = "Epic Stocks") -> str:
    groups = (("Diagnostics", scope_defs.ADMIN_SCOPES),) if admin else (
        ("Equity", (scope_defs.EQUITY_READ, scope_defs.EQUITY_WRITE)),
        ("Compensation", (scope_defs.COMP_READ, scope_defs.COMP_WRITE)),
    )
    sections = []
    for title, scopes in groups:
        choices = "".join(
            f'<label class="permission"><input type="checkbox" name="selected_scope" '
            f'value="{_esc(scope)}"' + (' checked' if scope in requested_scopes and scope not in NEVER_PRESELECTED else '') + '>'
            f'<span>{_esc(scope_defs.SCOPE_LABELS[scope])}'
            + ('<small>Requested by the app — not selected unless you tick it</small>'
               if scope in requested_scopes and scope in NEVER_PRESELECTED
               else '<small>Requested by the app</small>' if scope in requested_scopes else '')
            + '</span></label>'
            for scope in scopes
        )
        sections.append(
            f'<fieldset><legend>{title}</legend><div class="quick" hidden>'
            f'<button type="button" data-select="all" aria-label="Select all {title.lower()} permissions">Select all</button>'
            f'<button type="button" data-select="none" aria-label="Clear all {title.lower()} permissions">Clear all</button>'
            '</div>' + ('<p class="help">Preparing imports and editing equity also require equity read access.</p>' if title == 'Equity' else '')
            + ('<p class="help">Changing settings also requires read access. Anything that would let '
               'more assistants connect is filed as a request you approve in Admin, never done directly.</p>'
               if title == 'Diagnostics' else '')
            + f'{choices}</fieldset>'
        )
    body = (
        f'<h1>{_esc(client_name)} wants to connect to {_esc(app_name)}</h1>'
        f'<p class="origin">It will return you to <code>{_esc(redirect_origin)}</code></p>'
        '<p class="help">Choose what this connection can do. Requested permissions start checked; '
        'you can add or remove any permission below.</p>'
        f'<form method="post" action="{_esc(action)}">'
        f'<input type="hidden" name="request" value="{_esc(request_token)}">'
        f'<input type="hidden" name="csrf" value="{_esc(csrf)}">'
        '<input type="hidden" name="permission_selection" value="1">'
        + ''.join(sections)
        + '<p class="note" id="permission-summary" role="status" aria-live="polite">'
        'Only checked permissions will be granted. Editing permissions let the app change those '
        'records when you ask. You can disconnect at any time in Settings.</p>'
        f'<p class="who">Signed in as {_esc(account_email)}</p>'
        '<div class="actions">'
        '<button class="deny" type="submit" name="decision" value="deny" formnovalidate>Cancel</button>'
        '<button class="allow" type="submit" name="decision" value="allow">Connect</button>'
        '</div></form>'
    )
    return _page(f"Connect {client_name}", body)


SCRIPT = """
'use strict';
const form = document.querySelector('form');
if (form) {
  const choices = [...form.querySelectorAll('input[name="selected_scope"]')];
  const summary = document.getElementById('permission-summary');
  function update() {
    const selected = new Set(choices.filter(input => input.checked).map(input => input.value));
    for (const input of choices) input.setCustomValidity('');
    if (!selected.size) choices[0].setCustomValidity('Select at least one permission, or cancel.');
    const equityRead = choices.find(input => input.value === 'equity:read');
    if ((selected.has('equity:write') || selected.has('import:propose')) && !selected.has('equity:read')) {
      equityRead.setCustomValidity('To prepare imports or edit equity, also select Read your equity.');
    }
    const adminRead = choices.find(input => input.value === 'admin:read');
    if (selected.has('admin:write') && !selected.has('admin:read')) {
      adminRead.setCustomValidity('To change settings, also select read access.');
    }
    if (selected.has('admin:write')) {
      summary.textContent = 'This selection lets the assistant change site settings when you ask: ' +
        'triage reports and switch AI providers off. Anything that lets more assistants connect ' +
        'waits for your approval in Admin. You can disconnect at any time in Settings.';
    } else if (selected.has('equity:write') || selected.has('comp:write')) {
      const records = [];
      if (selected.has('equity:write')) records.push('grants, prices, loans and sales');
      if (selected.has('comp:write')) records.push('salary, bonus history and retirement balances');
      summary.textContent = 'This selection lets the app edit your ' + records.join('; and ') +
        ' when you ask, without another confirmation here. You can disconnect at any time in Settings.';
    } else if (selected.has('import:propose')) {
      summary.textContent = 'This selection lets the app prepare imports. Your records change only after you review and accept them. You can disconnect at any time in Settings.';
    } else if (selected.size && adminRead) {
      summary.textContent = 'This selection is read-only. It cannot change site settings. You can disconnect at any time in Settings.';
    } else if (selected.size) {
      summary.textContent = 'This selection is read-only. It cannot change your records or prepare imports. You can disconnect at any time in Settings.';
    } else {
      summary.textContent = 'Select at least one permission, or cancel.';
    }
  }
  for (const controls of form.querySelectorAll('.quick')) controls.hidden = false;
  for (const button of form.querySelectorAll('[data-select]')) {
    button.addEventListener('click', () => {
      for (const input of button.closest('fieldset').querySelectorAll('input[name="selected_scope"]')) {
        input.checked = button.dataset.select === 'all';
      }
      update();
    });
  }
  form.addEventListener('change', update);
  update();
}
"""


def render_error(title: str, message: str) -> str:
    """For failures that must not be redirected — an unknown client, a bad redirect URI.

    Redirecting these would mean sending the browser somewhere the request
    itself failed to prove we should send it.
    """
    body = f"<div class=\"err\"><h1>{_esc(title)}</h1><p>{_esc(message)}</p></div>"
    return _page(title, body)
