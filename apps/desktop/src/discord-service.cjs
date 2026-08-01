const DiscordRPC = require('discord-rpc');
const { buildRpcActivity, normalizePresence } = require('./discord-presence.cjs');

class DiscordPresenceService {
  constructor({ clientId, repositoryUrl, logger = console }) {
    this.clientId = clientId;
    this.repositoryUrl = repositoryUrl;
    this.logger = logger;
    this.client = null;
    this.connected = false;
    this.connecting = null;
    this.pendingPresence = null;
    this.lastPresence = null;
    this.retryTimer = null;
    this.retryDelayMs = 15_000;
  }

  get enabled() {
    return /^\d{10,30}$/.test(this.clientId);
  }

  async connect() {
    if (!this.enabled || this.connected) return this.connected;
    if (this.connecting) return this.connecting;

    this.connecting = new Promise((resolve) => {
      const client = new DiscordRPC.Client({ transport: 'ipc' });
      this.client = client;

      client.once('ready', async () => {
        this.connected = true;
        this.retryDelayMs = 15_000;
        this.logger.info('[desktop] Discord Rich Presence connected.');
        resolve(true);
      });

      client.once('disconnected', () => {
        this.connected = false;
        this.client = null;
        this.scheduleReconnect();
      });

      client.login({ clientId: this.clientId }).catch((error) => {
        this.connected = false;
        this.client = null;
        this.logger.info(`[desktop] Discord is unavailable: ${error.message}`);
        this.scheduleReconnect();
        resolve(false);
      });
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  scheduleReconnect() {
    if (!this.enabled || !this.pendingPresence || this.retryTimer) return;
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      try {
        if (await this.connect()) {
          if (this.pendingPresence) await this.publish(this.pendingPresence);
        }
      } catch {}
    }, this.retryDelayMs);
    this.retryTimer.unref?.();
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, 120_000);
  }

  shouldPublish(next) {
    const previous = this.lastPresence;
    if (!previous) return true;
    const identityChanged = ['title', 'mediaType', 'season', 'episode', 'episodeTitle', 'posterUrl', 'paused']
      .some((key) => previous[key] !== next[key]);
    if (identityChanged) return true;
    if (previous.durationSeconds !== next.durationSeconds) return true;
    if (next.paused) return Math.abs(previous.positionSeconds - next.positionSeconds) >= 1;

    const elapsed = Math.max(0, (Date.now() - previous.receivedAt) / 1000);
    const expectedPosition = previous.positionSeconds + elapsed;
    return Math.abs(expectedPosition - next.positionSeconds) >= 5;
  }

  async setPresence(input) {
    if (!this.enabled) return;
    const presence = { ...normalizePresence(input), receivedAt: Date.now() };
    this.pendingPresence = presence;
    if (!this.shouldPublish(presence)) return;
    if (!this.connected && !(await this.connect())) return;
    await this.publish(presence);
  }

  async publish(presence) {
    if (!this.connected || !this.client) return;
    try {
      // discord-rpc's setActivity helper predates Discord's Watching type and
      // drops the field. Send the documented SET_ACTIVITY payload directly.
      await this.client.request('SET_ACTIVITY', {
        pid: process.pid,
        activity: buildRpcActivity(presence, this.repositoryUrl),
      });
      this.lastPresence = presence;
    } catch (error) {
      this.logger.warn(`[desktop] Discord presence update failed: ${error.message}`);
    }
  }

  async clear() {
    this.pendingPresence = null;
    this.lastPresence = null;
    if (this.connected && this.client) {
      try { await this.client.clearActivity(); } catch {}
    }
  }

  destroy() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try { this.client?.destroy(); } catch {}
    this.client = null;
    this.connected = false;
  }
}

module.exports = { DiscordPresenceService };
