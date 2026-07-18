# Flux Roku repository audit

Audit date: 2026-07-17  
Branch and revision: `feat/roku-app` at `797f6ac`  
Working tree at audit start: clean

## Scope and conclusions

Flux does not currently contain a Roku application. The repository is a compact TypeScript monorepo with a browser client, a Fastify API, a shared wire-contract package, and a separate Android WebView client. The Roku client should be added as `apps/roku` while Roku-specific aggregation and playback-session behavior should extend the existing backend. It must not reproduce the browser's playback decisions in BrightScript.

The current backend already provides useful foundations: profile-scoped media and progress data, FFprobe-backed media analysis, HTTP byte-range streaming, on-demand HLS remux/transcode, TMDb enrichment, account-disable enforcement, and short-lived Cast receiver grants. It does not provide device linking, refresh tokens, Roku bootstrap/version/config contracts, signed Roku playback sessions, paged libraries, converted subtitle resources, intro/credits markers, or a next-episode playback API.

## Repository structure

| Area | Current implementation | Roku consequence |
| --- | --- | --- |
| Root | npm workspaces; Node 22 minimum | Add Roku scripts without making BrightScript an npm workspace package. |
| `shared` | `@flux/shared`, strict TypeScript DTOs in `shared/src/index.ts` | Add every backend Roku wire shape here first. Rebuild shared before backend verification. |
| Backend | Fastify 5, TypeScript, Zod, Prisma 5 | Add modules under `packages/backend/src/modules`, following current route/service separation. |
| Frontend | Next.js 16 App Router, React 19, handwritten CSS | Use it as the visual and product-behavior reference only. |
| Database | PostgreSQL 16 through Prisma | Device grants, refresh credentials, and playback sessions need schema-backed models. |
| Jobs/cache | BullMQ and Redis 7 | Existing acquisition jobs use Redis; Roku request handling does not need a new queue initially. |
| Android | Java WebView shell with Cast and APK update bridge | Reuse API and Cast security concepts, not its UI or self-update mechanism. |
| Infrastructure | Docker Compose; frontend, backend, PostgreSQL, Redis, Transmission | Backend uses host networking in Compose and expects nginx to route `/api/` to port 6948. |

There is no repository `AGENTS.md`. The root README documents the current conventions: strict TypeScript, shared DTO ownership, Prisma migrations for database changes, path containment for media files, and environment-only secrets.

## Backend and infrastructure

The API is mounted beneath `/api` in `packages/backend/src/server.ts`. Current modules are auth, profiles, invites, TMDb, library, torrents, requests, streaming, Cast, Android app releases, notifications, and admin control. Error responses are normalized by `packages/backend/src/lib/errors.ts`.

Persistent media lives under `MEDIA_ROOT`; Transmission downloads use `DOWNLOAD_ROOT`; HLS output uses `TRANSCODE_ROOT`; Android artifacts use `ANDROID_RELEASE_ROOT`. `safeJoin` protects media and transcode paths. Docker volumes back the database, Redis, Transmission state, downloads, media, and transcode cache. The deployment assumes nginx sends the website to port 4938 and `/api/` to port 6948. `PUBLIC_API_BASE_URL` exists for TV-reachable Cast URLs and can also anchor Roku bootstrap/link URLs.

Transmission is configured as a sidecar and reached through `TRANSMISSION_RPC_URL`, `TRANSMISSION_USER`, and `TRANSMISSION_PASS`. Torrent completion hands content to post-processing and media analysis. FFmpeg and FFprobe are installed in the backend image.

## Authentication and profiles

Website login is email/password through `POST /api/auth/login`; signup is invite-gated. Argon2id hashes passwords. Successful login returns a JWT, account, and profiles. `POST /api/profiles/:id/activate` returns a new JWT containing `activeProfileId`. Member media routes require that profile claim.

JWT expiry is configured by `JWT_EXPIRES_IN` and defaults to seven days. There is no refresh-token endpoint, token rotation, token identifier, session table, logout revocation list, or device authorization flow. Disabling a user is checked by normal authenticated guards and forces rejection, but stream query-token handling does not perform the same enabled-account database check. Profiles are per account and isolate requests/progress; profile PINs do not exist.

The browser stores `flux.token` in local storage. Android reads that WebView value only to request a Cast grant. A Roku registry entry can store an opaque device access token, but the new design must keep private device codes, raw playback URLs, and passwords out of the registry and logs.

See `docs/roku-authentication-audit.md` for the detailed gap and proposed extension.

## Existing media APIs

