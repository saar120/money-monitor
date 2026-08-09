import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { CANONICAL_OPENAPI_DOCUMENT } from '../src/api/v1/openapi.js';

type OpenApiSchema = {
  $ref?: string;
  type?: string;
  format?: string;
  const?: string | number | boolean;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  enum?: string[];
};

type OpenApiOperation = {
  operationId: string;
  parameters?: Array<{
    name: string;
    in: 'path' | 'query';
    required: boolean;
    schema?: OpenApiSchema;
  }>;
  requestBody?: {
    required?: boolean;
    content: { 'application/json': { schema: OpenApiSchema } };
  };
  responses: Record<
    string,
    {
      content?: { 'application/json'?: { schema?: OpenApiSchema } };
    }
  >;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, OpenApiSchema> };
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, '..');
const openApiPath = join(projectRoot, 'docs', 'api', 'v1.openapi.json');
const typescriptPath = join(projectRoot, 'src', 'api', 'v1', 'generated-client.ts');
const swiftPath = join(projectRoot, 'ios', 'MoneyMonitor', 'Generated', 'CanonicalAPI.swift');

function pascalCase(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+(.)/g, (_match, character: string) => character.toUpperCase())
    .replace(/^./, (character) => character.toUpperCase());
}

function componentName(reference: string): string {
  return reference.slice(reference.lastIndexOf('/') + 1);
}

function tsPropertyName(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
}

function tsType(schema: OpenApiSchema): string {
  if (schema.$ref) return componentName(schema.$ref);
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (schema.type === 'object' && schema.properties) {
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(schema.properties).map(
      ([name, property]) =>
        `${tsPropertyName(name)}${required.has(name) ? '' : '?'}: ${tsType(property)};`,
    );
    return `{ ${fields.join(' ')} }`;
  }
  if (schema.type === 'array' && schema.items) return `Array<${tsType(schema.items)}>`;
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  return 'string';
}

function responseDataTypeName(responseName: string): string | null {
  if (responseName === 'ReferenceResponse' || responseName === 'ReferenceDeleteResponse') {
    return `${responseName}Data`;
  }
  return null;
}

function tsComponentType(name: string, schema: OpenApiSchema): string {
  if (schema.type !== 'object' || !schema.properties) return tsType(schema);
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties).map(([propertyName, property]) => {
    const dataAlias = responseDataTypeName(name);
    const type = dataAlias && propertyName === 'data' ? dataAlias : tsType(property);
    return `${tsPropertyName(propertyName)}${required.has(propertyName) ? '' : '?'}: ${type};`;
  });
  return `{ ${fields.join(' ')} }`;
}

function typescriptDeclarations(document: OpenApiDocument): string {
  const declarations: string[] = [];
  for (const [name, schema] of Object.entries(document.components.schemas)) {
    const dataAlias = responseDataTypeName(name);
    if (dataAlias && schema.properties?.data) {
      declarations.push(`export type ${dataAlias} = ${tsType(schema.properties.data)};`);
    }
    declarations.push(`export type ${name} = ${tsComponentType(name, schema)};`);
  }
  return declarations.join('\n');
}

const contractSchemaNames: Record<string, string> = {
  CanonicalErrorEnvelope: 'canonicalErrorEnvelopeSchema',
  DiagnosticsResponse: 'diagnosticsResponseSchema',
  PairingStatusResponse: 'pairingStatusResponseSchema',
  ReferenceCommandRequest: 'referenceCommandRequestSchema',
  ReferenceCommandResponse: 'referenceCommandResponseSchema',
  ReferenceDeleteResponse: 'referenceDeleteResponseSchema',
  ReferenceResponse: 'referenceResponseSchema',
  ReferenceUpdateRequest: 'referenceUpdateRequestSchema',
};

function operationResponseRef(operation: OpenApiOperation): string {
  const schema = operation.responses['200']?.content?.['application/json']?.schema;
  if (!schema?.$ref)
    throw new Error(`${operation.operationId} has no generated 200 response schema`);
  return componentName(schema.$ref);
}

function operationRequestRef(operation: OpenApiOperation): string | null {
  const schema = operation.requestBody?.content['application/json'].schema;
  return schema?.$ref ? componentName(schema.$ref) : null;
}

