import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  createMobileBootstrapJsonSchema,
  MOBILE_BOOTSTRAP_JSON_SCHEMA_RELATIVE_PATH,
} from '../src/mobile/bootstrap-json-schema.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactPath = resolve(repositoryRoot, MOBILE_BOOTSTRAP_JSON_SCHEMA_RELATIVE_PATH);
const prettierConfig = (await resolveConfig(artifactPath)) ?? {};
const expected = await format(JSON.stringify(createMobileBootstrapJsonSchema()), {
  ...prettierConfig,
  parser: 'json',
  filepath: artifactPath,
});
const mode = process.argv[2];

if (mode === '--write') {
  writeFileSync(artifactPath, expected, 'utf8');
  console.log(`Wrote ${MOBILE_BOOTSTRAP_JSON_SCHEMA_RELATIVE_PATH}`);
} else if (mode === '--check') {
  const actual = readFileSync(artifactPath, 'utf8');
  if (actual !== expected) {
    console.error(
      `${MOBILE_BOOTSTRAP_JSON_SCHEMA_RELATIVE_PATH} is out of date. Run npm run mobile:bootstrap-schema:generate.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`${MOBILE_BOOTSTRAP_JSON_SCHEMA_RELATIVE_PATH} matches the executable contract.`);
  }
} else {
  console.error('Expected --write or --check.');
  process.exitCode = 2;
}
