"""Server-readable legal and support pages for directory review."""
from html import escape
from pathlib import Path
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse

from scaffold.financial_notice import FINANCIAL_NOTICE

router = APIRouter(tags=['Public documentation'])


def policy_text():
    root = Path(__file__).resolve().parents[2]
    for path in (root / 'PUBLIC_PRIVACY.md', root.parent / 'PRIVACY.md'):
        if path.is_file():
            return path.read_text(encoding='utf-8')
    raise HTTPException(503, 'Privacy documentation is temporarily unavailable')


def inline(text):
    pattern = r'`([^`]+)`|\[([^\]]+)\]\((https://[^\s)]+)\)|\*\*([^*]+)\*\*'
    parts, end = [], 0
    for match in re.finditer(pattern, text):
        parts.append(escape(text[end:match.start()]))
        code, label, url, strong = match.groups()
        if code is not None:
            parts.append('<code>' + escape(code) + '</code>')
        elif label is not None:
            parts.append('<a href="' + escape(url, quote=True) + '">' + inline(label) + '</a>')
        else:
            parts.append('<strong>' + inline(strong) + '</strong>')
        end = match.end()
    parts.append(escape(text[end:]))
    return ''.join(parts)


def policy_html(text, *, title="Epic Stocks privacy policy", plain_policy=True):
    # Render only trusted-repository headings, paragraphs, lists and code. Raw
    # HTML is escaped; no document uploads or caller-selected paths are read.
    parts, paragraph, listed, code = [], [], None, None
    def flush():
        if paragraph:
            parts.append('<p>' + inline(' '.join(paragraph)) + '</p>')
            paragraph.clear()
    for line in text.splitlines():
        if line.startswith('```'):
            flush()
            if listed:
                parts.append(f'</{listed}>')
                listed = None
            if code is None:
                code = []
            else:
                parts.append('<pre>' + escape('\n'.join(code)) + '</pre>')
                code = None
            continue
        if code is not None:
            code.append(line)
            continue
        numbered = re.match(r'^\d+\. (.*)', line)
        tag = 'ol' if numbered else 'ul' if line.startswith('- ') else None
        item = numbered.group(1) if numbered else line[2:] if tag else None
        if listed and listed != tag:
            parts.append(f'</{listed}>')
            listed = None
        if not line.strip():
            flush()
        elif line.startswith('#') and re.match(r'^#{1,6} ', line):
            flush()
            level = len(line) - len(line.lstrip('#'))
            parts.append(f'<h{level}>' + inline(line[level:].strip()) + f'</h{level}>')
        elif tag:
            flush()
            if not listed:
                parts.append(f'<{tag}>')
                listed = tag
            parts.append('<li>' + inline(item) + '</li>')
        else:
            paragraph.append(line)
    flush()
    if listed:
        parts.append(f'</{listed}>')
    footer = '<p><a href="/privacy.md">Plain-text policy</a></p>' if plain_policy else ''
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title) + '</title><link rel="stylesheet" href="/mcp-setup.css"></head><body><main><a href="/mcp-setup">Epic Stocks · independent and unofficial</a>' + ''.join(parts) + footer + '</main></body></html>'


@router.api_route('/privacy-policy', methods=['GET', 'HEAD'])
def privacy_policy():
    return HTMLResponse(policy_html(policy_text()), headers={'Cache-Control': 'public, max-age=300'})


@router.api_route('/privacy.md', methods=['GET', 'HEAD'])
def privacy_markdown():
    return PlainTextResponse(policy_text(), headers={'Cache-Control': 'public, max-age=300'})


@router.api_route('/terms', methods=['GET', 'HEAD'])
def public_terms():
    root = Path(__file__).resolve().parents[2]
    for path in (root / 'PUBLIC_TERMS.md', root.parent / 'TERMS.md'):
        if path.is_file():
            text = path.read_text(encoding='utf-8')
            return HTMLResponse(policy_html(text, title='Epic Stocks Terms of Use', plain_policy=False),
                                headers={'Cache-Control': 'public, max-age=300'})
    raise HTTPException(503, 'Terms of use are temporarily unavailable')


@router.api_route('/support', methods=['GET', 'HEAD'])
def public_support():
    text = f'''# Epic Stocks support

Epic Stocks is independently operated and is not an official Epic Systems product.

{FINANCIAL_NOTICE}

## Report a problem privately

Sign in to Epic Stocks and use Report a problem. Ordinary reports do not automatically include financial records or documents. You can separately choose to share encrypted diagnostics or original failed-import files for support. Review the consent choices before sending. Authorized administrators can retrieve this explicitly shared material, including through a separately permitted administrator-connected assistant. Access expires after 30 days; scheduled cleanup removes the material.

## Public bug reports

For a general bug or setup question, use [GitHub issue templates](https://github.com/rahulshahepic/epic-stocks/issues/new/choose). Public issues are visible to everyone. Never include private financial records, actual Epic prices, statements, credentials or unredacted screenshots there. A GitHub account is needed to post an issue.

## Connection and account controls

Read [connection instructions](https://epic-stocks.com/mcp-setup). You can disconnect an assistant in Settings → AI connections. Use Settings to export your records or delete your account. Reviewer accounts use a separate fictional identity and are managed by the administrator.

## Privacy

Read the [privacy policy](https://epic-stocks.com/privacy-policy) before sharing support material. Epic Stocks tracks records and estimates; it cannot trade securities or move money.
'''
    return HTMLResponse(policy_html(text, title='Epic Stocks support', plain_policy=False),
                        headers={'Cache-Control': 'public, max-age=300'})
