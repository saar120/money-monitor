import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  commitOneZeroImport,
  createOneZeroImportPreview,
  OneZeroImportError,
  ONE_ZERO_IMPORT_MAX_BYTES,
} from '../services/onezero-import.js';
import { db } from '../db/connection.js';
import { accounts } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { parseIntParam, validateBody } from './helpers.js';
import { z } from 'zod';

const commitSchema = z.object({
  importToken: z.string().min(20).max(200),
  updateBalance: z.boolean().optional().default(false),
});

const ACCEPTED_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

function isExcelFileName(fileName: string): boolean {
  return /\.(?:xls|xlsx)$/i.test(fileName);
}

function sendImportError(reply: FastifyReply, error: unknown) {
  if (error instanceof OneZeroImportError) {
    return reply.status(error.status).send({ error: error.message, ...(error.details ?? {}) });
  }
  if (
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  ) {
    const statusCode = error.statusCode;
    const message =
      'message' in error && typeof error.message === 'string' ? error.message : 'Upload failed';
    return reply.status(statusCode).send({ error: message });
  }
  return reply.status(400).send({
    error: error instanceof Error ? error.message : 'The Excel workbook could not be imported',
  });
}

export async function oneZeroImportRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>(
    '/api/accounts/:id/onezero/import/preview',
    async (request, reply) => {
      const accountId = parseIntParam(request.params.id, 'account ID', reply);
      if (accountId === null) return;

      const account = db
        .select({ id: accounts.id, companyId: accounts.companyId })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .get();
      if (!account) return reply.status(404).send({ error: 'Account not found' });
      if (account.companyId !== 'oneZero') {
        return reply
          .status(400)
          .send({ error: 'One Zero imports are only available for One Zero accounts' });
      }

      let file;
      try {
        file = await request.file({ limits: { fileSize: ONE_ZERO_IMPORT_MAX_BYTES } });
      } catch (error) {
        return sendImportError(reply, error);
      }
      if (!file || file.fieldname !== 'file') {
        return reply.status(400).send({ error: 'Multipart field "file" is required' });
      }
      if (!isExcelFileName(file.filename)) {
        return reply.status(400).send({ error: 'Only .xls and .xlsx files are supported' });
      }
      if (file.mimetype && !ACCEPTED_MIME_TYPES.has(file.mimetype)) {
        return reply.status(400).send({ error: 'Unsupported Excel file type' });
      }

      try {
        const buffer = await file.toBuffer();
        return reply.send(createOneZeroImportPreview(accountId, file.filename, buffer));
      } catch (error) {
        return sendImportError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/accounts/:id/onezero/import/commit',
    async (request, reply) => {
      const accountId = parseIntParam(request.params.id, 'account ID', reply);
      if (accountId === null) return;

      const account = db
        .select({ id: accounts.id, companyId: accounts.companyId })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .get();
      if (!account) return reply.status(404).send({ error: 'Account not found' });
      if (account.companyId !== 'oneZero') {
        return reply
          .status(400)
          .send({ error: 'One Zero imports are only available for One Zero accounts' });
      }

      const data = validateBody(commitSchema, request.body, reply);
      if (!data) return;
      try {
        return reply.send(commitOneZeroImport(accountId, data.importToken, data.updateBalance));
      } catch (error) {
        return sendImportError(reply, error);
      }
    },
  );
}
