import type { FastifyInstance } from 'fastify';
import { parseIntParam, validateBody, validateQuery, sendServiceError } from './helpers.js';
import {
  createAssetSchema,
  updateAssetSchema,
  createHoldingSchema,
  updateHoldingSchema,
  assetsQuerySchema,
  snapshotsQuerySchema,
  createMovementSchema,
  movementQuerySchema,
  updateAssetValueSchema,
  recordRentSchema,
} from './validation.js';
import * as assetService from '../services/assets.js';
import { refreshHoldingPrices } from '../services/stock-prices.js';

export async function assetsRoutes(app: FastifyInstance) {
  // GET /api/assets
  app.get<{ Querystring: Record<string, string> }>('/api/assets', async (request, reply) => {
    const query = validateQuery(assetsQuerySchema, request.query, reply);
    if (!query) return;

    const result = await assetService.listAssets({ includeInactive: query.includeInactive });
    return reply.send(result);
  });

  // GET /api/assets/:id
  app.get<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'asset ID', reply);
    if (id === null) return;

    const result = await assetService.getAsset(id);
    if (!result) return reply.status(404).send({ error: 'Asset not found' });
    return reply.send(result);
  });

  // POST /api/assets
  app.post('/api/assets', async (request, reply) => {
    const data = validateBody(createAssetSchema, request.body, reply);
    if (!data) return;

    const result = await assetService.createAsset(data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.status(201).send(result.asset);
  });

  // PUT /api/assets/:id
  app.put<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'asset ID', reply);
    if (id === null) return;

    const data = validateBody(updateAssetSchema, request.body, reply);
    if (!data) return;

    const result = await assetService.updateAsset(id, data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.send(result.asset);
  });

  // PUT /api/assets/:id/value
  app.put<{ Params: { id: string } }>('/api/assets/:id/value', async (request, reply) => {
    const assetId = parseIntParam(request.params.id, 'asset ID', reply);
    if (assetId === null) return;

    const data = validateBody(updateAssetValueSchema, request.body, reply);
    if (!data) return;

    const result = await assetService.updateAssetValue(assetId, data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.send(result.asset);
  });

  // POST /api/assets/:id/rent
  app.post<{ Params: { id: string } }>('/api/assets/:id/rent', async (request, reply) => {
    const assetId = parseIntParam(request.params.id, 'asset ID', reply);
    if (assetId === null) return;

    const data = validateBody(recordRentSchema, request.body, reply);
    if (!data) return;

    const result = await assetService.recordRent(assetId, data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.send({ success: true });
  });

  // DELETE /api/assets/:id (soft delete)
  app.delete<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'asset ID', reply);
    if (id === null) return;

    const result = await assetService.deactivateAsset(id);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.status(204).send();
  });

  // POST /api/assets/:id/holdings
  app.post<{ Params: { id: string } }>('/api/assets/:id/holdings', async (request, reply) => {
    const assetId = parseIntParam(request.params.id, 'asset ID', reply);
    if (assetId === null) return;

    const data = validateBody(createHoldingSchema, request.body, reply);
    if (!data) return;

    const result = await assetService.createHolding(assetId, data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.status(201).send(result.holding);
  });

  // PUT /api/holdings/:id
  app.put<{ Params: { id: string } }>('/api/holdings/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'holding ID', reply);
    if (id === null) return;

    const data = validateBody(updateHoldingSchema, request.body, reply);
    if (!data) return;

    const result = await assetService.updateHolding(id, data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.send(result.holding);
  });

  // DELETE /api/holdings/:id
  app.delete<{ Params: { id: string } }>('/api/holdings/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'holding ID', reply);
    if (id === null) return;

    const result = await assetService.deleteHolding(id);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.status(204).send();
  });

  // GET /api/assets/:id/snapshots
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/api/assets/:id/snapshots',
    async (request, reply) => {
      const id = parseIntParam(request.params.id, 'asset ID', reply);
      if (id === null) return;

      if (!assetService.assetExists(id))
        return reply.status(404).send({ error: 'Asset not found' });

      const query = validateQuery(snapshotsQuerySchema, request.query, reply);
      if (!query) return;

      const rows = assetService.getSnapshots(id, query.startDate, query.endDate);
      return reply.send({ snapshots: rows });
    },
  );

  // ─── Stock Prices ───

  // POST /api/assets/refresh-prices — refresh all holdings with tickers
  app.post('/api/assets/refresh-prices', async (_request, reply) => {
    const result = await refreshHoldingPrices();
    return reply.send(result);
  });

  // POST /api/assets/:id/refresh-prices — refresh holdings for a specific asset
  app.post<{ Params: { id: string } }>('/api/assets/:id/refresh-prices', async (request, reply) => {
    const assetId = parseIntParam(request.params.id, 'asset ID', reply);
    if (assetId === null) return;

    if (!assetService.assetExists(assetId))
      return reply.status(404).send({ error: 'Asset not found' });

    const result = await refreshHoldingPrices(assetId);
    return reply.send(result);
  });

  // ─── Movements ───

  // GET /api/assets/:id/movements
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/api/assets/:id/movements',
    async (request, reply) => {
      const assetId = parseIntParam(request.params.id, 'asset ID', reply);
      if (assetId === null) return;

      if (!assetService.assetExists(assetId))
        return reply.status(404).send({ error: 'Asset not found' });

      const query = validateQuery(movementQuerySchema, request.query, reply);
      if (!query) return;

      const result = assetService.listMovements(assetId, query);
      return reply.send(result);
    },
  );

  // POST /api/assets/:id/movements
  app.post<{ Params: { id: string } }>('/api/assets/:id/movements', async (request, reply) => {
    const assetId = parseIntParam(request.params.id, 'asset ID', reply);
    if (assetId === null) return;

    const data = validateBody(createMovementSchema, request.body, reply);
    if (!data) return;

    const result = await assetService.createMovement(assetId, data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.status(201).send(result.movement);
  });

  // DELETE /api/movements/:id
  app.delete<{ Params: { id: string } }>('/api/movements/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'movement ID', reply);
    if (id === null) return;

    const result = await assetService.deleteMovement(id);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.status(204).send();
  });
}
