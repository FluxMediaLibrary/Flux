import nodemailer from 'nodemailer';
import type { SettingsTestResultDTO } from '@flux/shared';
import { prisma } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';

export async function deliverDiscord(webhookUrl: string, content: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}`);
}

export async function deliverEmail(opts: { to: string; subject: string; body: string }): Promise<void> {
  const settings = await prisma.notificationSettings.findUnique({ where: { id: 'singleton' } });
  if (!settings?.smtpHost || !settings.smtpPort || !settings.smtpFromAddress) {
    throw ApiError.badRequest('SMTP host, port, and from address must be configured', 'SMTP_INCOMPLETE');
  }
  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpPort === 465,
    ...(settings.smtpUsername ? { auth: { user: settings.smtpUsername, pass: settings.smtpPassword ?? '' } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  await transporter.sendMail({ from: settings.smtpFromAddress, to: opts.to, subject: opts.subject, text: opts.body });
}

export async function testDiscord(): Promise<SettingsTestResultDTO> {
  const settings = await prisma.notificationSettings.findUnique({ where: { id: 'singleton' } });
  if (!settings?.discordWebhookUrl) throw ApiError.badRequest('Configure a Discord webhook before testing', 'DISCORD_NOT_CONFIGURED');
  await deliverDiscord(settings.discordWebhookUrl, 'Flux test notification: Discord delivery is configured correctly.');
  return { ok: true, message: 'Test notification sent.' };
}

export async function testEmail(): Promise<SettingsTestResultDTO> {
  const settings = await prisma.notificationSettings.findUnique({ where: { id: 'singleton' } });
  if (!settings?.smtpFromAddress) throw ApiError.badRequest('Configure a from address before testing email', 'SMTP_NOT_CONFIGURED');
  await deliverEmail({ to: settings.smtpFromAddress, subject: 'Flux test email', body: 'Flux SMTP delivery is configured correctly.' });
  return { ok: true, message: `Test email sent to ${settings.smtpFromAddress}.` };
}
