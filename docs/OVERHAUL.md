# Flux Platform Overhaul — Working Record

This document is the running log for the platform overhaul driven by
`Flux Complete Overhaul Master Prompt.md`. It records what the audit found,
what changed, why, what was verified, and what is still open. Keep it current.

---

## Stage 1 — Repository audit (2026-09-15)

### What Flux actually is

Flux is **not** a folder-scanning media server like Plex/Jellyfin. Media enters
the library through **acquisition**: a TMDb-matched request → torrent (via a
Transmission sidecar) → post-process copies the file into an organised layout
under one of `MEDIA_ROOTS` → `MediaItem`/`Episode` rows are created. There is no
`Library` model, no folder scanner and no file watcher. The "library" is the set
of `MediaItem` rows; `admin/library` is a health view over them.

Consequences for the master prompt:

- "Create libraries → pick folder → scan" has no existing foundation. Flux's
  equivalent of a library is a *media root* (`MEDIA_ROOTS`) with the fixed
  `movies/` + `tv/` layout. The setup wizard is built around that reality.
- A **library import scan** (index files already present under a media root)
  is a genuine gap and is the closest useful equivalent to "scan a folder".

### Monorepo map

| Path | What | Notes |
|---|---|---|
| `shared/` | `@flux/shared` DTO/contract types (1 file, ~1300 lines) | consumed by backend + frontend |
| `packages/backend/` | Fastify 5 + Prisma 5 + BullMQ, TypeScript ESM | ~11.6k lines |
| `packages/frontend/` | Next.js 16 App Router, React 19, plain CSS (`globals.css` 6k lines) | ~19k lines |
| `apps/desktop/` | Electron shell that loads a remote Flux URL | separate release pipeline |
| `android/` | Java WebView shell + Cast SDK + native bridge (`MainActivity.java` 1k lines) | TWA-style; APKs in `releases/android` |
| `apps/roku/dist/*.zip` | Roku channel **source only survives inside the zips** (v1.0.11 latest); `roku-channel/` was deleted from the tree; backend Roku routes lived on `feat/roku-app` and were removed by migration `20260729164000_remove_roku_support` | revival = restore from zip + re-add device-link API |

### Backend modules

- `config.ts` — zod-validated env. Contains **deployment** config (DB, Redis, ports,
  roots) *and* **policy** config that duplicates DB settings
  (`MEDIA_SPILLOVER_THRESHOLD_BYTES`, `FLUX_SERVER_NAME`, `TMDB_API_KEY`, intro tuning).
- `modules/settings` — `ServerSettings` singleton row (general / downloads /
  playback / tmdb key), `DownloadClient`, `QualityProfile`. `getServerSettings()`
  does a Prisma **upsert on every read** and is called on every stream request.
- `lib/media-paths.ts` — root selection + traversal-safe path building.
- `modules/torrents` + `lib/webtorrent.ts` (Transmission RPC) + `jobs/torrent-poller.ts`
  + `modules/torrents/postprocess.ts` (import into library).
- `modules/streaming` — direct play (range) + on-demand HLS (single or adaptive),
  in-memory session map with idle cleanup, trickplay, Cast-optimised HLS.
- `modules/media-segments` — intro/recap/credits detection (Chromaprint) — keep.
- `modules/admin` — info/health/library repair/storage/cleanup/users/audit.
- `modules/cast` — Chromecast session grants (in-memory) + receiver tokens.
- Auth: JWT (`jsonwebtoken`), argon2, invite-only signup, permission strings,
  Redis rate limiting on login/signup. Streams accept `?token=`.

### Confirmed bugs / debt found during audit

1. **Storage threshold split-brain (Phase 4 bug, confirmed).**
   `Settings → Downloads → minimumFreeSpaceGb` is persisted in `ServerSettings`
   and used *only* for the download-root check in `torrents.service.ts`.
   `selectMediaRoot()` (which decides which drive imported media lands on)
   reads `config.MEDIA_SPILLOVER_THRESHOLD_BYTES` from the **environment**
   (default 10 GB). Changing the setting in the UI therefore never affects
   where media is placed. Root selection also ignores the size of the incoming file.
2. **Movie import placement is computed twice** in `postprocess.ts`
   (once to copy, once for analysis). Because selection is free-space based
   the second call can pick a different root, so analysis/trickplay can run
   against a path that does not exist.
3. `completedImportBehavior = MOVE` still `copyFile`s then deletes torrent
   data through Transmission — works but doubles peak disk usage and is slow
   across the same filesystem.
4. `getServerSettings()` performs a write (`upsert`) on every call, including
   per HLS segment/manifest request path.
5. No first-run detection: the admin is seeded from env vars; a fresh install
   with no `BOOTSTRAP_ADMIN_*` has no way to create an admin from the UI.
