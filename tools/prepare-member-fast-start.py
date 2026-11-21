#!/usr/bin/env python3
"""Assemble the deployed FTI panel's fast-start HTML and immutable assets."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from zipfile import ZipFile


ORIGIN = 'https://ftiprotocol.com'
PREVIOUS_SHA256 = '1a3a7ccd596ee4e943e83d4512f4bc4e548240ba74cb0832f3e6e75997c1d182'
PREVIOUS = '/fti-member-workspace-8496854ae42c1967d222/'
BASE = '/fti-mainnet-ui-eead15d141fbbc07/'
REFERRAL = '/fti-referral-c6abd61ddf79782e795c2484/referral-context.js'
OFFICIAL = '/fti-official-channel-626c532ec31a4fd0280d9208/official-channel.js'
ASSETS = '/{BOOT_ASSETS}/'
STYLES = [BASE+'style.css', BASE+'member-landing-theme.css', PREVIOUS+'global-interface.css',
          BASE+'panel-identity.css', PREVIOUS+'member-reserve-panel.css', PREVIOUS+'app.css']
PUBLIC_HASHES = {
    STYLES[0]: '373a39681dd415c339a117034c7d5d5d9fc976b28730b1967e25dd4afb117190',
    STYLES[1]: '4a66ac54bbbd1282c61536ec6889f07047bdaeda1a54b6b431910da9b31d0198',
    STYLES[3]: '754e5c9c549a372ca106b23915c51ddc34bcb914373a5876ccc0675ec579274f',
}
FILES = ['app.js', 'vendor/ethers.js', 'vendor/walletconnect.js', 'app.js.LEGAL.txt',
         'vendor/walletconnect.js.LEGAL.txt']

ENTRY = """// Fetch both independent prerequisites before mounting the member workspace.
function workspaceStyle() {
  const link = document.querySelector('link[data-fti-workspace-style]');
  if (!link) throw Error('Missing workspace stylesheet');
  if (link.sheet) {
    link.media = 'all';
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    // Observe a fresh element so even an error before this module ran is recoverable.
    // Its URL matches the preload and reuses the browser's in-flight request.
    const observed = link.cloneNode(false);
    observed.addEventListener('load', () => {
      observed.media = 'all';
      resolve();
    }, {once:true});
    observed.addEventListener('error', () => reject(Error('Workspace stylesheet unavailable')), {once:true});
    link.replaceWith(observed);
  });
}
function startupFailed() {
  const entry = document.querySelector('script[data-fti-app-entry]');
  if (entry) entry.setAttribute('data-fti-boot-failed', '');
  window.dispatchEvent(new Event('fti:boot-error'));
}
Promise.all([Promise.resolve().then(workspaceStyle), import('REFERRAL_URL')])
  .then(([, referral]) => {
    referral.installReferralContext(window);
    return import('./app.js');
  })
  .catch(startupFailed);
""".replace('REFERRAL_URL', REFERRAL)


def require(condition, msg):
    if not condition:
        raise ValueError(msg)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fetch_style(path):
    with urlopen(Request(ORIGIN+path, headers={'Accept-Encoding': 'identity'}), timeout=30) as res:
        content = res.read(512 * 1024)
    require(sha(content) == PUBLIC_HASHES[path], 'Unexpected public stylesheet '+path)
    return path, content


def rebase_css(source_path, data):
    css = data.decode('utf-8')
    # All six pinned stylesheets are already bundled. CSS imports later than the
    # first ruleset would be ignored by browsers if a source ever changes.
    require(not re.search(r'@import\b', css, re.I), 'Unbundled import in '+source_path)

    def absolute(match):
        target = match.group(2)
        if target.startswith(('#', '/', 'data:')) or re.match(r'[A-Za-z][A-Za-z0-9+.-]*:', target):
            return match.group(0)
        return 'url("' + urljoin(source_path, target) + '")'

    return re.sub(r'''url\(\s*(["']?)([^()'"\s]+)\1\s*\)''', absolute, css, flags=re.I)


def substitute_once(text, old, new):
    require(text.count(old) == 1, 'Unexpected HTML template: '+old)
    return text.replace(old, new)


def prepare_html(index, previous):
    start = '<!-- FTI_WORKSPACE_STYLE_START -->'
    end = '<!-- FTI_WORKSPACE_STYLE_END -->'
    require(index.count(start) == index.count(end) == 1, 'Missing stylesheet markers')
    prefix, remainder = index.split(start)
    links, suffix = remainder.split(end)
    old_links = re.findall(r'<link rel="stylesheet" href="([^"]+)">', previous)
    expected = ['./'+p.rsplit('/',1)[-1] for p in STYLES]
    require(old_links == STYLES and re.findall(r'<link rel="stylesheet" href="([^"]+)">', links) == expected,
            'Unexpected stylesheet list or cascade order')
    style = ASSETS+'workspace.css'
    result = prefix + '<link rel="preload" as="style" href="'+style+'">' + (
        '<link rel="stylesheet" media="print" data-fti-workspace-style href="'+style+'">') + suffix
    for key in ('app.js','vendor/ethers.js'):
        old = '<link rel="modulepreload" href="./'+key+'">'
        result = substitute_once(result, old, old.replace('./', ASSETS))
    result = substitute_once(result, '<script defer src="./boot-guard.js" data-fti-boot-guard>',
                             '<script defer src="'+ASSETS+'boot-guard.js" data-fti-boot-guard>')
    result = substitute_once(result, '<script type="module" src="./app.js" data-fti-app-entry>',
                             '<script type="module" src="'+ASSETS+'entry.js" data-fti-app-entry>')
    official = '<script type="module" src="'+OFFICIAL+'"></script>'
    require(previous.count(official) == 1, 'Missing official channel in installed baseline')
    result = substitute_once(result, '<link rel="stylesheet" href="./customer-widget.css" data-fti-customer-style>', '')
    result = substitute_once(result, '<script type="module" src="./customer-widget.js" data-fti-customer-entry></script>', official)
    return substitute_once(result, '</head>', '<link rel="modulepreload" href="'+REFERRAL+'"></head>')


def prepare(previous, index, guard, destination):
    require(sha(previous.read_bytes()) == PREVIOUS_SHA256, 'Previous production package checksum mismatch')
    with ZipFile(previous) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        require('/'+manifest['name']+'/' == PREVIOUS, 'Previous asset directory mismatch')

        def archived(key):
            data = archive.read('static/'+key)
            require(sha(data) == manifest['assets'][key], 'Invalid archived '+key)
            return data

        html = prepare_html(index.read_text(), archive.read('new.html').decode())
        assets = {key: archived(key) for key in FILES}
        with ThreadPoolExecutor(max_workers=len(PUBLIC_HASHES)) as pool:
            public = dict(pool.map(fetch_style, PUBLIC_HASHES))
        styles = []
        for path in STYLES:
            data = public[path] if path in public else archived(path.removeprefix(PREVIOUS))
            styles.append(rebase_css(path, data))
        assets['workspace.css'] = ('\n'.join(styles)+'\n').encode()
    assets['entry.js'] = ENTRY.encode()
    assets['boot-guard.js'] = guard.read_bytes()
    require(assets['boot-guard.js'], 'Empty boot guard')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as work:
        stage = Path(work)/'stage'
        stage.mkdir()
        for name, data in assets.items():
            target = stage/'assets'/name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        (stage/'new.html').write_text(html)
        os.replace(stage, destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('previous','index','guard','destination'):
        parser.add_argument('--'+key, type=Path, required=True)
    args = parser.parse_args()
    prepare(args.previous, args.index, args.guard, args.destination)


if __name__ == '__main__':
    main()
