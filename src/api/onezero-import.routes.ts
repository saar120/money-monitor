import type { FastifyInstance } from 'fastify';
import { commitOneZeroImport, createOneZeroImportPreview } from '../services/onezero-import.js';
import { ONE_ZERO_IMPORT_MAX_BYTES } from '../services/onezero-parser.js';
import { db } from '../db/connection.js';
import { accounts } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { parseIntParam } from './helpers.js';

export async function oneZeroImportRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: ONE_ZERO_IMPORT_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.post<{
    Params: { id: string };
    Querystring: { fileName?: string; commit?: string };
    Body: Buffer;
  }>('/api/accounts/:id/onezero/import', async (request, reply) => {
    const accountId = parseIntParam(request.params.id, 'account ID', reply);
    if (accountId === null) return;

    const account = db
      .select({ companyId: accounts.companyId })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get();
    if (!account) return reply.status(404).send({ error: 'Account not found' });
    if (account.companyId !== 'oneZero') {
      return reply
        .status(400)
        .send({ error: 'One Zero imports are only available for One Zero accounts' });
    }

    const fileName = request.query.fileName ?? '';
    if (!/\.xlsx?$/i.test(fileName)) {
      return reply.status(400).send({ error: 'Only .xls and .xlsx files are supported' });
    }
    if (!Buffer.isBuffer(request.body)) {
      return reply.status(400).send({ error: 'An Excel file is required' });
    }

    try {
      return reply.send(
        request.query.commit === 'true'
          ? commitOneZeroImport(accountId, request.body)
          : createOneZeroImportPreview(accountId, request.body),
      );
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'The Excel workbook could not be imported',
      });
    }
  });
}
