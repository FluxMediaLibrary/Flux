/**
 * Notifications service — settings CRUD for the NotificationSettings singleton.
 *
 * smtpPassword is write-only: never returned in any response DTO.
 */
import { prisma } from '../../lib/db.js';
import type {
  NotificationSettingsDTO,
  UpdateNotificationSettingsRequest,
} from '@flux/shared';

// ─── Public API ────────────────────────────────────────────────────────────────

/** Return current notification settings (without smtpPassword). */
export async function getSettings(): Promise<NotificationSettingsDTO> {
  const row = await prisma.notificationSettings.upsert({
    where: { id: 'singleton' },
    create: {},
    update: {},
  });

  return toDTO(row);
}

/** Update notification settings. smtpPassword is optional — if absent it won't
 *  overwrite the stored value. Returns the updated DTO (never the password). */
export async function updateSettings(
  data: UpdateNotificationSettingsRequest,
): Promise<NotificationSettingsDTO> {
  const { smtpPassword, ...rest } = data;

  // Build the upsert data payload, omitting smtpPassword when not provided.
  const upsertData: Record<string, unknown> = { ...rest };
  if (smtpPassword !== undefined) {
    upsertData.smtpPassword = smtpPassword;
  }

  const row = await prisma.notificationSettings.upsert({
    where: { id: 'singleton' },
    create: upsertData,
    update: upsertData,
  });

  return toDTO(row);
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Strip smtpPassword and convert to DTO shape. */
function toDTO(
  row: Awaited<ReturnType<typeof prisma.notificationSettings.upsert>>,
): NotificationSettingsDTO {
  return {
    discordEnabled: row.discordEnabled,
    discordWebhookUrl: row.discordWebhookUrl,
    smtpEnabled: row.smtpEnabled,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpUsername: row.smtpUsername,
    smtpFromAddress: row.smtpFromAddress,
  };
}
