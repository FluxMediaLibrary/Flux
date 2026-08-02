const MAX_RELEASE_NOTES_LENGTH = 12_000;

function releaseNotesText(value) {
  const notes = Array.isArray(value)
    ? value.map((entry) => {
      if (typeof entry === 'string') return entry;
      const version = String(entry?.version || '').trim();
      const note = String(entry?.note || '').trim();
      return [version ? `Version ${version}` : '', note].filter(Boolean).join('\n');
    }).join('\n\n')
    : String(value || '');
  const normalized = notes.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
  if (!normalized) return 'This release includes improvements and fixes for Flux Desktop.';
  if (normalized.length <= MAX_RELEASE_NOTES_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_RELEASE_NOTES_LENGTH).trimEnd()}\n\nRelease notes were shortened for display.`;
}

function buildUpdatePresentation(updateInfo, release = null) {
  const version = String(updateInfo?.version || '').trim();
  const releaseName = String(release?.name || updateInfo?.releaseName || '').trim();
  return {
    version,
    title: releaseName || `Flux Desktop ${version}`,
    notes: releaseNotesText(release?.body || updateInfo?.releaseNotes),
    releaseUrl: /^https:\/\//i.test(String(release?.html_url || '')) ? release.html_url : null,
  };
}

function normalizeUpdateFeedUrl(value) {
  const parsed = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('The desktop update feed must use HTTP or HTTPS.');
  }
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

module.exports = {
  buildUpdatePresentation,
  normalizeUpdateFeedUrl,
  releaseNotesText,
};
