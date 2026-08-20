import { z } from 'zod';
import {
  canonicalErrorEnvelopeSchema,
  canonicalMetaSchema,
  diagnosticsResponseSchema,
  homeOverviewDataSchema,
  homeOverviewResponseSchema,
  moneySchema,
  pairingStatusResponseSchema,
  referenceCommandRequestSchema,
  referenceCommandResponseSchema,
  referenceDeleteQuerySchema,
  referenceDeleteResponseSchema,
  referenceReadQuerySchema,
  referenceResponseSchema,
  referenceResourceSchema,
  referenceUpdateRequestSchema,
} from './contract.js';
import { CANONICAL_ROUTE_DEFINITIONS } from './policy.js';

export interface CanonicalOpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
}

function normalizeNullableSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeNullableSchema);
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const normalizedEntries = Object.fromEntries(
    Object.entries(record).map(([key, child]) => [key, normalizeNullableSchema(child)]),
  );
  const anyOf = normalizedEntries.anyOf;
  if (Array.isArray(anyOf) && anyOf.length === 2) {
    const nullable = anyOf.find(
      (candidate) =>
        candidate && typeof candidate === 'object' && (candidate as Record<string, unknown>).type === 'null',
    );
    const valueSchema = anyOf.find(
      (candidate) =>
        candidate && typeof candidate === 'object' && (candidate as Record<string, unknown>).type !== 'null',
    );
    if (nullable && valueSchema && typeof valueSchema === 'object') {
      const schema = { ...(valueSchema as Record<string, unknown>) };
      const type = schema.type;
      if (typeof type === 'string') schema.type = [type, 'null'];
      return schema;
    }
  }
  return normalizedEntries;
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return normalizeNullableSchema(z.toJSONSchema(schema)) as Record<string, unknown>;
}

function response(ref: string, description = 'Successful response') {
  return {
    description,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } },
  };
}

function errorResponse() {
  return response('CanonicalErrorEnvelope', 'Stable coded error');
}

function definitionFor(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string) {
  const definition = CANONICAL_ROUTE_DEFINITIONS.find(
    (candidate) => candidate.method === method && candidate.path === path,
  );
  if (!definition) throw new Error(`Canonical route is missing from registry: ${method} ${path}`);
  return definition;
}

function secured(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string) {
  const definition = definitionFor(method, path);
  return {
    operationId: definition.operationId,
    security: [{ bearerAuth: [] }],
    'x-route-policy': definition.policy,
  };
}

/** Generated from the runtime schemas rather than maintained as a second DTO. */
export function createCanonicalOpenApiDocument(): CanonicalOpenApiDocument {
  const paths: CanonicalOpenApiDocument['paths'] = {
    '/api/v1/home': {
      get: {
        ...secured('GET', '/api/v1/home'),
        summary: 'Read the Mac-calculated Home overview projection',
        responses: { '200': response('HomeOverviewResponse'), '4XX': errorResponse() },
      },
    },
    '/api/v1/reference': {
      get: {
        ...secured('GET', '/api/v1/reference'),
        summary: 'Read the canonical foundation resource',
        parameters: [
          { name: 'id', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } },
        ],
        responses: { '200': response('ReferenceResponse'), '4XX': errorResponse() },
      },
    },
    '/api/v1/reference/{id}': {
      patch: {
        ...secured('PATCH', '/api/v1/reference/:id'),
        summary: 'Update the canonical foundation resource',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ReferenceUpdateRequest' } },
          },
        },
        responses: { '200': response('ReferenceResponse'), '4XX': errorResponse() },
      },
      delete: {
        ...secured('DELETE', '/api/v1/reference/:id'),
        summary: 'Delete the canonical foundation resource',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'expectedVersion', in: 'query', required: true, schema: { type: 'integer' } },
        ],
        responses: { '200': response('ReferenceDeleteResponse'), '4XX': errorResponse() },
      },
    },
    '/api/v1/reference/commands/refresh': {
      post: {
        ...secured('POST', '/api/v1/reference/commands/refresh'),
        summary: 'Request a receipt-protected refresh',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ReferenceCommandRequest' },
            },
          },
        },
        responses: { '200': response('ReferenceCommandResponse'), '4XX': errorResponse() },
      },
    },
    '/api/v1/diagnostics': {
      get: {
        ...secured('GET', '/api/v1/diagnostics'),
        summary: 'Read trusted Mac diagnostics',
        responses: { '200': response('DiagnosticsResponse'), '4XX': errorResponse() },
      },
    },
    '/api/v1/pairing/status': {
      get: {
        ...secured('GET', '/api/v1/pairing/status'),
        summary: 'Read paired-device status',
        responses: { '200': response('PairingStatusResponse'), '4XX': errorResponse() },
      },
    },
  };

  // Keep a machine-checkable assertion that every registered route has exactly
  // one declared policy.  This fails generation if a future route is added to
  // Fastify without entering the central registry.
  const registeredPaths = new Set(Object.keys(paths));
  for (const definition of CANONICAL_ROUTE_DEFINITIONS) {
    const path = definition.path.replace(/:([^/]+)/g, '{$1}');
    if (!registeredPaths.has(path)) {
      throw new Error(`Canonical route is missing from OpenAPI: ${definition.method} ${path}`);
    }
    const operation = paths[path]?.[definition.method.toLowerCase()];
    if (
      !operation ||
      (operation as { operationId?: string }).operationId !== definition.operationId
    ) {
      throw new Error(
        `Canonical OpenAPI operation does not match registry: ${definition.method} ${path}`,
      );
    }
  }
  const operationIds = Object.values(paths).flatMap((path) =>
    Object.values(path).map((operation) => (operation as { operationId?: string }).operationId),
  );
  if (
    operationIds.some((operationId) => !operationId) ||
    new Set(operationIds).size !== operationIds.length
  ) {
    throw new Error('Canonical OpenAPI operation IDs must be unique and non-empty');
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Money Monitor canonical API',
      version: '1',
      description:
        'The Mac-authoritative, schema-generated contract shared by the Mac-local and paired-iPhone listeners.',
    },
    servers: [{ url: 'http://127.0.0.1' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        Money: jsonSchema(moneySchema),
        CanonicalMeta: jsonSchema(canonicalMetaSchema),
        CanonicalErrorEnvelope: jsonSchema(canonicalErrorEnvelopeSchema),
        HomeOverviewData: jsonSchema(homeOverviewDataSchema),
        HomeOverviewResponse: jsonSchema(homeOverviewResponseSchema),
        ReferenceResource: jsonSchema(referenceResourceSchema),
        ReferenceResponse: jsonSchema(referenceResponseSchema),
        ReferenceReadQuery: jsonSchema(referenceReadQuerySchema),
        ReferenceUpdateRequest: jsonSchema(referenceUpdateRequestSchema),
        ReferenceDeleteResponse: jsonSchema(referenceDeleteResponseSchema),
        ReferenceDeleteQuery: jsonSchema(referenceDeleteQuerySchema),
        ReferenceCommandRequest: jsonSchema(referenceCommandRequestSchema),
        ReferenceCommandResponse: jsonSchema(referenceCommandResponseSchema),
        DiagnosticsResponse: jsonSchema(diagnosticsResponseSchema),
        PairingStatusResponse: jsonSchema(pairingStatusResponseSchema),
      },
    },
  };
}

export const CANONICAL_OPENAPI_DOCUMENT = createCanonicalOpenApiDocument();
