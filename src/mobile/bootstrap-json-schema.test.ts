import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';
import {
  createMobileBootstrapJsonSchema,
  MOBILE_BOOTSTRAP_JSON_SCHEMA_ID,
  MOBILE_BOOTSTRAP_JSON_SCHEMA_RELATIVE_PATH,
} from './bootstrap-json-schema.js';

describe('mobile bootstrap JSON Schema artifact', () => {
  it('matches the deterministic projection of both executable Zod envelopes', async () => {
    const artifactPath = join(process.cwd(), MOBILE_BOOTSTRAP_JSON_SCHEMA_RELATIVE_PATH);
    const artifact = readFileSync(artifactPath, 'utf8');
    const prettierConfig = (await resolveConfig(artifactPath)) ?? {};
    const expected = await format(JSON.stringify(createMobileBootstrapJsonSchema()), {
      ...prettierConfig,
      parser: 'json',
      filepath: artifactPath,
    });

    expect(artifact).toBe(expected);
  });

  it('retains the portable structural constraints clients need', () => {
    const schema = createMobileBootstrapJsonSchema();

    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: MOBILE_BOOTSTRAP_JSON_SCHEMA_ID,
      oneOf: [
        { $ref: '#/$defs/BootstrapSuccessEnvelope' },
        { $ref: '#/$defs/BootstrapUpgradeRequiredEnvelope' },
      ],
      $defs: {
        BootstrapSuccessEnvelope: {
          type: 'object',
          required: ['data', 'meta'],
          additionalProperties: false,
          properties: {
            data: {
              required: [
                'home',
                'budgetPulse',
                'review',
                'recentTransactions',
                'accounts',
                'latestSync',
              ],
              properties: {
                recentTransactions: { type: 'array', maxItems: 20 },
              },
            },
            meta: {
              properties: {
                apiVersion: { const: '1' },
                bootstrapSchemaVersion: { const: 1 },
                source: { const: 'live' },
              },
            },
          },
        },
        BootstrapUpgradeRequiredEnvelope: {
          required: ['error', 'meta'],
          properties: {
            error: {
              properties: {
                code: { const: 'upgrade_required' },
                message: {
                  const: 'Update Money Monitor on this iPhone and Mac to continue.',
                },
              },
            },
          },
        },
      },
    });
    expect(JSON.stringify(schema)).toContain('^\\\\d{4}-\\\\d{2}-\\\\d{2}$');
    expect(JSON.stringify(schema)).toContain('cross-field superRefine invariants');
  });
});
