/** Accept only Discord's HTTPS webhook endpoint; reject arbitrary fetch targets. */
export function isAllowedDiscordWebhook(value: string): boolean {
  try {
    const url = new URL(value);
    const hostAllowed =
      url.hostname === 'discord.com' ||
      url.hostname.endsWith('.discord.com') ||
      url.hostname === 'discordapp.com' ||
      url.hostname.endsWith('.discordapp.com');
    return (
      url.protocol === 'https:' &&
      hostAllowed &&
      url.username === '' &&
      url.password === '' &&
      /^\/api\/webhooks\/\d+\/[^/]+\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}
