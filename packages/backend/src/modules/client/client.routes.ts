import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { ClientBootstrapDTO } from '@flux/shared';
import { config } from '../../config.js';
import { getServerSettings } from '../settings/settings.service.js';

function derivedServerId(): string {
  if (config.FLUX_SERVER_ID) return config.FLUX_SERVER_ID;
  const hex = createHash('sha256').update(`flux-server:${config.JWT_SECRET}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const clientRoutes: FastifyPluginAsync = async (app) => {
  app.get('/bootstrap', async (): Promise<ClientBootstrapDTO> => {
    const settings = await getServerSettings();
    return {
      product: 'flux',
      serverId: derivedServerId(),
      serverName: settings.serverName,
      serverVersion: config.FLUX_SERVER_VERSION,
      apiVersion: 1,
      minimumApiVersion: 1,
      branding: {
        name: settings.serverName,
        logoUrl: new URL('/icon-512.png', settings.frontendUrl).toString(),
        accentColor: '#8b5cf6',
        backgroundColor: '#0d0f12',
      },
    };
  });
};
