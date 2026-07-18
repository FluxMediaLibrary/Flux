# Roku playback architecture

Flux keeps playback selection server-owned. The Roku reports conservative device capabilities and preferences; the backend probes the actual media and selects direct play, direct stream/remux, or HLS transcode. The client does not guess from file extensions.

## Resolve flow

`POST /api/roku/playback/resolve` accepts a movie/show media ID, optional episode ID, optional resume position and track choices, preferred languages, subtitle state, and Roku capability data. The backend verifies profile ownership and file availability, probes codecs, creates a persistent `RokuPlaybackSession`, and returns:

- playback method and a short-lived, media-scoped URL
- Roku content type (`video/mp4` or `application/x-mpegURL`)
- exact server-known duration and resume position
- audio and subtitle track metadata with selected flags
- intro and credits markers
- next-episode metadata when applicable
- expiry, warnings, title, subtitle, and artwork

The source file path is never exposed. Direct and remux URLs are scoped just like HLS playlists and segments.

## Method policy

- `direct`: the source container, video codec, audio codec, bitrate, and selected tracks are within the reported Roku capabilities.
- `direct_stream`: compatible elementary streams need a Roku-friendly container, so FFmpeg remuxes without re-encoding video where possible.
- `transcode`: an unsupported codec, excessive bitrate, incompatible track combination, or other device constraint requires HLS transcoding.

The Roku reports its model, firmware, display class, HEVC/4K capability, and configured maximum bitrate. A 4K display alone is not proof of HDR or codec support; uncertain capability is reported as unsupported so the server chooses the safer method.

## Player state and progress

`PlayerScreen` uses a full-screen SceneGraph `Video` node. It applies the server URL, content type, server duration, and resume position, then observes player state and position. Progress heartbeats are sent every configured interval and on pause/buffer transitions when useful. Back, ended, idle, and error paths send one final stop event.

Progress is keyed by the selected Flux profile. A backend completion threshold marks watched state consistently with other clients. The Roku refreshes Home/details data after playback so continue-watching state is not inferred locally.

On an expired or rejected URL, the client makes one bounded `playback/refresh` attempt using the same live session and current position. The server replaces the URL/expiry. Repeated failure becomes an actionable error instead of an infinite retry loop.

## Tracks, captions, and markers

Audio tracks use the metadata returned by resolve and the native player selector where Roku OS exposes the stream. Subtitle tracks may be external WebVTT or a scoped backend conversion of embedded/sidecar captions. Subtitle conversion is cached by session/stream and served as `text/vtt`; unsupported formats return a user-visible warning rather than silently enabling nothing.

Intro and credits markers are data, not title heuristics. Skip Intro is visible only while the current position is inside a valid intro marker. Up Next appears at the credits boundary, can be cancelled, and follows the autoplay preference. The last episode has no fabricated next item.

## Cleanup and observability

Playback sessions have explicit active, stopped, replaced, and expired states. HLS processes and generated files are removed after 30 minutes of inactivity. Backend logs should correlate the device session, playback session, media ID, chosen method, probe outcome, refresh, progress, and final stop reason without logging tokens or filesystem paths returned to the client.

Static BrightScript validation cannot prove hardware playback. Release evidence must include the device model and Roku OS, source container/codecs, selected server method, observed video/audio/captions, progress result, and relevant sanitized logs. See `docs/roku-testing.md` and Roku's official [Video node](https://developer.roku.com/dev/docs/video), [streaming specifications](https://developer.roku.com/dev/docs/media), and [closed-caption guidance](https://developer.roku.com/dev/docs/closed-caption).