| Need | Current route or service | Status for Roku |
| --- | --- | --- |
| Home | `GET /api/library/home` | Useful source data; needs Roku row DTO and independent row errors. |
| Library | `GET /api/library/items?type=` | Returns the full matching library; needs pagination, sorting, and filters. |
| Media detail | `GET /api/library/items/:id` | Useful base with episodes and profile progress. |
| Search | `GET /api/tmdb/search` and people search | Searches TMDb, not a unified local Roku result contract. |
| TMDb detail | `GET /api/tmdb/:type/:tmdbId` | Provides cast, crew, reviews, trailer, ratings, seasons, and similar titles. |
| Season metadata | `GET /api/tmdb/tv/:tmdbId/season/:season` | Useful enrichment; local availability must still come from the library. |
| Requests | `POST/GET /api/requests` | Profile-scoped and permission-compatible; needs a TV-oriented response surface. |
| Progress | `POST /api/library/progress` | Profile-scoped; completion threshold is 92 percent. |
| Playback info | `GET /api/stream/:id/info` | Browser-oriented capability decision; insufficient for Roku. |
| Direct stream | `GET /api/stream/:id` | Authenticated, byte-range capable, and reusable behind scoped sessions. |
| HLS | `GET /api/stream/:id/hls/index.m3u8` plus wildcard assets | Reusable engine; needs playback-session ownership and expiry. |
| Artwork | Direct TMDb URLs assembled by clients | Needs backend-provided Roku-sized URLs and a stable image contract. |

There are no favorites/watchlist tables, intro markers, credits markers, playback-session records, subtitle conversion routes, or server-side next-episode resolver. Episode ordering exists and can support those features without duplicating rules in Roku.

## Website experience relevant to television

The member UI includes a cinematic detail hero, poster grids and rails, a library, profile picker, TMDb browsing/search, season and episode lists, progress indicators, error/loading/empty states, and a custom player. `/home` currently redirects to `/library`; the older home implementation remains in the file and uses server home rows. Roku should use the backend row contract directly rather than copy that redirect.

The web player supports direct playback or HLS, resume, seek, progress heartbeats, quality choice, audio-stream choice, retry, and next-episode prewarming. It does not currently implement actual subtitle selection, server intro/credits markers, an Up Next countdown, or automatic episode transition. Those capabilities therefore require backend work as well as Roku UI.

See `docs/roku-design-system.md` for the token and component translation.

## Android client audit

The Android application is not native media UI. `MainActivity` hosts a WebView at a compile-time personal Flux domain, retains WebView cookies/local storage, and exposes a narrow JavaScript bridge for Cast and updates. It has network/offline and SSL error surfaces, browser history back behavior, fullscreen WebView video, and state restoration.

Cast uses `POST /api/cast/sessions` with the selected profile JWT. The backend returns a short-lived, media-scoped receiver URL chosen as direct MP4/H.264/AAC or HLS. This is the best existing pattern to generalize into durable Roku playback sessions.

Android update management fetches `/api/app/android/latest`, verifies version, same-origin URL, size, SHA-256, package identity, and signing certificate, then invokes the Android package installer. None of that package-install behavior applies to Roku. Roku must only consume compatibility/version metadata and rely on Roku-managed channel updates.

The Android client has no configurable server entry, device-code login, native profile selection, native progress system, native subtitle selection, or independent playback resolver. It cannot be used as Roku UI architecture.

## Tests and runtime audit

No repository unit or integration test suite exists; the only file matching `test`/`spec` naming is the Android release manifest. Build and typecheck scripts exist for all npm workspaces. Roku validation and backend contract tests must therefore establish the first automated test harness.

The audit machine has Node 24.13.1, npm 11.8.0, FFmpeg/FFprobe 8.0.1, and a PostgreSQL listener on port 5432. Docker Desktop's Linux engine was unavailable at audit time, and no backend/frontend/Redis/Transmission service was listening. There is no connected Roku device information. This prevents claiming real Flux-hosted playback or hardware navigation verification until those dependencies are available.

## Architectural decisions from the audit

1. Add Roku DTOs to `@flux/shared`; never redefine them independently in backend tests or documentation.
2. Add a dedicated backend Roku module for presentation-shaped home/library/search/detail contracts.
3. Add persistent device authorization and refresh/session records rather than minting untracked long-lived JWTs.
4. Generalize scoped Cast playback concepts into expiring playback sessions and keep codec/mode selection in the backend.
5. Reuse current direct-range and HLS engines behind the new playback session contract.
6. Keep the existing web and Android clients working; new routes are additive and shared services are refactored only where needed to centralize truth.
7. Treat requests as feature-flagged because the existing permission model is account/profile based and not every server will want TV requests enabled.
8. Record hardware, media, and Roku Store validation as evidence-driven release gates; never infer them from static builds.

