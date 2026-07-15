import { z } from 'zod';
import {
  bootstrapSuccessEnvelopeSchema,
  bootstrapUpgradeRequiredEnvelopeSchema,
} from './bootstrap-contract.js';

export const MOBILE_BOOTSTRAP_JSON_SCHEMA_RELATIVE_PATH =
  'ios/Fixtures/MobileBootstrap/bootstrap.schema.json' as const;

export const MOBILE_BOOTSTRAP_JSON_SCHEMA_ID =
  'https://money-monitor.local/schemas/mobile-bootstrap-v1.schema.json' as const;

function structuralProjection(schema: z.ZodType): Record<string, unknown> {
  const projection = {
    ...(z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      unrepresentable: 'any',
    }) as Record<string, unknown>),
  };
  delete projection.$schema;
  return projection;
}

/**
 * Produces the portable structural projection of the authoritative Zod
 * contract. Zod refinements remain authoritative for semantic and cross-field
 * invariants that JSON Schema cannot faithfully express.
 */
export function createMobileBootstrapJsonSchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: MOBILE_BOOTSTRAP_JSON_SCHEMA_ID,
    title: 'Money Monitor Mobile Bootstrap Response v1',
    description:
      'Structural JSON Schema projection of the bootstrap success and explicit upgrade-required response envelopes for shared client validation and contract review.',
    $comment:
      'Generated from src/mobile/bootstrap-contract.ts. Do not edit by hand. Calendar validity, ISO 4217 membership, uniqueness, and all cross-field superRefine invariants remain executable Zod contract checks.',
    oneOf: [
      { $ref: '#/$defs/BootstrapSuccessEnvelope' },
      { $ref: '#/$defs/BootstrapUpgradeRequiredEnvelope' },
    ],
    $defs: {
      BootstrapSuccessEnvelope: structuralProjection(bootstrapSuccessEnvelopeSchema),
      BootstrapUpgradeRequiredEnvelope: structuralProjection(
        bootstrapUpgradeRequiredEnvelopeSchema,
      ),
    },
  };
}
