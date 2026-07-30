/**
 * Notifications module — admin-configurable Discord webhook + SMTP settings.
 *
 * Routes:
 *   GET  /settings — return NotificationSettingsDTO (smtpPassword never included)
 *   PUT  /settings — update settings; body validated against UpdateNotificationSettingsRequest
 */
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { getSettings, updateSettings } from './notifications.service.js';
import { writeAuditEvent } from '../admin/admin-control.service.js';
import { isAllowedDiscordWebhook } from '../../lib/discord-webhook.js';

const updateSettingsSchema = z.object({
  discordEnabled: z.boolean().optional(),
  discordWebhookUrl: z.string().url()
    .refine(isAllowedDiscordWebhook, 'Enter a valid HTTPS Discord webhook URL')
    .nullable()
    .optional(),
  smtpEnabled: z.boolean().optional(),
  smtpHost: z.string().nullable().optional(),
  smtpPort: z.number().int().positive().nullable().optional(),
  smtpUsername: z.string().nullable().optional(),
  smtpPassword: z.string().nullable().optional(),
  smtpFromAddress: z.string().email().nullable().optional(),
});

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requirePermission('CHANGE_SETTINGS'));

  app.get('/settings', async () => getSettings());

  app.put('/settings', async (request) => {
    const body = updateSettingsSchema.parse(request.body);
    const result = await updateSettings(body);
    await writeAuditEvent({
      actorId: request.account!.id,
      action: 'NOTIFICATION_SETTINGS_CHANGED',
      targetType: 'SETTINGS',
      targetId: 'notifications',
      details: {
        discordEnabled: result.discordEnabled,
        smtpEnabled: result.smtpEnabled,
      },
    });
    return result;
  });
};