function tsSchemaImports(document: OpenApiDocument): string {
  const refs = new Set<string>(['CanonicalErrorEnvelope']);
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem)) {
      refs.add(operationResponseRef(operation));
      const requestRef = operationRequestRef(operation);
      if (requestRef) refs.add(requestRef);
    }
  }
  const imports = [...refs]
    .sort()
    .map((ref) => `${contractSchemaNames[ref]} as ${contractSchemaNames[ref]}Validator`)
    .join(',\n  ');
  return `import {\n  ${imports}\n} from './contract.js';`;
}

function tsValidatorMap(document: OpenApiDocument): string {
  const refs = new Set<string>(['CanonicalErrorEnvelope']);
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem)) {
      refs.add(operationResponseRef(operation));
      const requestRef = operationRequestRef(operation);
      if (requestRef) refs.add(requestRef);
    }
  }
  return `const validators = {\n${[...refs]
    .sort()
    .map((ref) => `  ${ref}: ${contractSchemaNames[ref]}Validator,`)
    .join('\n')}\n} as const;`;
}

function tsParameterType(parameter: OpenApiOperation['parameters'][number]): string {
  const type = parameter.schema?.type;
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  return 'string';
}

function tsOperationMethod(
  document: OpenApiDocument,
  path: string,
  method: string,
  operation: OpenApiOperation,
): string {
  const responseRef = operationResponseRef(operation);
  const requestRef = operationRequestRef(operation);
  const responseSchema = document.components.schemas[responseRef];
  const unwrapResponse =
    responseRef === 'ReferenceResponse' || responseRef === 'ReferenceDeleteResponse';
  const returnType =
    unwrapResponse && responseSchema?.properties?.data
      ? (responseDataTypeName(responseRef) ?? tsType(responseSchema.properties.data))
      : responseRef;
  const pathParameters = (operation.parameters ?? []).filter(
    (parameter) => parameter.in === 'path',
  );
  const queryParameters = (operation.parameters ?? []).filter(
    (parameter) => parameter.in === 'query',
  );
  const pathArguments = pathParameters.map(
    (parameter) => `${parameter.name}: ${tsParameterType(parameter)}`,
  );
  const queryArguments = queryParameters.map((parameter) => {
    const hasDefault = operation.operationId === 'getReference' && parameter.name === 'id';
    const optional = parameter.required || hasDefault ? '' : '?';
    const defaultValue = hasDefault ? ' = 1' : '';
    return `${parameter.name}${optional}: ${tsParameterType(parameter)}${defaultValue}`;
  });
  const requestArgument = requestRef ? [`request: ${requestRef}`] : [];
  const signature = [...pathArguments, ...queryArguments, ...requestArgument].join(', ');
  const pathExpression = path.replace(/\{([^}]+)\}/g, '${$1}');
  const queryLines = queryParameters.length
    ? [
        'const query = new URLSearchParams();',
        ...queryParameters.map((parameter) =>
          parameter.required
            ? `query.set(${JSON.stringify(parameter.name)}, String(${parameter.name}));`
            : `if (${parameter.name} !== undefined) query.set(${JSON.stringify(parameter.name)}, String(${parameter.name}));`,
        ),
        'const suffix = query.toString() ? `?${query.toString()}` : "";',
      ]
    : [];
  const requestExpression = requestRef ? 'request' : 'undefined';
  const extraHeaders =
    operation.operationId === 'requestReferenceRefresh'
      ? ", this.testUnknownOutcome ? { 'x-canonical-test-unknown': 'true' } : undefined"
      : '';
  const rawCall = `this.request<${responseRef}>("${method}", \`${pathExpression}${queryParameters.length ? '${suffix}' : ''}\`, ${requestExpression}, "${responseRef}"${extraHeaders})`;
  const resultExpression =
    responseRef === 'ReferenceResponse' || responseRef === 'ReferenceDeleteResponse'
      ? `.then((response) => response.data)`
      : '';
  const requestMethodName =
    operation.operationId === 'requestReferenceRefresh'
      ? 'requestReferenceRefresh'
      : operation.operationId;
  return [
    `  public ${requestMethodName}(${signature}): Promise<${returnType}> {`,
    ...queryLines.map((line) => `    ${line}`),
    `    return ${rawCall}${resultExpression};`,
    '  }',
  ].join('\n');
}

