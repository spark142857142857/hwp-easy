// Read-only source/document hygiene checks. This does not scan Git history.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const git = (args, input) => execFileSync('git', args, { cwd: root, input, encoding: 'utf8' });
const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
const trackedSet = new Set(tracked);
const errors = [];
for (const file of tracked) {
  if (/^(?:docs\/local\/|testdocs\/|outputs\/|node_modules\/|dist\/|\.sites-runtime\/|\.work\/)/.test(file)
    || /\.(?:hwp|hwpx|hwpbak|hwpbake|dpapi|pdf|docx|whl|tgz|tar(?:\.gz)?|zip)$/i.test(file)
    || (/(?:^|\/)\.env(?:\.|$)/.test(file) && !/\.example$/.test(file))) {
    errors.push(`Unexpected tracked private/generated file: ${file}`);
  }
}
const ignored = ['docs/local/session.md', 'testdocs/example.hwp', 'outputs/result.hwp',
  'private-backup.hwpbak', 'private-backup.hwpbake',
  'private-recovery-key.dpapi',
  '.env', '.env.local', 'release.tgz', 'release.tar.gz', '.sites-runtime/session.json', '.work/research.txt'];
const found = git(['check-ignore', '--stdin'], ignored.join('\n') + '\n').trim().split(/\r?\n/);
for (const file of ignored) if (!found.includes(file)) errors.push(`Missing ignore rule: ${file}`);
// Example configuration is safe source documentation, not a secret file.
const checkExample = execFileSync('git', ['check-ignore', '--stdin', '--non-matching', '--verbose'],
  { cwd: root, input: '.env.example\n', encoding: 'utf8' });
if (!/!\.env\.example\t\.env\.example/.test(checkExample)) errors.push('Environment example must remain trackable');

const markdown = tracked.filter((file) => file.endsWith('.md'));
const contents = new Map(markdown.map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
function anchors(text) {
  const counts = new Map(); const ids = new Set(); let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const id = heading[1].toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');
    const count = counts.get(id) ?? 0; counts.set(id, count + 1);
    ids.add(count ? `${id}-${count}` : id);
  }
  return ids;
}
let links = 0;
for (const [file, text] of contents) {
  if (/(?:appgprj_|appgver_|appgdep_|oaiapp_|plugin_asdk_app_sites_)\w+/.test(text)) {
    errors.push(`Personal deployment identifiers belong in docs/local/: ${file}`);
  }
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split(/\s+"/)[0];
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    const [relative, fragment] = target.split('#');
    const resolved = path.resolve(path.dirname(path.join(root, file)), decodeURIComponent(relative || path.basename(file)));
    const key = path.relative(root, resolved).split(path.sep).join('/');
    links++;
    if (key.startsWith('../') || !trackedSet.has(key)) errors.push(`Local link is not tracked: ${file} -> ${target}`);
    else if (fragment && contents.has(key) && !anchors(contents.get(key)).has(decodeURIComponent(fragment))) {
      errors.push(`Missing Markdown heading: ${file} -> ${target}`);
    }
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Repository hygiene passed: ${tracked.length} tracked files, ${markdown.length} Markdown files, ${links} local links; no Git history audit.`);
