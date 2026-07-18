import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { ClientBootstrapDTO } from '@flux/shared';
import { config } from '../../config.js';

function derivedServerId(): string {
  if (config.FLUX_SERVER_ID) return config.FLUX_SERVER_ID;
  const hex = createHash('sha256').update(`flux-server:${config.JWT_SECRET}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const clientRoutes: FastifyPluginAsync = async (app) => {
  app.get('/bootstrap', async (): Promise<ClientBootstrapDTO> => ({
    product: 'flux',
    serverId: derivedServerId(),
    serverName: config.FLUX_SERVER_NAME,
    serverVersion: config.FLUX_SERVER_VERSION,
    apiVersion: 1,
    minimumApiVersion: 1,
    minimumRokuVersion: config.ROKU_MIN_VERSION,
    latestRokuVersion: config.ROKU_LATEST_VERSION,
    rokuSupported: config.ROKU_SUPPORTED,
    authentication: { deviceLink: true, usernamePassword: false },
    features: {
      profiles: true,
      profilePins: false,
      requests: config.ROKU_FEATURE_REQUESTS,
      skipIntro: config.ROKU_FEATURE_SKIP_INTRO,
      subtitles: config.ROKU_FEATURE_SUBTITLES,
      audioTracks: config.ROKU_FEATURE_AUDIO_TRACKS,
    },
    branding: {
      name: config.FLUX_SERVER_NAME,
      logoUrl: new URL('/icon-512.png', config.FRONTEND_ORIGIN).toString(),
      accentColor: '#8b5cf6',
      backgroundColor: '#0d0f12',
    },
  }));
};
