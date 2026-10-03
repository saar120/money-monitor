import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md'],
  { cwd: root, encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter((file) => file && existsSync(resolve(root, file)));
const scripts = (directory) =>
  JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8')).scripts;
const packages = { '.': scripts('.'), mobile: scripts('mobile'), dashboard: scripts('dashboard') };
const errors = [];
for (const file of docs) {
  const source = readFileSync(resolve(root, file), 'utf8');
  for (const [, target] of source.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    if (/^[a-z]+:|^#/.test(target)) continue;
    if (!existsSync(resolve(root, dirname(file), target.split('#')[0])))
      errors.push(`${file}: missing link ${target}`);
  }
  for (const [, prefix, name] of source.matchAll(
    /npm(?: --prefix (mobile|dashboard))? run ([\w:-]+)/g,
  )) {
    const directory = prefix ?? (file === 'mobile/README.md' ? 'mobile' : '.');
    if (!packages[directory][name]) errors.push(`${file}: missing ${directory} script ${name}`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Documentation links and npm script references are current.');
}
