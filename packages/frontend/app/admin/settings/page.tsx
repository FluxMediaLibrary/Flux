import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export const metadata: Metadata = { title: 'Settings' };

/**
 * TODO(phase-8): Notification settings.
 *  - GET/PUT /api/settings/notifications (NotificationSettingsDTO /
 *    UpdateNotificationSettingsRequest): Discord webhook + SMTP config toggles.
 *    smtpPassword is write-only (never rendered back).
 */
export default function AdminSettingsPage() {
  return (
    <PlaceholderPage
      title="Settings"
      todo="phase-8 — Discord webhook + SMTP notification configuration."
    />
  );
}
