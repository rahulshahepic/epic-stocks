#!/usr/bin/env python3
"""Read public directory prerequisites without credentials or financial data."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import urllib.error
import urllib.request

PATHS = ('/api/health', '/.well-known/oauth-protected-resource/mcp',
         '/.well-known/oauth-authorization-server', '/mcp/setup.json', '/mcp-setup',
         '/support', '/privacy', '/privacy-policy', '/privacy.md', '/llms.txt', '/robots.txt', '/reviewer-login', '/reviewer-login.css', '/terms', '/mcp')
PUBLIC_JSON = ('/api/health', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server', '/mcp/setup.json')


def probe(origin, path, method='GET'):
    data = b'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"publication-audit","version":"1"}}}' if method == 'POST' else None
    req = urllib.request.Request(origin + path, data=data, method=method,
        headers={'User-Agent': 'EpicStocksPublicationAudit/1.0', 'Content-Type': 'application/json', 'Accept': 'application/json, text/html'})
    try:
        response = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as exc:
        response = exc
    except OSError as exc:
        return {'url': req.full_url, 'method': method, 'error': str(exc)}
    with response:
        headers = {k.lower(): v for k, v in response.headers.items()}
        raw = response.read(1024 * 1024)
        item = {'url': req.full_url, 'method': method, 'status': response.code,
                'content_type': headers.get('content-type'), 'www_authenticate': headers.get('www-authenticate')}
        if path in PUBLIC_JSON:
            try:
                item['public_response'] = json.loads(raw)
            except ValueError:
                item['response_kind'] = 'non-JSON'
        if path in ('/privacy-policy', '/privacy.md'):
            item['policy_text_present'] = b'Epic Stocks' in raw and b'Data Retention' in raw
            item['spa_shell'] = b'<div id="root"></div>' in raw
        if path == '/support':
            item['support_text_present'] = b'Report a problem privately' in raw
        if path == '/terms':
            item['terms_text_present'] = (b'<h1>Epic Stocks Terms of Use</h1>' in raw
                                          and b'<h2>Connecting an AI assistant</h2>' in raw)
            item['spa_shell'] = b'<div id="root"></div>' in raw
        if path == '/reviewer-login':
            item['reviewer_form_present'] = b'name="password"' in raw
        return item


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origins', nargs='+', default=['https://epic-stocks.com', 'https://staging.epic-stocks.com'])
    parser.add_argument('--output', type=Path, default=Path('submissions/shared/evidence/public-probes.json'))
    args = parser.parse_args()
    results = [probe(origin.rstrip('/'), path) for origin in args.origins for path in PATHS]
    results += [probe(origin.rstrip('/'), '/mcp', 'POST') for origin in args.origins]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({'checked_at': datetime.now(timezone.utc).isoformat(),
        'method': 'Public GET requests and unauthenticated MCP initialize POST only; no credentials or financial data', 'results': results}, indent=2) + '\n')
    for row in results:
        print(row['method'], row['url'], row.get('status', row.get('error')))


if __name__ == '__main__':
    main()
