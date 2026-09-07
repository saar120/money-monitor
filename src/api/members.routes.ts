import type { FastifyInstance } from 'fastify';
import { createMember, listMembers, updateMember } from '../services/members.js';
import { createMemberSchema, updateMemberSchema } from './validation.js';
import { parseIntParam, sendServiceError, validateBody } from './helpers.js';
import { createMobilePublicIdProjector } from '../mobile/mobile-public-id.js';
import { config } from '../config.js';

const publicId = createMobilePublicIdProjector(config.MOBILE_PUBLIC_ID_KEY);

function projectMember<T extends { id: number }>(member: T) {
  return { ...member, publicId: publicId('member', member.id) };
}

export async function membersRoutes(app: FastifyInstance) {
  app.get('/api/members', async (_request, reply) => {
    return reply.send({ members: listMembers(true).map(projectMember) });
  });

  app.post('/api/members', async (request, reply) => {
    const data = validateBody(createMemberSchema, request.body, reply);
    if (!data) return;
    const result = createMember(data);
    return reply.status(201).send({ member: projectMember(result.member) });
  });

  app.patch<{ Params: { id: string } }>('/api/members/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'member id', reply);
    if (id === null) return;
    const data = validateBody(updateMemberSchema, request.body, reply);
    if (!data) return;
    const result = updateMember(id, data);
    if (!result.ok) return sendServiceError(reply, result);
    return reply.send({ member: projectMember(result.member) });
  });

  app.delete<{ Params: { id: string } }>('/api/members/:id', async (request, reply) => {
    const id = parseIntParam(request.params.id, 'member id', reply);
    if (id === null) return;
    const result = updateMember(id, { isActive: false });
    if (!result.ok) return sendServiceError(reply, result);
    return reply.send({ member: projectMember(result.member) });
  });
}