function typescriptSourceFromOpenApi(document: OpenApiDocument): string {
  const operations = Object.entries(document.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem).map(([method, operation]) =>
      tsOperationMethod(document, path, method.toUpperCase(), operation),
    ),
  );
  return `// DO NOT EDIT BY HAND.
// Generated by scripts/generate-canonical-clients.ts from docs/api/v1.openapi.json.
${tsSchemaImports(document)}

${typescriptDeclarations(document)}

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
    super(\`Canonical API request failed: \${code}\`);
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

${tsValidatorMap(document)}

export class CanonicalApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly transport: CanonicalTransport;
  private readonly testUnknownOutcome: boolean;

  constructor(options: CanonicalClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\\/$/, '');
    this.token = options.token;
    this.transport = options.transport ?? fetchTransport;
    this.testUnknownOutcome = options.testUnknownOutcome ?? false;
  }

${operations.join('\n\n')}

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
        if (retryError instanceof CanonicalClientError && retryError.code !== 'unknown_outcome') throw retryError;
        return { status: 'unknown' as const, resource: await this.getReference(request.resourceId) };
      }
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    responseName: keyof typeof validators,
    extraHeaders: Record<string, string> | undefined = undefined,
  ): Promise<T> {
    const response = await this.transport({
      method,
      url: \`\${this.baseUrl}\${path}\`,
      headers: {
        authorization: \`Bearer \${this.token}\`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body }),
    });
    const payload = await response.json();
    if (response.status < 200 || response.status >= 300) {
      const parsedError = validators.CanonicalErrorEnvelope.safeParse(payload);
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
    const parsed = validators[responseName].safeParse(payload);
    if (!parsed.success) throw new CanonicalClientError('invalid_response', response.status);
    return parsed.data as T;
  }
}

export class CanonicalMacClient extends CanonicalApiClient {}
export class CanonicalIPhoneClient extends CanonicalApiClient {}
`;
}

function swiftIdentifier(value: string): string {
  const reserved = new Set([
    'associatedtype',
    'class',
    'deinit',
    'enum',
    'extension',
    'fileprivate',
    'func',
    'import',
    'init',
    'inout',
    'internal',
    'let',
    'open',
    'operator',
    'private',
    'protocol',
    'public',
    'static',
    'struct',
    'subscript',
    'typealias',
    'var',
    'break',
    'case',
    'continue',
    'default',
    'defer',
    'do',
    'else',
    'fallthrough',
    'for',
    'guard',
    'if',
    'in',
    'repeat',
    'return',
    'switch',
    'where',
    'while',
    'as',
    'Any',
    'catch',
    'false',
    'is',
    'nil',
    'rethrows',
    'super',
    'self',
    'Self',
    'throw',
    'throws',
    'true',
    'try',
    'actor',
    'async',
    'await',
    'some',
    'any',
  ]);
  return reserved.has(value) ? `\`${value}\`` : value;
}

function schemaType(
  schema: OpenApiSchema,
  parentName: string,
  propertyName: string,
  queue: Array<{ name: string; schema: OpenApiSchema }>,
): string {
  if (schema.$ref) return componentName(schema.$ref);
  if (schema.type === 'object' && schema.properties) {
    const name = `${parentName}${pascalCase(propertyName)}`;
    if (!queue.some((entry) => entry.name === name)) queue.push({ name, schema });
    return name;
  }
  if (schema.type === 'array' && schema.items) {
    const itemType = schemaType(
      schema.items,
      `${parentName}${pascalCase(propertyName)}`,
      'Item',
      queue,
    );
    return `[${itemType}]`;
  }
  if (schema.format === 'date-time') return 'Date';
  switch (schema.type) {
    case 'integer':
      return 'Int';
    case 'number':
      return 'Double';
    case 'boolean':
      return 'Bool';
    default:
      return 'String';
  }
}

function modelDeclarations(document: OpenApiDocument): string {
  const queue = Object.entries(document.components.schemas).map(([name, schema]) => ({
    name,
    schema,
  }));
  const emitted = new Set<string>();
  const declarations: string[] = [];
  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry || emitted.has(entry.name)) continue;
    emitted.add(entry.name);
    if (!entry.schema.properties) continue;
    const required = new Set(entry.schema.required ?? []);
    const fields = Object.entries(entry.schema.properties).map(([name, property]) => {
      const optional = required.has(name) ? '' : '?';
      const type = schemaType(property, entry.name, name, queue);
      return `    public let ${swiftIdentifier(name)}: ${type}${optional}`;
    });
    declarations.push(
      [`public struct ${entry.name}: Codable, Equatable {`, ...fields, ''].join('\n') + '}',
    );
  }
  return declarations.join('\n\n');
}

