"""Archive the allowlisted standalone client skill packages; does not install."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1] / 'outputs/agent-packages'
for client in ('claude-code', 'cursor'):
    directory = root / client / 'hwp-easy'
    manifest = json.loads((directory / 'build-manifest.json').read_text(encoding='utf-8'))
    assert manifest['distribution']['client'] == client
    names = sorted([*manifest['files'], 'build-manifest.json'])
    assert sorted(p.relative_to(directory).as_posix() for p in directory.rglob('*') if p.is_file()) == names
    for name, expected in manifest['files'].items():
        assert not (directory / name).is_symlink()
        assert hashlib.sha256((directory / name).read_bytes()).hexdigest() == expected
    archive_path = root / f"hwp-easy-{client}-{manifest['version']}.zip"
    with zipfile.ZipFile(archive_path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in names:
            archive.writestr(f'hwp-easy/{name}', (directory / name).read_bytes())
    with zipfile.ZipFile(archive_path) as archive:
        assert archive.testzip() is None
        assert all(archive.read(f'hwp-easy/{name}') == (directory / name).read_bytes() for name in names)
    print(json.dumps({'client': client, 'archive': str(archive_path), 'files': len(names),
                      'sha256': hashlib.sha256(archive_path.read_bytes()).hexdigest(), 'installation': 'NOT_RUN'}))
