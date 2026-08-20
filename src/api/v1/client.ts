import { z } from 'zod';
import {
  canonicalErrorEnvelopeSchema,
  diagnosticsResponseSchema,
  homeOverviewResponseSchema,
  pairingStatusResponseSchema,
  referenceCommandResponseSchema,
  referenceDeleteResponseSchema,
  referenceResponseSchema,
} from './contract.js';
import { ApiPaths, type components, type operations } from './generated-client.js';

export { ApiPaths } from './generated-client.js';
export type { components, operations, paths } from './generated-client.js';

export type Money = components['schemas']['Money'];
export type CanonicalMeta = components['schemas']['CanonicalMeta'];
export type CanonicalErrorEnvelope = components['schemas']['CanonicalErrorEnvelope'];
export type ReferenceResource = components['schemas']['ReferenceResource'];
export type ReferenceResponse = components['schemas']['ReferenceResponse'];
export type ReferenceResponseData = ReferenceResponse['data'];
export type ReferenceReadQuery = components['schemas']['ReferenceReadQuery'];
export type ReferenceUpdateRequest = components['schemas']['ReferenceUpdateRequest'];
export type ReferenceDeleteResponse = components['schemas']['ReferenceDeleteResponse'];
export type ReferenceDeleteResponseData = ReferenceDeleteResponse['data'];
export type ReferenceDeleteQuery = components['schemas']['ReferenceDeleteQuery'];
export type ReferenceCommandRequest = components['schemas']['ReferenceCommandRequest'];
export type ReferenceCommandResponse = components['schemas']['ReferenceCommandResponse'];
export type DiagnosticsResponse = components['schemas']['DiagnosticsResponse'];
export type PairingStatusResponse = components['schemas']['PairingStatusResponse'];
export type HomeOverviewResponse = components['schemas']['HomeOverviewResponse'];
export type HomeOverviewData = HomeOverviewResponse['data'];

type JsonContent<Value> = Value extends { content: { 'application/json': infer Content } }
  ? Content
  : never;
type OperationRequest<Name extends keyof operations> = operations[Name] extends {
  requestBody: infer Body;
}
  ? JsonContent<Body>
  : never;
type OperationPath<Name extends keyof operations> = operations[Name] extends {
  parameters: { path: infer Path };
}
  ? NonNullable<Path>
  : never;

export interface CanonicalTransportRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export type CanonicalTransport = (
  request: CanonicalTransportRequest,
) => Promise<{ status: number; json(): Promise<unknown> }>;

export class CanonicalClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly requestId?: string,
    readonly details: unknown = undefined,
  ) {
    super(`Canonical API request failed: ${code}`);
    this.name = 'CanonicalClientError';
  }
}

async function fetchTransport(request: CanonicalTransportRequest) {
  const response = await fetch(request.url, {
    method: request.method,
    headers: { accept: 'application/json', ...request.headers },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });
  return { status: response.status, json: () => response.json() as Promise<unknown> };
}

export interface CanonicalClientOptions {
  baseUrl: string;
  token: string;
  transport?: CanonicalTransport;
  testUnknownOutcome?: boolean;
}

export class CanonicalApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly transport: CanonicalTransport;
  private readonly testUnknownOutcome: boolean;

  constructor(options: CanonicalClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.transport = options.transport ?? fetchTransport;
    this.testUnknownOutcome = options.testUnknownOutcome ?? false;
  }

  public getReference(id: ReferenceReadQuery['id'] = 1): Promise<ReferenceResponseData> {
    const query = new URLSearchParams();
    if (id !== undefined) query.set('id', String(id));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.request<ReferenceResponse>(
      'GET',
      `${ApiPaths.getReference}${suffix}`,
      undefined,
      referenceResponseSchema,
    ).then((response) => response.data);
  }

  public updateReference(
    id: OperationPath<'updateReference'>['id'],
    request: OperationRequest<'updateReference'>,
  ): Promise<ReferenceResponseData> {
    return this.request<ReferenceResponse>(
      'PATCH',
      ApiPaths.updateReference.replace('{id}', String(id)),
      request,
      referenceResponseSchema,
    ).then((response) => response.data);
  }

  public deleteReference(
    id: OperationPath<'deleteReference'>['id'],
    expectedVersion: ReferenceDeleteQuery['expectedVersion'],
  ): Promise<ReferenceDeleteResponseData> {
    const query = new URLSearchParams();
    query.set('expectedVersion', String(expectedVersion));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.request<ReferenceDeleteResponse>(
      'DELETE',
      `${ApiPaths.deleteReference.replace('{id}', String(id))}${suffix}`,
      undefined,
      referenceDeleteResponseSchema,
    ).then((response) => response.data);
  }

  public requestReferenceRefresh(
    request: OperationRequest<'requestReferenceRefresh'>,
  ): Promise<ReferenceCommandResponse> {
    return this.request<ReferenceCommandResponse>(
      'POST',
      ApiPaths.requestReferenceRefresh,
      request,
      referenceCommandResponseSchema,
      this.testUnknownOutcome ? { 'x-canonical-test-unknown': 'true' } : undefined,
    );
  }

  public getDiagnostics(): Promise<DiagnosticsResponse> {
    return this.request<DiagnosticsResponse>(
      'GET',
      ApiPaths.getDiagnostics,
      undefined,
      diagnosticsResponseSchema,
    );
  }

  public getPairingStatus(): Promise<PairingStatusResponse> {
    return this.request<PairingStatusResponse>(
      'GET',
      ApiPaths.getPairingStatus,
      undefined,
      pairingStatusResponseSchema,
    );
  }

  public getHomeOverview(): Promise<HomeOverviewData> {
    return this.request<HomeOverviewResponse>(
      'GET',
      ApiPaths.getHomeOverview,
      undefined,
      homeOverviewResponseSchema,
    ).then((response) => response.data);
  }

  public requestRefresh(request: ReferenceCommandRequest): Promise<ReferenceCommandResponse> {
    return this.requestReferenceRefresh(request);
  }

  public async requestRefreshWithRecovery(request: ReferenceCommandRequest) {
    try {
      return { status: 'accepted' as const, response: await this.requestRefresh(request) };
    } catch (error) {
      if (error instanceof CanonicalClientError && error.code !== 'unknown_outcome') throw error;
      try {
        return { status: 'accepted' as const, response: await this.requestRefresh(request) };
      } catch (retryError) {
        if (retryError instanceof CanonicalClientError && retryError.code !== 'unknown_outcome') {
          throw retryError;
        }
        return {
          status: 'unknown' as const,
          resource: await this.getReference(request.resourceId),
        };
      }
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    validator: z.ZodType<T>,
    extraHeaders: Record<string, string> | undefined = undefined,
  ): Promise<T> {
    const response = await this.transport({
      method,
      url: `${this.baseUrl}${path}`,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body }),
    });
    const payload = await response.json();
    if (response.status < 200 || response.status >= 300) {
      const parsedError = canonicalErrorEnvelopeSchema.safeParse(payload);
      if (parsedError.success) {
        throw new CanonicalClientError(
          parsedError.data.error.code,
          response.status,
          parsedError.data.meta.requestId,
          parsedError.data.error,
        );
      }
      throw new CanonicalClientError('internal_server_error', response.status);
    }
    const parsed = validator.safeParse(payload);
    if (!parsed.success) throw new CanonicalClientError('invalid_response', response.status);
    return parsed.data;
  }
}

export class CanonicalMacClient extends CanonicalApiClient {}
export class CanonicalIPhoneClient extends CanonicalApiClient {}