6. Frontend `tsc` fails on stale `.next/dev/types` referencing a deleted
   `app/downloads/page` (generated file, not source). `next build`/dev regenerates it.
7. Security advisories (GitHub Dependabot, all open):
   - **critical** `next` 16.3.0-preview.10 → RCE fixes in 16.3.3
   - high `sharp` 0.35.3 → 0.35.4; high `fast-uri` (fastify transitive) → 3.1.6;
     medium `fastify` 5.9.0 → 5.12.1 (X-Forwarded spoofing under trustProxy —
     relevant, we set `trustProxy: true`); high/medium `nodemailer` 7 → 9.1.1;
     high `nanoid` (postcss transitive) → 3.3.18; high `js-yaml`, `@xmldom/xmldom`
     (electron-builder transitive, desktop build-time only); medium
     `baseline-browser-mapping` (next transitive).
8. Admin "Storage" page reports only *primary* root percentage for health and
   has no notion of reserved space, writability, or per-root media counts.
9. Roku source is not in the tree (only packaged zips); Android APKs and a
   `smoke-release/` unpacked Electron build are committed under `apps/desktop`.

### What already works well (preserve)

- Torrent lifecycle (confirm → download → postprocess → seed/stop), retries,
  existing-data detection, request fulfilment linking by `tmdbId+type`.
- Playback decision (direct / remux / transcode) with DB-cached ffprobe
  results; HLS session dedupe, idle cleanup and stderr capture; Cast HLS.
- Settings workspace already uses top tabs with dirty tracking.
- Admin control centre with permission-gated sections, audit log.
- Intro detection + media segments, trickplay thumbnails.

---

## Implementation plan (ordered)

1. **Canonical configuration** — split env into *deployment* (immutable per
   container) vs *policy* (DB `ServerSettings`, editable in UI). Cache the
   settings row in-process with invalidation on write; publish change events
   over Redis so every consumer (and every backend replica) refreshes.
   Add `setupCompleted` + storage policy fields.
2. **Storage** — single `storage.service.ts` that owns volume inventory,
   reserved-space policy, required-bytes-aware placement, writability probes
   and diagnostics. `media-paths` delegates to it. Fix bugs 1–3.
3. **First-run setup** — public `/api/setup/status`, guarded
   `/api/setup/admin` (only when zero users), `/api/setup/complete`; `/setup`
   wizard in the web UI; root redirect goes there until completed.
4. **Library import scan** — background job that indexes existing files under
   the media roots (`movies/`, `tv/`), matches TMDb, analyses media, and
   reports progress/errors to the admin library page.
5. Downloads/requests/playback diagnostics, transcoding HW detection.
6. Security dependency updates (item 7 above) with targeted verification.
7. Web UI, Roku, mobile/casting, tests, validation — see later stage entries.

---

## Change log

_(appended per stage below)_

### Stage 2–4 (2026-09-15) — canonical configuration, storage, first-run setup

**Changed**

- `settings.service.ts`: `getServerSettings()` is now a cached read
  (30 s TTL, invalidated on every write in-process and across processes via a
  Redis pub/sub bus in `lib/settings-events.ts`). All writers go through
  `writeServerSettings()` which publishes the changed sections. No more
  upsert-per-read.
- `ServerSettings` gained `storagePlacementStrategy`, `preferredMediaRoot`,
  `setupCompleted`, `setupCompletedAt` (migration
  `20260915000000_setup_and_storage_policy`; marks existing installs complete).
- New `lib/storage.ts` — the only owner of volume inspection (statfs + a real
  write probe), the reserve policy, required-bytes-aware placement
  (`evaluatePlacement`, pure and unit-tested), download admission, and the
  `StorageOverviewDTO` / placement-plan diagnostics.
- `lib/media-paths.ts`: `moviePlacement`/`episodePlacement` take an explicit,
  already-selected root; `selectMediaRoot({ requiredBytes, affinityRoot })`
  delegates to the storage service. `MEDIA_SPILLOVER_THRESHOLD_BYTES` removed
  from `config.ts` (boot warning if still set).
- `postprocess.ts`: root chosen **once** per import with the real byte size
  (season packs sum their mapped files and prefer the root that already holds
  the show); files are written to a `.flux-partial` sibling and renamed into
  place; `MOVE` uses `rename` with copy+unlink fallback across devices.
  Analysis/trickplay reuse the same placement (fixes the double-selection bug).
- `torrents.service.ts`: download admission uses the storage service with the
  torrent's still-missing bytes (`detectExistingData().missingBytes`).
- Settings DTO: `downloads.minimumFreeSpaceGb` moved to
  `storage.reservedFreeSpaceGb` (same DB column); new `storage` and `setup`
  sections. Settings UI gained a **Storage** tab; the Downloads tab no longer
  duplicates the threshold.
