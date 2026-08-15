import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString, COMMENT_HEADER, type OpenAPI3 } from 'openapi-typescript';
import prettier from 'prettier';
import { CANONICAL_OPENAPI_DOCUMENT } from '../src/api/v1/openapi.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, '..');
const openApiPath = join(projectRoot, 'docs', 'api', 'v1.openapi.json');
const swiftOpenApiPath = join(
  projectRoot,
  'ios',
  'CanonicalAPI',
  'Sources',
  'CanonicalAPI',
  'openapi.json',
);
const typescriptPath = join(projectRoot, 'src', 'api', 'v1', 'generated-client.ts');

function writeOrCheck(path: string, content: string, checkOnly: boolean): boolean {
  if (checkOnly) return existsSync(path) && readFileSync(path, 'utf8') === content;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return true;
}

const checkOnly = process.argv.includes('--check');
const runtimeDocument = JSON.parse(JSON.stringify(CANONICAL_OPENAPI_DOCUMENT)) as OpenAPI3;
const prettierConfig = (await prettier.resolveConfig(openApiPath)) ?? {};
const openApiJson = await prettier.format(JSON.stringify(runtimeDocument), {
  ...prettierConfig,
  filepath: openApiPath,
  parser: 'json',
});
const openApiMatches = writeOrCheck(openApiPath, openApiJson, checkOnly);
const swiftOpenApiMatches = writeOrCheck(swiftOpenApiPath, openApiJson, checkOnly);

// In check mode, generate from the checked-in document so that a stale spec
// cannot be masked by the in-memory runtime document. In write mode, this is
// the freshly serialized runtime document above.
const serializedDocument = (
  checkOnly && existsSync(openApiPath)
    ? JSON.parse(readFileSync(openApiPath, 'utf8'))
    : JSON.parse(openApiJson)
) as OpenAPI3;

const generatedAst = await openapiTS(serializedDocument, {
  alphabetize: true,
  exportType: true,
  makePathsEnum: true,
  silent: true,
});
const generatedTypescript = await prettier.format(
  `${COMMENT_HEADER}/* eslint-disable @typescript-eslint/no-duplicate-enum-values */\n${astToString(generatedAst)}`,
  {
    ...prettierConfig,
    filepath: typescriptPath,
    parser: 'typescript',
  },
);
const typescriptMatches = writeOrCheck(typescriptPath, generatedTypescript, checkOnly);

if (checkOnly && (!openApiMatches || !swiftOpenApiMatches || !typescriptMatches)) {
  console.error(
    'Canonical OpenAPI, Swift OpenAPI input, or TypeScript client is stale. Run npm run canonical:clients:write.',
  );
  process.exitCode = 1;
}
