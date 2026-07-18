import path from 'node:path';
import type { RokuPlaybackCapabilitiesDTO } from '@flux/shared';

export interface RokuPlaybackSource {
  filePath: string;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  bitrate: number | null;
  hdr: string | null;
}

export function selectRokuPlaybackMethod(
  source: RokuPlaybackSource,
  capabilities: RokuPlaybackCapabilitiesDTO,
): 'direct' | 'direct_stream' | 'transcode' {
  const ext = path.extname(source.filePath).toLowerCase();
  const directVideo = source.videoCodec === 'h264' || (source.videoCodec === 'hevc' && capabilities.supportsHevc);
  const directAudio = source.audioCodec === null || ['aac', 'ac3', 'eac3'].includes(source.audioCodec);
  const resolutionOk = capabilities.supports4k || (source.width ?? 0) <= 1920;
  const bitrateOk = !source.bitrate || source.bitrate <= capabilities.maxBitrate;
  const hdrOk = !source.hdr || (source.hdr === 'HDR10' && capabilities.supportsHdr10);
  const canDecode = directVideo && directAudio && resolutionOk && bitrateOk && hdrOk;
  if (['.mp4', '.m4v'].includes(ext) && canDecode) return 'direct';
  if (canDecode) return 'direct_stream';
  return 'transcode';
}
