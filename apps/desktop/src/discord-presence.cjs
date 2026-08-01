const RPC_ACTIVITY_TYPE_WATCHING = 3;

function boundedText(value, maxLength = 128) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function finiteSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizePresence(input) {
  if (!input || typeof input !== 'object') throw new Error('Playback presence must be an object.');
  const title = boundedText(input.title);
  if (!title) throw new Error('Playback presence requires a title.');

  const mediaType = input.mediaType === 'show' ? 'show' : 'movie';
  const season = Number.isInteger(input.season) && input.season > 0 ? input.season : null;
  const episode = Number.isInteger(input.episode) && input.episode > 0 ? input.episode : null;
  const positionSeconds = finiteSeconds(input.positionSeconds);
  const durationSeconds = finiteSeconds(input.durationSeconds);
  const posterUrl = boundedText(input.posterUrl, 512);

  return {
    title,
    mediaType,
    season,
    episode,
    episodeTitle: boundedText(input.episodeTitle),
    posterUrl: /^https:\/\//i.test(posterUrl) ? posterUrl : '',
    positionSeconds,
    durationSeconds: durationSeconds >= positionSeconds ? durationSeconds : 0,
    paused: input.paused === true,
  };
}

function buildActivity(input, repositoryUrl, nowMs = Date.now()) {
  const presence = normalizePresence(input);
  const episodeCode = presence.season && presence.episode
    ? `S${presence.season} E${presence.episode}`
    : '';
  const episodeText = [episodeCode, presence.episodeTitle].filter(Boolean).join(' - ');
  const state = presence.paused
    ? `Paused${episodeText ? ` - ${episodeText}` : ''}`
    : episodeText || 'Movie';

  const activity = {
    type: RPC_ACTIVITY_TYPE_WATCHING,
    details: `Watching ${presence.title}`,
    state,
    largeImageKey: presence.posterUrl || 'flux',
    largeImageText: presence.title,
    smallImageKey: presence.posterUrl ? 'flux' : undefined,
    smallImageText: presence.posterUrl ? 'Flux' : undefined,
    buttons: [{ label: 'View Repository', url: repositoryUrl }],
    instance: false,
  };

  if (!presence.paused && presence.durationSeconds > 0) {
    const startMs = nowMs - presence.positionSeconds * 1000;
    activity.startTimestamp = new Date(startMs);
    activity.endTimestamp = new Date(startMs + presence.durationSeconds * 1000);
  }

  return activity;
}

function buildRpcActivity(input, repositoryUrl, nowMs = Date.now()) {
  const activity = buildActivity(input, repositoryUrl, nowMs);
  const timestamps = activity.startTimestamp || activity.endTimestamp
    ? {
        start: activity.startTimestamp?.getTime(),
        end: activity.endTimestamp?.getTime(),
      }
    : undefined;
  const assets = activity.largeImageKey || activity.smallImageKey
    ? {
        large_image: activity.largeImageKey,
        large_text: activity.largeImageText,
        small_image: activity.smallImageKey,
        small_text: activity.smallImageText,
      }
    : undefined;

  return {
    type: activity.type,
    details: activity.details,
    state: activity.state,
    timestamps,
    assets,
    buttons: activity.buttons,
    instance: activity.instance,
  };
}

module.exports = { buildActivity, buildRpcActivity, normalizePresence };
