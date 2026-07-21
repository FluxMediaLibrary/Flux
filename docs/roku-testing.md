# Roku test matrix

## Automated checks

Run from the repository root:

```powershell
npm run build --workspace @flux/shared
npm run typecheck --workspace @flux/backend
npm run typecheck --workspace @flux/frontend
npm test --workspace @flux/backend
npm run roku:test
npm run roku:check
npm run roku:package
git diff --check
```

The backend tests cover device-code safety, token expiry, progress completion, partial Home-row failure, playback-policy decisions, and Fastify-injected Roku bootstrap/version/config routes. The typed Roku detail contract exposes a trailer only as a Flux-owned web destination; it never presents a provider embed URL as a native-video stream. `roku:test` runs deterministic BrightScript unit tests off-device for URL validation, semantic versions, response/error parsing, registry round-tripping, progress calculations, feature flags, navigation state, and playback request construction; it also validates focus/event contracts for every interactive screen. `roku:check` compiles every BrightScript/SceneGraph component and validates required assets and manifest keys. None of these emulate the SceneGraph renderer or Roku media stack.

## Required hardware matrix

Test at least one current low-memory HD Roku and one current 4K Roku. Include:

- clean install, server validation, unreachable server, invalid server, and server replacement
- device approval, denial, expiry, slow polling, refresh rotation, sign-out, and revoked session
- zero, one, and multiple profiles; profile change during a session
- empty, small, and large libraries; every home row; paging; search debounce and empty results
- movie, show, season, episode, unavailable file, missing artwork, and TMDb outage
- MP4 H.264/AAC direct play; MKV H.264/AAC remux; HEVC unsupported-device transcode; 4K/HDR policy
- embedded subtitle conversion, forced/default/off behavior, multiple audio tracks, and unsupported subtitle failure
- fresh play, resume, seek, pause, buffering, back, completion, progress on another client, and app relaunch
- intro marker visibility boundaries, skip action, credits boundary, Up Next, autoplay, and final episode
- token expiry/recovery, backend restart, Wi-Fi interruption, FFmpeg failure, and stale HLS cleanup
- deep link cold start and warm start
- 30+ minute browsing soak and long-media playback while watching memory and backend process counts

Record device model, Roku OS, source container/codecs, selected server method, observed result, and backend/player logs. Static compilation is not evidence that video actually played.

## Current local evidence (2026-07-18)

| Check | Result |
| --- | --- |
| Roku discovery | onn. Roku TV model `100012589`, Roku OS `15.2.4` |
| Roku discovery | Roku Express 4K+, Roku OS `15.2.4` |
| Developer installer | Developer mode is enabled on `192.168.1.211`; `flux-roku-1.0.11.zip` was accepted after packaging with POSIX ZIP entry paths |
| Profile to Home | Verified on hardware: profile selection succeeds and Home loads 10 server-provided rails without a SceneGraph runtime error |
| Playback startup | Verified on hardware: a selected title resolved to the server-selected transcode method and native VOD startup completed |
| Roku ECP | Device-information endpoint responds on port 8060 for both devices |
| Docker backend | Docker Desktop Linux-engine pipe is absent |
| Local database fallback | PostgreSQL listens on `127.0.0.1:5432`, but the configured Flux database credentials are rejected (`P1000`) |
| Backend listener | No Flux backend is listening on ports 4000 or 4001 |
| Hardware playback | Initial transcode path exercised. Audio, caption, and stream-quality controls are implemented and statically verified; the full direct/remux/transcode, caption, audio, failure, and soak matrix remains required before release approval. |

To complete the matrix, retain developer mode on representative HD and 4K Rokus, keep a reachable Flux PostgreSQL/backend stack with the Roku migrations and real media, and run every scenario above. Do not enter secrets into documentation or Git.

## Network probes

Before a device run, confirm the Roku can reach the exact origin configured in the app. The `PUBLIC_API_BASE_URL` must resolve to that reachable backend origin, never localhost. Verify bootstrap, device link, discovery, resolve, media URL, HLS playlist/segments where applicable, progress, and stop in that order.

The official [`Video` node documentation](https://developer.roku.com/dev/docs/video), [playback guide](https://developer.roku.com/dev/docs/playing-videos), and [streaming specifications](https://developer.roku.com/dev/docs/media) are the source of truth for device codec and caption behavior.