function successResponseType(operation: OpenApiOperation): string {
  const schema = operation.responses['200']?.content?.['application/json']?.schema;
  if (!schema?.$ref)
    throw new Error(`${operation.operationId} has no generated 200 response schema`);
  return componentName(schema.$ref);
}

function requestBodyType(operation: OpenApiOperation): string | null {
  const schema = operation.requestBody?.content['application/json'].schema;
  return schema?.$ref ? componentName(schema.$ref) : null;
}

function operationMethod(path: string, method: string, operation: OpenApiOperation): string {
  const responseType = successResponseType(operation);
  const requestType = requestBodyType(operation);
  const pathParameters = (operation.parameters ?? []).filter(
    (parameter) => parameter.in === 'path',
  );
  const queryParameters = (operation.parameters ?? []).filter(
    (parameter) => parameter.in === 'query',
  );
  const pathArguments = pathParameters
    .map((parameter) => `${swiftIdentifier(parameter.name)}: Int`)
    .join(', ');
  const queryArguments = queryParameters
    .map((parameter) => {
      const type = parameter.required ? 'Int' : 'Int?';
      const defaultValue = parameter.required ? '' : ' = nil';
      if (operation.operationId === 'getReference' && parameter.name === 'id') {
        return `${swiftIdentifier(parameter.name)}: Int? = 1`;
      }
      return `${swiftIdentifier(parameter.name)}: ${type}${defaultValue}`;
    })
    .join(', ');
  const requestArgument = requestType ? `request: ${requestType}` : '';
  const signatureArguments = [pathArguments, queryArguments, requestArgument]
    .filter(Boolean)
    .join(', ');
  const signature = signatureArguments ? `(${signatureArguments})` : '()';
  const pathExpression = path.replace(
    /\{([^}]+)\}/g,
    (_match, name: string) => `\\(${swiftIdentifier(name)})`,
  );
  // The path expression deliberately contains Swift interpolation (`\\(...)`);
  // escaping its backslash would turn it into a literal path component.
  const pathLine = `let path = "${pathExpression}"`;
  const queryLines = queryParameters.length > 0 ? ['var queryItems: [String] = []'] : [];
  queryLines.push(
    ...queryParameters.map((parameter) => {
      const identifier = swiftIdentifier(parameter.name);
      return parameter.required
        ? `queryItems.append("${parameter.name}=\\(${identifier})")`
        : `if let ${identifier} { queryItems.append("${parameter.name}=\\(${identifier})") }`;
    }),
  );
  if (queryParameters.length > 0) {
    queryLines.push(
      'let query = queryItems.isEmpty ? "" : "?" + queryItems.joined(separator: "&")',
    );
  }
  const querySuffix = queryParameters.length > 0 ? ' + query' : '';
  const bodyLine = requestType ? `let body = try encode(request)` : 'let body: Data? = nil';
  const pathCall = `try await send(path: path${querySuffix}, method: "${method}", body: body, response: ${responseType}.self)`;
  return [
    `    public func ${operation.operationId}${signature} async throws -> ${responseType} {`,
    `        ${pathLine}`,
    ...queryLines.map((line) => `        ${line}`),
    `        ${bodyLine}`,
    `        return ${pathCall}`,
    '    }',
  ].join('\n');
}

function clientMethods(document: OpenApiDocument): string {
  const methods: string[] = [];
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      methods.push(operationMethod(path, method.toUpperCase(), operation));
    }
  }
  return methods.join('\n\n');
}

