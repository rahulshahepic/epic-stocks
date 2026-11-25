"""Server-readable privacy text for directory review without a JavaScript app."""
from html import escape
from pathlib import Path
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse

router = APIRouter(tags=['Public documentation'])


def policy_text():
    root = Path(__file__).resolve().parents[2]
    for path in (root / 'PUBLIC_PRIVACY.md', root.parent / 'PRIVACY.md'):
        if path.is_file():
            return path.read_text(encoding='utf-8')
    raise HTTPException(503, 'Privacy documentation is temporarily unavailable')


def inline(text):
    value = escape(text)
    value = re.sub(r'\[([^\]]+)\]\((https://[^\s)]+)\)', r'<a href="\2">\1</a>', value)
    return re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', value)


def policy_html(text):
    # Render only trusted-repository headings, paragraphs, lists and code. Raw
    # HTML is escaped; no document uploads or caller-selected paths are read.
    parts, paragraph, listed, code = [], [], False, None
    def flush():
        if paragraph:
            parts.append('<p>' + inline(' '.join(paragraph)) + '</p>')
            paragraph.clear()
    for line in text.splitlines():
        if line.startswith('```'):
            flush()
            if code is None:
                code = []
            else:
                parts.append('<pre>' + escape('\n'.join(code)) + '</pre>')
                code = None
            continue
        if code is not None:
            code.append(line)
            continue
        item = line.startswith('- ')
        if listed and not item:
            parts.append('</ul>')
            listed = False
        if not line.strip():
            flush()
        elif line.startswith('#') and re.match(r'^#{1,6} ', line):
            flush()
            level = len(line) - len(line.lstrip('#'))
            parts.append(f'<h{level}>' + inline(line[level:].strip()) + f'</h{level}>')
        elif item:
            flush()
            if not listed:
                parts.append('<ul>')
                listed = True
            parts.append('<li>' + inline(line[2:]) + '</li>')
        else:
            paragraph.append(line)
    flush()
    if listed:
        parts.append('</ul>')
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Epic Stocks privacy policy</title><link rel="stylesheet" href="/mcp-setup.css"></head><body><main><a href="/mcp-setup">Epic Stocks · independent and unofficial</a>' + ''.join(parts) + '<p><a href="/privacy.md">Plain-text policy</a></p></main></body></html>'


@router.api_route('/privacy-policy', methods=['GET', 'HEAD'])
def privacy_policy():
    return HTMLResponse(policy_html(policy_text()), headers={'Cache-Control': 'public, max-age=300'})


@router.api_route('/privacy.md', methods=['GET', 'HEAD'])
def privacy_markdown():
    return PlainTextResponse(policy_text(), headers={'Cache-Control': 'public, max-age=300'})
