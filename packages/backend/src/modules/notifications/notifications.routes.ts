/**
 * Notifications module — admin-configurable Discord webhook + SMTP, plus a
 * generic fan-out notification service.
 * TODO(phase 7): implement GET/PUT /api/notifications/settings
 * (NotificationSettingsDTO / UpdateNotificationSettingsRequest, ADMIN only;
 * smtpPassword write-only) and a NotificationService that fans out to whichever
 * channels are enabled (new request → notify admin; fulfilled → notify member).
 *
 * Stub: reserves the /api/notifications mount point.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const notificationRoutes: FastifyPluginAsync = async (
  _app: FastifyInstance,
) => {
  // TODO(phase 7): GET/PUT /settings (requireAdmin).
};
