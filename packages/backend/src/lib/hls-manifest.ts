const START_AT_BEGINNING = '#EXT-X-START:TIME-OFFSET=0,PRECISE=YES';
const MIN_START_TAG_VERSION = 6;

/**
 * A growing EVENT playlist is still a live playlist to mobile/native HLS
 * engines. Explicitly prefer its first segment so opening an on-demand
 * transcode does not begin at the encoder's current live edge.
 */
export function preferHlsStartAtBeginning(manifest: string): string {
  if (!manifest.startsWith('#EXTM3U') || manifest.includes('#EXT-X-START:')) {
    return manifest;
  }

  const newline = manifest.includes('\r\n') ? '\r\n' : '\n';
  const lines = manifest.split(/\r?\n/);
  let versionIndex = lines.findIndex((line) => line.startsWith('#EXT-X-VERSION:'));

  if (versionIndex >= 0) {
    const version = Number(lines[versionIndex]!.slice('#EXT-X-VERSION:'.length));
    lines[versionIndex] =
      `#EXT-X-VERSION:${Math.max(version, MIN_START_TAG_VERSION)}`;
  } else {
    versionIndex = 1;
    lines.splice(versionIndex, 0, `#EXT-X-VERSION:${MIN_START_TAG_VERSION}`);
  }

  lines.splice(versionIndex + 1, 0, START_AT_BEGINNING);
  return lines.join(newline);
}
