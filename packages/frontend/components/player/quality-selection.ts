import type { PlaybackInfoDTO } from '@flux/shared';

type QualityLabel = PlaybackInfoDTO['qualities'][number]['label'];

function isSourceEquivalentQuality(
  info: PlaybackInfoDTO,
  qualityLabel: QualityLabel,
): boolean {
  const target = info.qualities.find((quality) => quality.label === qualityLabel);
  const original = info.qualities.find((quality) => quality.label === 'Original');
  if (!target?.height || !original?.height || target.height !== original.height) return false;
  if (target.width && original.width && target.width !== original.width) return false;
  return !target.bitrate || !original.bitrate || original.bitrate <= target.bitrate;
}

export function canKeepDirectPlayback(
  info: PlaybackInfoDTO,
  qualityLabel: QualityLabel,
  audioStreamIndex: number | null,
): boolean {
  if (!info.directPlay || audioStreamIndex !== null) return false;
  if (qualityLabel === 'Auto' || qualityLabel === 'Original') return true;

  // Re-encoding an already matching source at a higher bitrate cannot improve
  // quality. Keep the direct stream so the media element and timestamp do not
  // change at all.
  return isSourceEquivalentQuality(info, qualityLabel);
}

export function requiresAdaptiveTranscode(
  info: PlaybackInfoDTO,
  qualityLabel: QualityLabel,
): boolean {
  return qualityLabel !== 'Auto' &&
    qualityLabel !== 'Original' &&
    !isSourceEquivalentQuality(info, qualityLabel);
}

export function canSwitchQualityInPlace(
  currentMethod: 'direct' | 'hls',
  currentStreamIsAdaptive: boolean,
  nextSourceIsDirect: boolean,
  nextRequiresAdaptive: boolean,
): boolean {
  const nextMethod = nextSourceIsDirect ? 'direct' : 'hls';
  return currentMethod === nextMethod &&
    (nextMethod === 'direct' || currentStreamIsAdaptive || !nextRequiresAdaptive);
}
