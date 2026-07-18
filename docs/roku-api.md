# Roku API contract

All paths are relative to the Flux backend origin. JSON account APIs use `Authorization: Bearer <device-access-token>`. Media URLs carry a short-lived playback token because Roku's `Video` node cannot attach the account authorization header to every playlist and segment request.

## Bootstrap and authentication

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/client/bootstrap` | Validate Flux identity, API compatibility, branding, and features |
| GET | `/api/clients/roku/version` | Minimum/latest Roku versions and release notes |
| GET | `/api/clients/roku/config` | Row order, feature flags, playback defaults, announcement |
| POST | `/api/auth/device` | Create a hashed, expiring device authorization code |
| POST | `/api/auth/device/status` | Poll pending/approved/denied/expired state with throttling |
| POST | `/api/auth/device/approve` | Signed-in web approval or denial |
| POST | `/api/auth/refresh` | Rotate the one-time device refresh token |
| POST | `/api/auth/logout` | Revoke the device session |

Device access tokens expire after 15 minutes. Refresh tokens are opaque, stored hashed, rotated on every use, and bound to the server-side device session. Reuse revokes the session.
Device creation, polling, approval, and refresh are additionally protected by Redis-backed rate limits.

## Profiles and discovery

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/roku/profiles` | Account profiles and resolved avatar URLs |
| POST | `/api/roku/profiles/select` | Bind a profile to the device session and rotate credentials |
| GET | `/api/roku/home` | Hero items and server-generated rows with progress |
| GET | `/api/roku/home/rows/:id` | Independently retry one failed Home row |
| GET | `/api/roku/library/movies?page=&limit=` | Stable paged movie library |
| GET | `/api/roku/library/shows?page=&limit=` | Stable paged show library |
| GET | `/api/roku/search?q=` | Local movies, shows, and episodes |
| GET | `/api/roku/media/:id` | Detail, episodes, seasons, enrichment, progress, and availability |
| GET | `/api/roku/episodes/:id` | Episode detail, runtime, progress, watched state, and availability |
| GET | `/api/roku/shows/:id/seasons` | Show season summaries |
| GET | `/api/roku/shows/:id/seasons/:season/episodes` | Episodes for one season |
| GET | `/api/roku/requests` | Active profile's request history |

Library pagination accepts `page` from 1 to 10,000 and `limit` from 1 to 60. `sort` accepts `title`, `recent`, or `year`; `direction` accepts `asc` or `desc`; an optional `genre` applies an exact genre filter; `watched` accepts `true` or `false`. Responses include `availableGenres` so the client does not infer the full filter list from one page. Search queries are trimmed and must contain 2 to 100 characters. Discovery routes require both device authentication and a selected profile.

## Playback

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/roku/playback/resolve` | Create a persistent scoped session and choose direct/remux/transcode |
| POST | `/api/roku/playback/progress` | Heartbeat and watch-progress upsert |
| POST | `/api/roku/playback/stop` | Final progress plus ended/back/error state |
| POST | `/api/roku/playback/refresh` | Extend a live session and replace an expired media URL |
| GET | `/api/roku/playback/next?sessionId=` | Resolve the next playable episode |
| GET | `/api/roku/playback/subtitles/:sessionId/:streamIndex` | Serve or convert a scoped embedded/sidecar subtitle as WebVTT |

Playback tokens contain only account/profile/session/media scope and cannot call account APIs. Stream handlers validate both the signature and the live database session. Replaced, stopped, expired, or revoked sessions are rejected. HLS transcoder processes and files are discarded after 30 minutes idle.

The response may include audio/subtitle tracks, intro/credits markers, next-episode metadata, exact duration, warnings, and a resume position. Playback markers are managed through `PUT /api/admin/library/:id/markers` and are only shown in the player during their valid time range.

## Version and error policy

The current client/server API version is `1`. Bootstrap supplies `apiVersion` and `minimumApiVersion`; the client refuses an incompatible server before authentication. The version endpoint supplies minimum/latest semantic client versions. A version below the minimum is blocking, while a version below latest is a non-blocking notice. The config endpoint supplies feature flags, row order, playback defaults, logging level, an optional announcement, and a bounded `ui.heroRotationSeconds` value. A value of `0` disables automatic hero rotation.

Errors use one stable JSON envelope:

```json
{ "error": "MACHINE_READABLE_CODE", "message": "Human-readable detail", "statusCode": 400 }
```

Validation failures are `VALIDATION_ERROR`. Authentication and profile failures use 401/403; missing or disabled resources use 404 (disabled Roku features use `ROKU_FEATURE_DISABLED`); rate limits use 429. Playback-scope failures are not retried as account refreshes. A 5xx body deliberately hides internal paths and exception details.
