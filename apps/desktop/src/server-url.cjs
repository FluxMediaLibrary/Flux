function normalizeServerUrl(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) throw new Error('Enter a Flux server URL.');

  const explicitScheme = value.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
  if (explicitScheme && !['http', 'https'].includes(explicitScheme)) {
    throw new Error('Use an http:// or https:// URL.');
  }

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('Enter a valid host, like https://flux.example.com.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Use an http:// or https:// URL.');
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error('Enter a server URL without credentials.');
  }

  return url.origin;
}

function isSameServer(candidate, configuredBaseUrl) {
  try {
    return new URL(candidate).origin === new URL(configuredBaseUrl).origin;
  } catch {
    return false;
  }
}

module.exports = { normalizeServerUrl, isSameServer };