function swiftSourceFromOpenApi(document: OpenApiDocument): string {
  const declarations = modelDeclarations(document);
  const methods = clientMethods(document);
  return `// DO NOT EDIT BY HAND.
// Generated by scripts/generate-canonical-clients.ts from docs/api/v1.openapi.json.
import Foundation

${declarations}

public enum CanonicalAPIError: Error, Equatable {
    case coded(code: String, requestId: String, status: Int)
    case invalidResponse(status: Int)
}

public protocol CanonicalTransport {
    func request(method: String, path: String, body: Data?, headers: [String: String]) async throws -> (status: Int, body: Data)
}

public struct CanonicalURLSessionTransport: CanonicalTransport {
    public let baseURL: URL
    public let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func request(method: String, path: String, body: Data?, headers: [String: String]) async throws -> (status: Int, body: Data) {
        guard let url = endpointURL(for: path) else {
            throw CanonicalAPIError.invalidResponse(status: 0)
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw CanonicalAPIError.invalidResponse(status: 0)
        }
        return (http.statusCode, data)
    }

    private func endpointURL(for path: String) -> URL? {
        guard var baseComponents = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              let endpointComponents = URLComponents(string: path) else {
            return nil
        }
        let basePath = baseComponents.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let endpointPath = endpointComponents.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let pathParts = [basePath, endpointPath].filter { !$0.isEmpty }
        baseComponents.path = "/" + pathParts.joined(separator: "/")
        baseComponents.query = endpointComponents.query
        baseComponents.fragment = endpointComponents.fragment
        return baseComponents.url
    }
}

public enum CanonicalJSONDecoder {
    public static func make() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: value) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO-8601 date")
        }
        return decoder
    }
}

public struct CanonicalAPIClient {
    private let transport: any CanonicalTransport
    private let token: String?
    private let decoder: JSONDecoder

    public init(transport: any CanonicalTransport, token: String? = nil) {
        self.transport = transport
        self.token = token
        self.decoder = CanonicalJSONDecoder.make()
    }

    public init(baseURL: URL, token: String, session: URLSession = .shared) {
        self.init(transport: CanonicalURLSessionTransport(baseURL: baseURL, session: session), token: token)
    }

${methods}

    private func encode<Value: Encodable>(_ value: Value) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(value)
    }

    private func send<Value: Decodable>(path: String, method: String, body: Data?, response: Value.Type) async throws -> Value {
        var headers = ["Accept": "application/json"]
        if body != nil { headers["Content-Type"] = "application/json" }
        if let token { headers["Authorization"] = "Bearer \\(token)" }
        let result = try await transport.request(method: method, path: path, body: body, headers: headers)
        guard (200..<300).contains(result.status) else {
            if let error = try? decoder.decode(CanonicalErrorEnvelope.self, from: result.body) {
                throw CanonicalAPIError.coded(code: error.error.code, requestId: error.meta.requestId, status: result.status)
            }
            throw CanonicalAPIError.invalidResponse(status: result.status)
        }
        guard let value = try? decoder.decode(response, from: result.body) else {
            throw CanonicalAPIError.invalidResponse(status: result.status)
        }
        return value
    }
}
`;
}

function writeOrCheck(path: string, content: string, checkOnly: boolean): boolean {
  if (checkOnly) return existsSync(path) && readFileSync(path, 'utf8') === content;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return true;
}

const checkOnly = process.argv.includes('--check');
const runtimeDocument = JSON.parse(JSON.stringify(CANONICAL_OPENAPI_DOCUMENT)) as OpenApiDocument;
const prettierConfig = (await prettier.resolveConfig(openApiPath)) ?? {};
const openApiJson = await prettier.format(JSON.stringify(runtimeDocument), {
  ...prettierConfig,
  filepath: openApiPath,
  parser: 'json',
});
const openApiMatches = writeOrCheck(openApiPath, openApiJson, checkOnly);
const serializedDocument = (
  checkOnly && existsSync(openApiPath)
    ? JSON.parse(readFileSync(openApiPath, 'utf8'))
    : JSON.parse(openApiJson)
) as OpenApiDocument;
const typescriptJson = await prettier.format(typescriptSourceFromOpenApi(serializedDocument), {
  ...prettierConfig,
  filepath: typescriptPath,
  parser: 'typescript',
});
const typescriptMatches = writeOrCheck(typescriptPath, typescriptJson, checkOnly);
const swiftMatches = writeOrCheck(swiftPath, swiftSourceFromOpenApi(serializedDocument), checkOnly);

if (checkOnly && (!openApiMatches || !typescriptMatches || !swiftMatches)) {
  console.error(
    'Canonical OpenAPI, TypeScript, or Swift client is stale. Run npm run canonical:clients:write.',
  );
  process.exitCode = 1;
}
