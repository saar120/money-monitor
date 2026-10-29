import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const patchedAdvisory = 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4';
const requireMobile = createRequire(new URL('../mobile/package.json', import.meta.url));
// This narrow exception is valid only while the installed patch blocks the actual exploit.
const merge = requireMobile('deepmerge');
const payload = JSON.parse(
  '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
);
for (const value of [merge(payload, {}), merge({}, payload), merge(Object.create(null), payload)]) {
  assert.equal(value.polluted, undefined);
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.hasOwn(value, '__proto__'), false);
  assert.equal(Object.hasOwn(value, 'constructor'), false);
}
for (const directory of ['.', 'mobile']) {
  let output;
  try {
    output = execFileSync('npm', ['audit', '--json'], {
      cwd: directory,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    if (error.status !== 1 || !error.stdout) throw error;
    output = error.stdout;
  }
  const audit = JSON.parse(output);
  if (audit.error || !audit.metadata) throw new Error(`Audit unavailable for ${directory}`);
  const advisories = Object.values(audit.vulnerabilities ?? {}).flatMap((finding) =>
    finding.via.filter((via) => typeof via === 'object'),
  );
  const outstanding = advisories.filter(
    (advisory) =>
      !(
        directory === 'mobile' &&
        advisory.name === 'deepmerge' &&
        advisory.url === patchedAdvisory
      ),
  );
  if (outstanding.length || (audit.metadata.vulnerabilities.total > 0 && advisories.length === 0)) {
    console.error(outstanding.map((a) => `${a.name}: ${a.title} ${a.url}`).join('\n'));
    throw new Error(`Unresolved security advisories in ${directory}`);
  }
  console.log(
    `${directory}: no unmitigated advisories${advisories.length ? ' (deepmerge locally patched and verified)' : ''}`,
  );
}
