import type { RokuTrailerDTO } from '@flux/shared';

/**
 * Provider embed pages are not media URLs. Keep the Roku representation on a
 * Flux-owned page where the web client can use its supported embed player.
 */
export function createRokuTrailer(
  mediaItemId: string,
  trailerYoutubeKey: string | null | undefined,
  frontendOrigin: string,
): RokuTrailerDTO | null {
  if (!trailerYoutubeKey?.trim()) return null;

  return {
    provider: 'youtube',
    webUrl: new URL(`/library/${encodeURIComponent(mediaItemId)}`, frontendOrigin).toString(),
  };
}
