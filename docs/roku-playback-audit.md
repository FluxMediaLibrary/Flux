# Flux Roku playback audit

## Current pipeline

Media files are stored as a movie path on `MediaItem` or an episode path on `Episode`. Post-processing probes files with FFprobe and persists container, duration, size, and video/audio/subtitle stream records. Streaming path resolution is contained beneath `MEDIA_ROOT`; HLS output is contained beneath `TRANSCODE_ROOT`.

`GET /api/stream/:mediaItemId/info` returns browser-oriented `PlaybackInfoDTO`: whether direct play is allowed, HLS availability, primary codecs, duration, all analyzed streams, and quality choices. The service uses persisted analysis when available and FFprobe as fallback.

Direct streaming uses `GET /api/stream/:mediaItemId` with optional `episodeId`. It supports full responses and one byte range, returns 416 for invalid ranges, and sets `Accept-Ranges`, `Content-Range`, and content length.

HLS uses `GET /api/stream/:mediaItemId/hls/index.m3u8` and wildcard segment/variant routes. It creates an in-memory session keyed by media, episode, audio stream, and start time. FFmpeg produces four-second MPEG-TS segments. H.264/AAC can be remuxed; incompatible streams are transcoded to H.264/AAC. When source dimensions are known, adaptive tiers can be produced. The route waits up to 20 seconds for a manifest and briefly for playback runway. FFmpeg stderr and failures are tracked, and failed sessions are removed.

Browser media loads carry the profile JWT in query parameters because media elements cannot attach headers. Manifests are rewritten so nested playlists and segments retain that token. Cast improves on this by issuing a short-lived media/profile/session-scoped token.

## Codec and container behavior

Current browser direct-container allow-list: MP4, M4V, MOV, and WebM. Browser direct-video allow-list: H.264, VP8, VP9, and AV1. Browser direct-audio allow-list: AAC, MP3, Opus, Vorbis, and FLAC. Cast direct play is intentionally narrower: MP4/M4V with H.264 and AAC; other sources use HLS.

The Roku resolver must not reuse either allow-list blindly. It must evaluate the submitted Roku model/firmware capabilities, resolution, HDR, bitrate, container, video codec/profile/level, audio codec/channels, selected tracks, and subtitle burn-in needs. The output mode is `DIRECT_PLAY`, `DIRECT_STREAM`, or `TRANSCODE`, with a reason recorded server-side.

## Progress and resume

`POST /api/library/progress` upserts profile-scoped movie or episode progress. The backend marks content complete at 92 percent. The web player reports periodically and on important state changes, omitting invalid HLS duration. Details and cards consume the stored progress, and episode resume selects the most recently updated incomplete episode.

Roku can reuse the persistence service but needs playback-session validation, start/pause/seek/stop/complete event semantics, an idempotent heartbeat contract, and a final stop endpoint. The backend should remain authoritative for the watched threshold and next episode.

## Tracks, markers, and episodic behavior

FFprobe persists audio and subtitle stream metadata including language, title, default, and forced flags. The web client can choose an analyzed audio stream by restarting HLS with `audioStream`. No endpoint currently extracts or converts subtitles, and the web UI does not provide functional subtitle selection. There is no intro or credits marker table. The web watch page only prewarms playback info for the next episode; it does not show an Up Next countdown or automatically transition.

Required additions are:

- Stable audio/subtitle track ids in the resolver response.
- WebVTT conversion/extraction for Roku-compatible external subtitles, scoped to the playback session.
- Optional server-side subtitle burn-in when the device cannot render a selected format.
- Intro and credits marker persistence or an explicit null capability until real markers exist.
- Server-resolved next episode that respects local availability and profile state.
- Refresh and stop endpoints for expiring playback sessions.

## Session and cleanup gaps

Current HLS sessions are process-memory maps. They are discarded when replaced for the same source/start key or when startup/segment failure is detected, but there is no inactivity TTL sweep, client stop route, durable session ownership, multi-process coordination, or automatic transcode-directory cleanup after normal playback. Cast grants are also process-memory maps. A backend restart invalidates Cast state while old signed URLs may remain cryptographically valid.

The Roku implementation needs a persistent playback-session record, short-lived stream token, explicit expiry/last-seen time, revocation, stop cleanup, and periodic stale-session cleanup. The existing HLS engine can remain in-process initially, but every request must prove the playback-session scope. Raw file paths, internal addresses, and permanent URLs must never be returned.

## Error behavior

Existing direct routes produce normalized API errors. HLS distinguishes startup timeout, FFmpeg failure, missing session, and missing segment; it waits for late segments instead of failing immediately. The web player has retry and limited HLS recovery. Roku needs a resolver/preparation timeout, bounded URL refresh, one auth-refresh retry, bounded playback retry, and user-facing error mapping for missing media, unsupported capabilities, transcode failure, expiry, network interruption, and server restart.

## Verification baseline

Static audit confirms the code paths and installed FFmpeg/FFprobe. Docker services, the Flux backend, media mounts, Redis, Transmission, and a Roku device were unavailable during Phase 0. Direct play, remux, transcode, subtitle rendering, and hardware codec behavior therefore remain release verification gates rather than completed claims.

