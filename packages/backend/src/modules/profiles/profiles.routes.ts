/**
 * Profile routes (all require a valid account token):
 *   GET    /api/profiles
 *   POST   /api/profiles
 *   PATCH  /api/profiles/:id
 *   DELETE /api/profiles/:id
 *   POST   /api/profiles/:id/activate
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ApiError } from '../../lib/errors.js';
import { createProfileSchema, updateAudioPreferenceSchema, updateProfileSchema } from './profiles.schema.js';
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  activateProfile,
  updateAudioPreference,
} from './profiles.service.js';

export const profileRoutes: FastifyPluginAsync = async (
  app: FastifyInstance,
) => {
  // Every route in this module requires authentication.
  app.addHook('preHandler', app.requireAuth);

  app.get('/', async (request) => {
    const account = request.account!;
    return listProfiles(account.id);
  });

  app.post('/', async (request, reply) => {
    const account = request.account!;
    const input = createProfileSchema.parse(request.body);
    const profile = await createProfile(account.id, input);
    return reply.status(201).send(profile);
  });

  app.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const account = request.account!;
    const { id } = request.params;
    if (!id) throw ApiError.badRequest('Profile id is required');
    const input = updateProfileSchema.parse(request.body);
    const profile = await updateProfile(account.id, id, input);
    return reply.send(profile);
  });

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const account = request.account!;
    const { id } = request.params;
    if (!id) throw ApiError.badRequest('Profile id is required');
    await deleteProfile(account.id, id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>(
    '/:id/activate',
    async (request, reply) => {
      const account = request.account!;
      const { id } = request.params;
      if (!id) throw ApiError.badRequest('Profile id is required');
      const result = await activateProfile(account.id, account.role, id);
      return reply.send(result);
    },
  );

  app.patch(
    '/me/audio-preference',
    { preHandler: [app.requireProfile] },
    async (request, reply) => {
      const input = updateAudioPreferenceSchema.parse(request.body);
      const result = await updateAudioPreference(request.activeProfileId!, input);
      return reply.send(result);
    },
  );
};
