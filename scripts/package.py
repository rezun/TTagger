#!/usr/bin/env python3

"""Create ZIP archives for Chrome and/or Firefox from the extension source."""

from __future__ import annotations

import argparse
import json
import os
import sys
import zipfile
from collections.abc import Iterator
from typing import Any

REPO_ROOT: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR: str = os.path.join(REPO_ROOT, 'dist')
MANIFEST_FILE: str = os.path.join(REPO_ROOT, 'manifest.json')

INCLUDE_PATHS: list[str] = [
    '_locales',
    'app',
    'assets',
    'background',
    'content',
    'options',
    'popup',
    'src',
    'styles',
]

DOC_PATHS: list[str] = [
    'README.md',
    'PRIVACY.md',
    'DATA_SAFETY.md',
]

SKIP_NAMES: set[str] = {'.DS_Store', '__MACOSX'}


def load_manifest() -> dict[str, Any]:
    with open(MANIFEST_FILE, encoding='utf-8') as f:
        return json.load(f)


def transform_manifest(manifest: dict[str, Any], browser: str) -> dict[str, Any]:
    """Return a browser-specific copy of the manifest."""
    m: dict[str, Any] = json.loads(json.dumps(manifest))  # deep copy

    if browser == 'chrome':
        m.get('background', {}).pop('scripts', None)
        m.pop('browser_specific_settings', None)

    elif browser == 'firefox':
        m.get('background', {}).pop('service_worker', None)
        m.pop('oauth2', None)
        author: Any = m.get('author')
        if isinstance(author, dict):
            m['author'] = author.get('name', '')

    return m


def collect_files(include_docs: bool) -> Iterator[tuple[str, str]]:
    """Yield (archive_path, absolute_path) pairs for all files to include."""
    for path in INCLUDE_PATHS:
        full: str = os.path.join(REPO_ROOT, path)
        if not os.path.exists(full):
            print(f'Warning: expected path {path!r} not found; skipping.', file=sys.stderr)
            continue
        if os.path.isfile(full):
            yield path, full
        else:
            for root, dirs, files in os.walk(full):
                dirs[:] = [d for d in dirs if d not in SKIP_NAMES]
                for name in files:
                    if name in SKIP_NAMES:
                        continue
                    abs_path: str = os.path.join(root, name)
                    rel_path: str = os.path.relpath(abs_path, REPO_ROOT)
                    yield rel_path, abs_path

    if include_docs:
        for doc in DOC_PATHS:
            full = os.path.join(REPO_ROOT, doc)
            if os.path.isfile(full):
                yield doc, full
            else:
                print(f'Warning: requested doc {doc!r} not found; skipping.', file=sys.stderr)


def build_package(
    manifest: dict[str, Any],
    browser: str,
    version: str,
    base_name: str,
    include_docs: bool,
) -> None:
    archive_name: str = f'{base_name}-v{version}-{browser}.zip'
    output_path: str = os.path.join(DIST_DIR, archive_name)

    os.makedirs(DIST_DIR, exist_ok=True)

    browser_manifest: dict[str, Any] = transform_manifest(manifest, browser)

    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        manifest_json: str = json.dumps(browser_manifest, indent=2, ensure_ascii=False) + '\n'
        zf.writestr('manifest.json', manifest_json)

        for rel_path, abs_path in collect_files(include_docs):
            zf.write(abs_path, rel_path)

    print(f'Created archive: {output_path}')


def main() -> None:
    parser: argparse.ArgumentParser = argparse.ArgumentParser(
        description='Create ZIP archives for Chrome and/or Firefox.',
    )
    parser.add_argument('--name', default='ttagger', help='Archive base name (default: ttagger)')
    parser.add_argument('--version', default=None, help='Override manifest version')
    parser.add_argument('--include-docs', action='store_true', help='Include README, PRIVACY, DATA_SAFETY')
    parser.add_argument('--target', choices=['chrome', 'firefox', 'all'], default='all',
                        help='Build target (default: all)')
    args: argparse.Namespace = parser.parse_args()

    if not os.path.isfile(MANIFEST_FILE):
        print(f'Cannot find manifest.json at {MANIFEST_FILE}', file=sys.stderr)
        sys.exit(1)

    manifest: dict[str, Any] = load_manifest()
    version: str | None = args.version or manifest.get('version')

    if not version:
        print('Unable to determine extension version; use --version to supply it manually.', file=sys.stderr)
        sys.exit(1)

    targets: list[str] = ['chrome', 'firefox'] if args.target == 'all' else [args.target]

    for browser in targets:
        build_package(manifest, browser, version, args.name, args.include_docs)


if __name__ == '__main__':
    main()
