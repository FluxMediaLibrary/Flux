# Flux Roku API gap report

## Route matrix

| Required route | Existing source | Gap/action |
| --- | --- | --- |
| `GET /api/client/bootstrap` | Health, config, Android release data | New validated public bootstrap contract with server identity, API version, auth methods, features, branding, and compatibility. |
| `POST /api/auth/device` | Email/password login only | New device-authorization creation with hashed secret and poll policy. |
| `POST /api/auth/device/status` | None | New bounded polling and token issue flow. |
| Website device approval | Existing authenticated website | New link page and approve/deny backend route. |
| `POST /api/auth/refresh` | None | New rotating refresh tokens bound to a device session. |
| `POST /api/auth/logout` | None | New session revocation. |
| `GET /api/roku/profiles` | `GET /api/profiles` | Roku alias/adapter with device-token purpose enforcement. |
| `POST /api/roku/profiles/select` | `POST /api/profiles/:id/activate` | Adapter returning a device-session-aware profile token. |
| `GET /api/roku/home` | `GET /api/library/home` | Presentation-shaped hero/rows, backend artwork URLs, stable layouts, row order, and row-level errors. |
| Movie/show libraries | Full `GET /api/library/items` | New pagination, sort, direction, genre, watched, and search filters. |
| `GET /api/roku/search` | TMDb search only | Unified local/library and optional requestable TMDb results with pagination/debounce-friendly semantics. |
| `GET /api/roku/media/:id` | Library detail plus TMDb detail | Aggregate local availability/progress with metadata, actions, artwork, and similar titles. |
| Seasons/episodes | Library detail and TMDb season | New paged/season-specific adapters; no whole-show reconstruction on device. |
| Playback resolve | Browser info plus Cast sessions | New capability-aware, session-scoped mode decision and expiring URL. |
| Playback progress | Library progress | New playback-session wrapper around the existing progress service. |
| Playback stop | None | New idempotent session close and resource cleanup. |
| Playback refresh | None | New URL/token refresh for an active authorized session. |
| Playback next | Episode ordering exists | New server-authoritative next-episode response. |
| Roku version | Android latest manifest | New Roku compatibility metadata only; never a package download/install instruction. |
| Roku config | None | New validated flags, row ordering, playback defaults, announcements, and log level. |

## Shared contract additions

All new requests and responses belong in `shared/src/index.ts`. The initial groups are bootstrap/branding/features, device authorization and refresh, Roku profiles, artwork/media rows, paged libraries/search/details, device capabilities, playback resolution/session/tracks/markers/next episode, progress events, version/config, and standardized Roku errors.

The existing `PlaybackInfoDTO` remains a browser contract. Common media analysis and mode-decision helpers should be shared within the backend, while client responses remain explicit so browser changes cannot silently break Roku.

## Database additions

Phase 2 requires persistent device authorizations and device sessions. Playback requires expiring playback sessions. Intro/credits support requires real marker storage or a deliberately disabled feature flag until marker ingestion exists. Preferences can begin in the Roku registry but remembered profile track preferences should ultimately be server-owned if cross-device consistency is required.

## Backend module plan

- `modules/client`: public bootstrap and compatibility validation.
- `modules/auth`: extend current auth with device authorization, approval, refresh rotation, logout, and token-purpose checks.
- `modules/roku`: authenticated profiles, home, libraries, search, details, seasons, episodes, version, and config.
- `modules/playback`: centralized device capability decision, persistent playback sessions, progress, refresh, stop, next episode, and subtitle resources.
- Existing `streaming`: retain byte-range and FFmpeg mechanics but require scoped playback grants for Roku routes.

## Compatibility policy

The current website and Android routes remain supported. The Roku API starts at version 1 and bootstrap exposes the supported API range. Additive response fields are allowed; removing or changing required fields requires a new API version. The backend should support at least the current and immediately previous public Roku client version whenever practical.

## Phase ordering

1. Shared DTOs, schema, migrations, token-purpose enforcement, and contract tests.
2. Bootstrap, device linking, refresh/logout, and profile selection.
3. Server-shaped discovery/detail APIs with pagination.
4. Playback sessions and resolver backed by existing direct/HLS engines.
5. Tracks, subtitles, markers, next episode, refresh/stop cleanup.
6. Version/config, diagnostics, performance/security verification, and release documentation.

