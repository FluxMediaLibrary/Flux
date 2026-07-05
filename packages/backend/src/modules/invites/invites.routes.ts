/**
 * Invite routes (ADMIN only):
 *   POST /api/invites   → generate a single-use expiring invite
 *   GET  /api/invites   → list invites
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { createInviteSchema } from './invites.schema.js';
import { createInvite, listInvites } from './invites.service.js';

export const inviteRoutes: FastifyPluginAsync = async (
  app: FastifyInstance,
) => {
  app.addHook('preHandler', app.requireAdmin);

  app.post('/', async (request, reply) => {
    const account = request.account!;
    const input = createInviteSchema.parse(request.body ?? {});
    const invite = await createInvite(account.id, input);
    return reply.status(201).send(invite);
  });

  app.get('/', async () => {
    return listInvites();
  });
};
