#!/usr/bin/env python3
"""Build deterministic credential-free directory packages from explicit public sources."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'submissions/dist'
ASSETS = {
    'icon.svg': ('plugins/epic-stocks/assets/icon.svg', 'Existing brand icon; primary listing/composer icon, both themes', 'brand'),
    'icon-512.png': ('frontend/public/icon-512.png', 'Existing 512px raster brand icon for portals preferring PNG', 'brand'),
    'equity-desktop.png': ('screenshots/directory-equity-light-desktop.png', 'Actual website equity, established fictional reviewer', 'website'),
    'loans-desktop.png': ('screenshots/directory-loans-light-desktop.png', 'Actual website loan balances, established fictional reviewer', 'website'),
    'equity-mobile.png': ('screenshots/directory-equity-light-mobile.png', 'Actual mobile website equity, fictional reviewer', 'website'),
    'retirement-desktop.png': ('screenshots/demo-retirement-light-desktop.png', 'Actual website retirement using existing fictional demo profile', 'website'),
    'equity-widget-local.png': ('screenshots/chatgpt-plugin-light-desktop.png', 'Local simulated host equity widget; NOT actual ChatGPT or Claude', 'local-simulation'),
    'retirement-widget-local.png': ('screenshots/mcp-apps-retirement-light-desktop.png', 'Local simulated host retirement widget; NOT actual ChatGPT or Claude', 'local-simulation'),
}
SAMPLES = ('test_data/epic_share_summary.csv', 'test_data/epic_loan_statement.txt', 'test_data/epic_loan_statement.pdf', 'test_data/fixture.xlsx')


def public_files(folder):
    files = {}
    for p in sorted(folder.rglob('*')):
        if not p.is_file():
            continue
        if p.is_symlink() or (p.suffix not in ('.json', '.md', '.svg') and p.name != 'LICENSE'):
            raise ValueError(f'Unexpected package source: {p.relative_to(ROOT)}')
        files[p.relative_to(folder).as_posix()] = p.read_bytes()
    return files


def image_info(raw, name):
    if name.endswith('.png'):
        if raw[:8] != b'\x89PNG\r\n\x1a\n':
            raise ValueError(f'Invalid PNG {name}')
        width, height = struct.unpack('>II', raw[16:24])
    else:
        from xml.etree import ElementTree
        element = ElementTree.fromstring(raw)
        box = element.attrib['viewBox'].split()
        width, height = int(float(box[2])), int(float(box[3]))
    return width, height


def validate():
    package = ROOT / 'submissions/chatgpt/plugin'
    m = json.loads((package / 'plugin.json').read_text())
    ext = m['extensions']['com.openai']
    ui = ext['interface']
    assert 0 < len(ui['displayName']) <= 30
    assert 0 < len(ui['developerName']) <= 80
    assert ui['category']
    assert m['author']['name'] and m['version'] and m['homepage'] and m['license']
    for key in ('websiteURL', 'supportURL', 'privacyPolicyURL'):
        assert ui[key].startswith('https://')
    for key in ('logo', 'composerIcon', 'logoDark', 'composerIconDark'):
        icon = package / ui[key]
        width, height = image_info(icon.read_bytes(), icon.name)
        assert width == height and width >= 48 and icon.stat().st_size <= 5 * 1024 * 1024
    assert ext['publication']['release_notes']
    assert len(ui['shortDescription']) <= 30
    assert len(ui['longDescription']) <= 4000
    assert len(ui['defaultPrompt']) <= 3
    assert all(len(p) <= 128 for p in ui['defaultPrompt'])
    assert len(ext['review']['test_cases']['positive']) == 5
    assert len(ext['review']['test_cases']['negative']) == 3
    assert not {'test_credentials', 'reviewer_instructions'} & ext['review'].keys()
    assert (package / ext['onboardingSkill']).is_file()
    server = json.loads((package / 'mcp.json').read_text())['mcpServers']['epic-stocks']
    assert server['url'] == 'https://epic-stocks.com/mcp'
    assert not server.get('headers')
    claude = ROOT / 'submissions/claude/plugin'
    claude_manifest = json.loads((claude / '.claude-plugin/plugin.json').read_text())
    assert claude_manifest['name'] == 'epic-stocks'
    for key in ('displayName', 'version', 'description', 'homepage', 'supportUrl', 'privacyPolicyUrl',
                'repository', 'license', 'keywords'):
        assert claude_manifest[key]
    assert claude_manifest['author']['name']
    assert (claude / 'README.md').is_file()
    assert json.loads((claude / '.mcp.json').read_text())['mcpServers']['epic-stocks']['url'] == server['url']
    assert (claude / 'LICENSE').read_bytes() == (ROOT / 'LICENSE').read_bytes()
    assert (claude / 'skills/get-started/SKILL.md').read_bytes() == (package / 'skills/get-started/SKILL.md').read_bytes()
    print('Package structure, listing limits, review cases and shared URLs validated.')
    print('Publication gates remain: terms URL, verified identity/contact, actual-host testing/video/carousel and authenticated portal validation.')


def write_zip(name, files):
    with zipfile.ZipFile(OUT / name, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path, content in sorted(files.items()):
            if any(part in ('.env', '.secrets', '__pycache__') for part in Path(path).parts):
                raise ValueError('Private path in package')
            info = zipfile.ZipInfo(path, (2026, 11, 25, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, content)
    print(f'{name}: {(OUT / name).stat().st_size:,} bytes')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate sources without building archives')
    args = parser.parse_args()
    validate()
    if args.check:
        return
    OUT.mkdir(parents=True, exist_ok=True)
    assets, manifest = {}, []
    for name, (source, purpose, kind) in ASSETS.items():
        raw = (ROOT / source).read_bytes()
        width, height = image_info(raw, name)
        if kind == 'brand':
            assert width == height and width >= 48 and len(raw) <= 5 * 1024 * 1024
        assets['assets/' + name] = raw
        manifest.append({'file': 'assets/' + name, 'source': source, 'purpose': purpose, 'evidence_kind': kind,
                         'width': width, 'height': height, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                         'actual_host_capture': False})
    # This is a real website recording, never a rendered ChatGPT/Claude session.
    video_source = 'frontend/public/review/epic-stocks-website-demo.webm'
    video = (ROOT / video_source).read_bytes()
    assert video[:4] == bytes.fromhex('1a45dfa3')
    assets['assets/website-demo.webm'] = video
    manifest.append({'file': 'assets/website-demo.webm', 'source': video_source,
        'purpose': 'Supplemental fictional website walkthrough; equity, sale what-if, timeline, retirement',
        'evidence_kind': 'website-video', 'width': 1280, 'height': 800,
        'bytes': len(video), 'sha256': hashlib.sha256(video).hexdigest(), 'actual_host_capture': False})
    assets['assets/manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    (OUT / 'asset-manifest.json').write_bytes(assets['assets/manifest.json'])
    (ROOT / 'submissions/shared/asset-manifest.json').write_bytes(assets['assets/manifest.json'])
    for platform in ('chatgpt', 'claude'):
        package_files = public_files(ROOT / f'submissions/{platform}/plugin')
        write_zip(f'{platform}-plugin.zip', package_files)
        materials = {'platform/' + name: raw for name, raw in public_files(ROOT / f'submissions/{platform}').items()}
        materials.update({'shared/' + name: raw for name, raw in public_files(ROOT / 'submissions/shared').items()})
        materials.update(assets)
        materials.update({'samples/' + Path(p).name: (ROOT / p).read_bytes() for p in SAMPLES})
        write_zip(f'{platform}-submission-materials.zip', materials)
    print('Archives contain public source, fictional samples and allowlisted assets only. Never add reviewer credentials.')


if __name__ == '__main__':
    main()
