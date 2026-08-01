const DESKTOP_TAG_PATTERN = /^pc-v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function parseDesktopReleaseTag(tag) {
  const match = DESKTOP_TAG_PATTERN.exec(String(tag || '').trim());
  if (!match) return null;
  return {
    tag: match[0],
    version: match[0].slice('pc-v'.length),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function compareIdentifiers(left, right) {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return left.localeCompare(right);
}

function compareDesktopVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const comparison = compareIdentifiers(left.prerelease[index], right.prerelease[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function selectLatestDesktopRelease(releases) {
  return releases
    .filter((release) => !release?.draft && !release?.prerelease)
    .map((release) => ({ release, parsed: parseDesktopReleaseTag(release?.tag_name) }))
    .filter((entry) => entry.parsed)
    .sort((left, right) => compareDesktopVersions(right.parsed, left.parsed))[0]?.release || null;
}

function desktopReleaseFeedUrl(tag) {
  if (!parseDesktopReleaseTag(tag)) throw new Error(`Invalid Flux desktop release tag: ${tag}`);
  return `https://github.com/FluxMediaLibrary/Flux/releases/download/${encodeURIComponent(tag)}`;
}

module.exports = {
  compareDesktopVersions,
  desktopReleaseFeedUrl,
  parseDesktopReleaseTag,
  selectLatestDesktopRelease,
};
