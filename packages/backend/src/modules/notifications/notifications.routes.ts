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
import { testDiscord, testEmail } from './notifications.delivery.js';

const updateSettingsSchema = z.object({
  discordEnabled: z.boolean().optional(),
  discordWebhookUrl: z.string().url().max(2000).nullable().optional(),
  smtpEnabled: z.boolean().optional(),
  smtpHost: z.string().trim().min(1).max(255).nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
  smtpUsername: z.string().max(320).nullable().optional(),
  smtpPassword: z.string().max(1000).nullable().optional(),
  smtpFromAddress: z.string().email().max(320).nullable().optional(),
}).strict();

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

  app.post('/test-discord', async (request) => {
    const result = await testDiscord();
    await writeAuditEvent({ actorId: request.account!.id, action: 'DISCORD_NOTIFICATION_TESTED', targetType: 'SETTINGS', targetId: 'notifications' });
    return result;
  });

  app.post('/test-email', async (request) => {
    const result = await testEmail();
    await writeAuditEvent({ actorId: request.account!.id, action: 'SMTP_EMAIL_TESTED', targetType: 'SETTINGS', targetId: 'notifications' });
    return result;
  });
};
