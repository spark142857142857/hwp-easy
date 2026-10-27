"""Prepare a separate skills-only portal identity from the verified local ZIP.

Existing MCP registrations cannot remove their servers. This adapter changes
only the registration name and invocation hints; all engine and skill resources
remain byte-identical. It never installs, uploads, submits or publishes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def prepare(source: Path, destination: Path) -> dict:
    source = source.resolve()
    original = source.read_bytes()
    sha = lambda data: hashlib.sha256(data).hexdigest()
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)) or len(names) > 64:
            raise ValueError('Invalid package entries')
        for entry in entries:
            name = entry.filename
            if (name.startswith(('/', '\\')) or '\\' in name or ':' in name
                    or any(part in ('', '.', '..') for part in name.split('/'))
                    or (entry.external_attr >> 16) & 0o170000 == 0o120000
                    or entry.file_size > 16 * 1024 * 1024):
                raise ValueError('Unsafe package entry')
        if sum(entry.file_size for entry in entries) > 32 * 1024 * 1024:
            raise ValueError('Package too large')
        content = {name: archive.read(name) for name in names}
    if any(name in content for name in ('mcp.json', '.mcp.json', '.app.json', 'hooks/hooks.json')):
        raise ValueError('Directory package must be skills-only')
    metadata = json.loads(content['plugin.json'])
    manifest = json.loads(content['build-manifest.json'])
    if (metadata['name'] != 'hwp-easy' or manifest['package'] != 'hwp-easy'
            or metadata['version'] != manifest['version']):
        raise ValueError('Expected a verified local HWP Easy package')
    skill = 'skills/edit-local-hwp'
    policy = f'{skill}/agents/openai.yaml'
    if 'allow_implicit_invocation: false' not in content[policy].decode('utf-8'):
        raise ValueError('Explicit-only invocation is required')
    for filename, field in (('local-runner.mjs', 'runner_sha256'), ('rhwp_bg.wasm', 'wasm_sha256')):
        if sha(content[f'{skill}/scripts/{filename}']) != manifest[field]:
            raise ValueError('Shared runtime hash mismatch')

    metadata['name'] = 'hwp-easy-local'
    interface = metadata['extensions']['com.openai']['interface']
    # Directory subtitles are one line, at most 30 characters. Keep Korean
    # first; the bilingual long description still contains the English text.
    interface['shortDescription'] = interface['shortDescription'].split('\n', 1)[0]
    if not interface['shortDescription'] or len(interface['shortDescription']) > 30:
        raise ValueError('Directory subtitle must be between 1 and 30 characters')
    interface['capabilities'] = [text.split('\n', 1)[0] for text in interface.get('capabilities', [])]
    interface['defaultPrompt'] = [text.replace('$hwp-easy:', '$hwp-easy-local:')
                                  for text in interface.get('defaultPrompt', [])]
    manifest['package'] = metadata['name']
    manifest['distribution'] = {'type': 'openai_directory', 'source_package': 'hwp-easy',
                                'source_archive_sha256': sha(original)}
    updated = dict(content)
    updated['plugin.json'] = (json.dumps(metadata, ensure_ascii=False, indent=2) + '\n').encode()
    updated['build-manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    updated[policy] = content[policy].replace(b'$hwp-easy:', b'$hwp-easy-local:')
    changed = ['plugin.json', 'build-manifest.json', policy]
    assert all(updated[name] == content[name] for name in names if name not in changed)
    assert interface['displayName'] == 'HWP Easy'
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / f'hwp-easy-local-{manifest["version"]}.zip'
    if target == source:
        raise ValueError('Source package must remain unchanged')
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in names:
            entry = zipfile.ZipInfo(name, (2026, 10, 13, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, updated[name])
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None and archive.namelist() == names
        assert all(archive.read(name) == updated[name] for name in names)
    assert source.read_bytes() == original
    result = {'archive': str(target), 'sha256': sha(target.read_bytes()),
              'source_archive_sha256': sha(original), 'files': len(names),
              'package': metadata['name'], 'version': manifest['version'],
              'display_name': interface['displayName'], 'changed_files': changed,
              'runner_sha256': manifest['runner_sha256'], 'wasm_sha256': manifest['wasm_sha256'],
              'skill_engine_and_preview_resources_identical': True,
              'explicit_only': True, 'source_unchanged': True, 'submission': 'NOT_RUN'}
    (destination / 'build-report.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.source, args.destination)))