- Admin **Storage** page rewritten around `GET /api/admin/storage` (per-volume
  reserve/usable/write health/media counts) plus a "placement check" dry run
  (`GET /api/admin/storage/plan?bytes=`).
- New `modules/setup` (`/api/setup/status|admin|snapshot|test-tmdb|complete`)
  and the `/setup` wizard (Welcome → Administrator → Server → Storage →
  Metadata → Downloads → Review). Root and login pages redirect to `/setup`
  until it is complete. `TMDB_API_KEY` is optional in the environment now;
  TMDb calls fail with `TMDB_NOT_CONFIGURED` instead of a 502 when absent.
- Security: `enforceRateLimit` (previously unused) now guards login
  (per-IP + per-account), signup and initial-admin creation.
- `lib/redis.ts` uses `lazyConnect` so unit tests can import modules without a
  live Redis.

**Verified**

- `tsc --noEmit` clean for shared, backend, frontend; `eslint` no new warnings.
- Backend tests: 39 passing (6 new storage placement tests, existing-data
  tests updated for `missingBytes`).

### Stage 5 — library import scan

- `modules/library/library-scan.service.ts` + pure matcher
  `library-scan-match.ts` (unit-tested). Singleton BullMQ job, Redis-persisted
  report, unmatched files resolvable from the admin Library page
  (`LibraryScanPanel`). Setup wizard can start it on finish. Removed the
  never-implemented transcode queue stub.

### Stage 6 — security dependencies

- next 16.3.5, fastify 5.12.4 (+fast-uri ≥3.1.6), nodemailer 9.1.1, sharp
  0.35.4, nanoid/js-yaml/xmldom/baseline-browser-mapping/brace-expansion via
  overrides + audit fix. `npm audit` clean; full Next build verified.

### Stage 7 — transcoding diagnostics and verified hardware acceleration

- `lib/transcode-capabilities.ts` parses `ffmpeg -encoders` + device nodes;
  AUTO chooses only verified encoders; explicit choices that are unusable fall
  back to software with the reason logged and shown.
- `lib/transcode-registry.ts` mirrors every HLS session (decision + reason,
  codecs, encoder, `-progress` speed/bitrate/position). `GET /api/admin/transcodes`,
  `POST …/detect`, `POST …/:id/stop`; admin Playback page shows them. Browser and
  Cast HLS paths share `startHlsSession` (Cast now honours playback settings).

### Stage 8 — request lifecycle

- `RequestDTO.stage/progress/failureReason/mediaItemId` derived on the server
  (`deriveRequestStage`, tested); shared `requestStageLabel` in `@flux/shared`;
  member cancel `DELETE /api/requests/:id`; home "Your Requests" rail.

### Stage 9 — Roku revival

- Source restored to `apps/roku/src` (1.1.0) with two client bugs fixed
  (season list array-vs-object, duplicate `shows` route key); packaging script.
- Device link (`modules/devices`) with hashed codes/refresh tokens, rate limits,
  device-scoped JWTs revoked on demand; `/link` page + Settings → Clients.
- `modules/roku` projects existing services into TV shapes and records
  `PlaybackSession` rows; WebVTT subtitle extraction route for TV/Cast.

### Stage 10 — deployment, casting, performance, logging

- Compose: `FLUX_MEDIA_PATH` host path (named volume kept as default), optional
  TMDb/admin, real health checks; `setup.sh` no longer demands TMDb/admin up
  front; backend preflight fails fast with actionable messages.
- Android: network callback re-syncs Cast state, `onStart/onResume` re-attach,
  WebView timers stay alive while casting; web shows a reconnecting banner.
- `lib/media-lite.ts`: list surfaces no longer load the full TMDb JSON per row;
  indexes on `media_items(addedAt)`/`(title)`.
- `lib/logger.ts`: one categorised pino root shared with Fastify; console.*
  removed from the backend.

## Remaining work (not done in this pass)

- **Web UI redesign (Phase 9/24/25):** no wholesale visual redesign was
  attempted because it cannot be verified without a running stack; the member
  UI already follows the Jellyfin-style direction. Candidates: consolidate the
  6k-line `globals.css` into component-scoped files, replace `<img>` with a
  sized image helper, keyboard/focus audit of the player and search overlay.
- **Library grid pagination/virtualisation:** payload is now light but still
  the whole library; add server paging + virtual grid for >5k items.
- **Roku on-device test:** the channel was validated against the API contract
  by reading every screen; it has not been sideloaded in this pass.
- **Android release:** `MainActivity` compiles (`gradle :app:compileDebugJavaWithJavac`);
  a signed release has not been produced (needs the keystore workflow).
- **Fresh-install / upgrade validation (Phase 30):** migrations are additive and
  idempotent; an end-to-end run against Docker was not executed here.
- **Admin sessions "terminate":** `PlaybackSession` rows exist for Roku; web
  heartbeats are still `WatchProgress` only.

