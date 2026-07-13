/**
 * Notification fan-out — best-effort delivery to Discord webhook and/or SMTP.
 *
 * All public functions are fire-and-forget: they catch and log errors internally
 * so callers (e.g. postprocess.ts) don't need to wrap them in try/catch.
 */
import { prisma } from '../../lib/db.js';

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Notify that a new media request was created.
 * Loads the request, the requesting user's email, and notification settings,
 * then fans out to enabled channels.
 */
export async function notifyNewRequest(requestId: string): Promise<void> {
  try {
    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: { profile: { include: { user: { select: { email: true } } } } },
    });

    if (!request) {
      console.warn(
        `[Notifications] notifyNewRequest: request ${requestId} not found`,
      );
      return;
    }

    const settings = await getSettings();

    const target =
      request.mediaType === 'SHOW' && request.season
        ? `${request.title} S${request.season}${request.episode ? ` E${request.episode}` : ''}`
        : request.title;
    const title = target;
    const userEmail = request.profile.user.email;

    // Discord
    if (settings.discordEnabled && settings.discordWebhookUrl) {
      await sendDiscord(
        settings.discordWebhookUrl,
        `📥 **New request** — *${title}* by ${userEmail}`,
      );
    }

    // SMTP
    if (settings.smtpEnabled && userEmail) {
      await sendEmail({
        to: userEmail,
        subject: `Request received: ${title}`,
        body: `Your request for "${title}" has been received and is pending approval.`,
      });
    }
  } catch (err) {
    console.error('[Notifications] notifyNewRequest failed:', err);
  }
}

/**
 * Notify that a media request has been fulfilled (torrent download + media
 * placement complete). Fans out to Discord and SMTP if enabled.
 */
export async function notifyRequestFulfilled(requestId: string): Promise<void> {
  try {
    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: { profile: { include: { user: { select: { email: true } } } } },
    });

    if (!request) {
      console.warn(
        `[Notifications] notifyRequestFulfilled: request ${requestId} not found`,
      );
      return;
    }

    const settings = await getSettings();

    const target =
      request.mediaType === 'SHOW' && request.season
        ? `${request.title} S${request.season}${request.episode ? ` E${request.episode}` : ''}`
        : request.title;
    const title = target;
    const userEmail = request.profile.user.email;

    // Discord
    if (settings.discordEnabled && settings.discordWebhookUrl) {
      await sendDiscord(
        settings.discordWebhookUrl,
        `✅ **Request fulfilled** — *${title}* for ${userEmail} is now available`,
      );
    }

    // SMTP
    if (settings.smtpEnabled && userEmail) {
      await sendEmail({
        to: userEmail,
        subject: `Now available: ${title}`,
        body: `Great news! "${title}" has been downloaded and is now available to stream in your library.`,
      });
    }
  } catch (err) {
    console.error('[Notifications] notifyRequestFulfilled failed:', err);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Load notification settings (singleton). Falls back to all-false defaults if
 * the row hasn't been created yet.
 */
async function getSettings() {
  return prisma.notificationSettings.upsert({
    where: { id: 'singleton' },
    create: {},
    update: {},
  });
}

/**
 * Send a simple text message to a Discord webhook URL.
 * Catches all errors — never throws.
 */
async function sendDiscord(
  webhookUrl: string,
  content: string,
): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      console.error(
        `[Notifications] Discord webhook returned ${response.status}: ${await response.text().catch(() => '?')}`,
      );
    }
  } catch (err) {
    console.error('[Notifications] Discord webhook send failed:', err);
  }
}

/**
 * "Send" an email via SMTP.
 *
 * TODO(Phase 10+): add nodemailer dependency and implement real SMTP sending
 * with the configured host/port/credentials/auth.  For now this logs the
 * intent so the pipeline isn't blocked.
 */
async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  // TODO: add nodemailer and wire up real SMTP sending using the stored settings
  console.log(
    `[Notifications] Would email ${opts.to}: "${opts.subject}"`,
  );
}
