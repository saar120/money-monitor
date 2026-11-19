import { execFileSync } from 'node:child_process';

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
  if (advisories.length || audit.metadata.vulnerabilities.total > 0) {
    console.error(advisories.map((a) => `${a.name}: ${a.title} ${a.url}`).join('\n'));
    throw new Error(`Unresolved security advisories in ${directory}`);
  }
  console.log(`${directory}: no advisories`);
}
