# CONTINUE-OFF — Flux build handoff

> Purpose: if this session ends, hand THIS file to another AI/session to resume
> exactly where we left off. Keep it updated after every meaningful step.
> Read alongside: `media-server-spec.md` (product scope), `AGENTS.md` (conventions).

**Last updated:** 2026-07-05 — **ALL PHASES COMPLETE (1–10). Full build green.**

---

## TL;DR of the project

Self-hosted Plex-like media platform. Movies + TV (v1). Torrent acquisition (admin,
.torrent files only), TMDb-backed requests, invite-only auth with Netflix-style
profiles, HLS/direct-play streaming. Single VPS, Docker Compose.

**Decided stack:** Backend = Fastify + Prisma (Postgres) + BullMQ (Redis) + WebTorrent
+ FFmpeg, JWT auth. Frontend = Next.js App Router, single app, role-gated routes,
self-hosted (NOT Vercel), hls.js player. Monorepo via npm workspaces:
`shared/`, `packages/backend/`, `packages/frontend/`.

**Key domain rule:** Account (`User`, holds role) vs Profile (Netflix-style sub, unlimited,
no PIN v1). `watch_progress` + `requests` key off `profileId`. Admin checks use account role.

---

## Build phases & status

| # | Phase | Status |
|---|-------|--------|
| 1 | Foundation: monorepo, compose, Prisma schema, shared types, AGENTS.md | ✅ DONE |
| 2 | Auth + accounts + profiles + invites (backend + UI) | ✅ DONE |
| 3 | TMDb integration (backend proxy + browse) | ✅ DONE |
| 4 | Torrent acquisition (admin): upload/parse/confirm/download/organize | ✅ DONE |
| 5 | Requests (member browser, lifecycle, admin queue) | ✅ DONE |
| 6 | Library + browsing (scanner, homepage rows, detail, Play vs Request) | ✅ DONE |
| 7 | Seeding (indefinite, stats, manual stop) | ✅ DONE |
| 8 | Streaming (direct play + range; FFmpeg→HLS; concurrent sessions) | ✅ DONE |
| 9 | Notifications (Discord + SMTP fan-out service, triggers, settings UI) | ✅ DONE |
| 10 | Hardening (auth on all routes, zod validation, path-traversal safety, prod) | ✅ DONE |

---

## ✅ Done so far (files that exist and are considered stable)

Root (authored directly):
- `package.json` — npm workspaces (shared, packages/backend, packages/frontend) + scripts
- `.gitignore`, `.env.example` (all env vars documented), `docker-compose.yml`
  (postgres:16, redis:7, backend, frontend; volumes: pgdata, redisdata, media, downloads, transcode)
- `AGENTS.md` — conventions + domain rules (living doc)
- `packages/backend/prisma/schema.prisma` — FULL data model, profile-aware. THE contract.
  Models: User, Profile, Invite, MediaItem, Episode, Torrent, Request, WatchProgress,
  NotificationSettings. Enums: Role, MediaType, TorrentStatus, RequestStatus.
- `shared/` (`@flux/shared`) — package.json, tsconfig, `src/index.ts` = all API DTOs + enums.
  Both backend and frontend import wire types from here.
- git initialized (no commits yet — commit only when user asks).

## ✅ Phases 2–3 delivered (backend + frontend, via parallel agents)

- **Backend** (`packages/backend/`): Fastify app, config (zod fail-fast), db/redis/jwt/errors
  libs, auth plugin (requireAuth/requireAdmin/requireProfile), server.ts + idempotent
  bootstrap-admin seed, BullMQ queue+worker wiring (processors are stubs). Modules IMPLEMENTED:
  auth (invite-gated signup w/ atomic single-use consume, argon2id login), profiles
  (list/create/delete/activate→new JWT, refuses last-profile delete), invites (admin
  create/list), tmdb (server-side proxy: search + detail w/ credits/videos/genres,
  in-memory TTL cache, inLibrary annotation). Dockerfile (node:20-bookworm-slim + ffmpeg).
- **Frontend** (`packages/frontend/`): Next.js 16.2 App Router, standalone output. Typed
  api client, JWT in localStorage (base + profile-scoped token; documented XSS trade-off,
  backend re-verifies), client-side route guards. FUNCTIONAL: login, signup (invite prefill
  from ?code=), profile picker (activate/create), admin Invites (list/create/copy).
  PLACEHOLDERS (routed, TODO-marked): member home/browse/library/[id]/watch/[id];
  admin torrents/requests/settings. Dockerfile (standalone, non-root).

## ✅ Integration pass — GREEN

- `npm install` (root workspaces) ✓ · `prisma generate` (client v5.22.0) ✓
- `@flux/shared` builds ✓ · backend typecheck + `tsc` build ✓ · frontend typecheck + `next build` ✓ (12 routes)
- Initial migration created & committed: `packages/backend/prisma/migrations/20260705071931_init/`
- Local `.env` created (gitignored, dev secrets). `TMDB_API_KEY` still BLANK — must be filled to test TMDb.

### Fixes applied during integration (already done — don't redo)
- BullMQ×ioredis duplicate-types clash → BullMQ now gets a plain connection-options object
  (`bullConnection` in `src/lib/redis.ts`), parsed from `REDIS_URL`, not a shared instance.
- Removed backend tsconfig `paths` override for `@flux/shared` (was causing rootDir violation);
  it now resolves via the built workspace package. Build order: shared → backend.
- Typed the Fastify error handler param as `FastifyError` in `src/lib/errors.ts`.

---

## 🟡 Phase 4 (torrents) — EXACT CURRENT STATE

### Library versions verified (against npm registry + GitHub READMEs)
- `webtorrent@^3.0.16` — **ESM-only, requires Node ≥22** (this is why we bumped to Node 22).
  API: `new WebTorrent()`; `client.add(buffer, { path }, torrent => {})`; torrent props
  `progress`(0..1), `downloadSpeed`, `uploadSpeed`, `downloaded`, `uploaded`, `numPeers`,
  `length`, `ratio`, `timeRemaining`(ms), `done`; event `'done'`; `torrent.files[]` = {name,path,length};
  `torrent.destroy()` stops+keeps files; `client.remove(infoHash, { destroyStore:true })` deletes files.
- `parse-torrent@^11.0.21` — ESM-only, default export; parse a Buffer → {infoHash,name,length,
  files:[{name,path,length,offset}]}. (We `await` it to be version-safe.)
- `parse-torrent-title@^3.0.1` — ships TS types; `import { parse } from 'parse-torrent-title'`.

### ✅ Frontend torrents UI — DONE (agent, builds green)
`packages/frontend`: `lib/format.ts` (bytes/speed/duration/eta helpers), `components/torrents/`
(`UploadConfirm.tsx`, `TorrentDashboard.tsx` w/ 2s polling + AbortController, `TorrentsAdmin.tsx`),
`app/admin/torrents/page.tsx` (real UI, still admin-gated), api.ts methods (`uploadTorrent`
multipart, `searchTmdb` mapping MOVIE|SHOW→movie|tv, `confirmTorrent`, `listTorrents`,
`getTorrent`, `stopTorrent`, `removeTorrent`), globals.css additions. typecheck + `next build` PASS.

### 🟡 Backend torrent engine — PARTIAL, NOT COMPILING
Changes already made:
- `packages/backend/package.json` — added deps webtorrent, parse-torrent, parse-torrent-title,
  @fastify/multipart; added `engines.node >=22`. **`npm install` NOT yet run** — do it first.
- `packages/backend/Dockerfile` — base image node:20 → **node:22**-bookworm-slim.
- root `package.json` engines → node >=22.
- `src/types/torrent-libs.d.ts` — ambient decls for webtorrent + parse-torrent (subset we use). DONE.
- `src/lib/filename.ts` — DONE. guessFromTorrentName / guessFileEpisode / isVideoFile / baseName / fileExtension.
- `src/lib/media-paths.ts` — WRITTEN but has **ONE BUG TO FIX**: in `sanitizeSegment`, the regex
  is `/[<>:"/\\|?* -]/g` which wrongly strips spaces AND hyphens (turns "Spider-Man"→"SpiderMan").
  FIX: change it to remove only illegal FS chars + control chars, e.g. `/[<>:"/\\|?*\x00-\x1f]/g`
  (keep spaces/hyphens; the later `.replace(/\s+/g,' ').trim()` handles whitespace). (Repeated
  Edit attempts on this exact line failed in-session due to a matcher quirk — just open the file
  and hand-edit line ~18, or rewrite the function.)

### ⏭️ Backend torrent engine — REMAINING WORK (build sequentially)
1. **Fix the media-paths regex bug above.**
2. `src/lib/webtorrent.ts` — lazy WebTorrent client singleton. Helpers: add(buffer, downloadDir,
   onDone/onError), live-stats lookup by infoHash (read from `client.torrents`), stopSeeding
   (torrent.destroy, keep files), removeTorrent(infoHash, deleteFiles→destroyStore). Persist raw
   .torrent bytes to `media-paths.torrentFilePath(infoHash)` for seed-resume on boot.
3. `src/modules/torrents/torrents.schema.ts` (zod for ConfirmTorrentRequest), `torrents.service.ts`
   (parseUpload→TorrentParseResult using parse-torrent + filename guesses + store bytes;
   confirm→create Torrent row + add to engine; list/get overlay live stats onto DB rows; stop; remove),
   `torrents.routes.ts` (ADMIN-only via `app.requireAdmin`; register `@fastify/multipart` in this
   plugin scope; POST `/upload` multipart field `file`, POST `/confirm`, GET `/`, GET `/:id`,
   POST `/:id/stop`, DELETE `/:id`). Replace the stub `torrents.routes.ts`.
4. `src/modules/torrents/postprocess.ts` + wire into `src/jobs/worker.ts` `processTorrentPostprocess`:
   on 'done' set status PROCESSING + enqueue job → COPY (NOT move — see disk note) & rename files
   into library via media-paths (movies: pick largest video file; TV: use confirmed fileMapping),
   fetch TMDb detail (reuse `tmdb.service.getDetail`) to populate MediaItem, upsert MediaItem on
   (tmdbId,type) + create Episode rows, set Torrent SEEDING + seedingSince, fulfill matching
   requests (tmdbId, status PENDING/APPROVED/DOWNLOADING → FULFILLED) + call notify stub.
5. Add notify stubs in `src/modules/notifications/` (`notifyNewRequest`, `notifyRequestFulfilled`
   — no-op/log now, real impl in Phase 9) and call from postprocess + (Phase 5) request creation.
6. Seed-resume on boot: in `src/index.ts` after startWorkers, re-add torrents with status
   DOWNLOADING/SEEDING from their stored .torrent bytes so seeding survives restarts.
7. `npm install`, then `npm run typecheck --workspace @flux/backend` until green; then full build.

### ⚠️ Key design decision (disk): COPY, don't move
Seeding needs WebTorrent's original files to stay in `DOWNLOAD_ROOT`. So post-processing COPIES
(renames) files into `MEDIA_ROOT` and leaves the download copy for seeding (≈2× disk while seeding).
`stopTorrent` keeps the download copy; `removeTorrent(deleteFiles=true)` frees it; library copy persists.
`downloads` and `media` are separate compose volumes (different filesystems) so hardlinks (EXDEV) aren't an option.

### API contract the frontend already expects (match exactly)
`POST /api/torrents/upload` (multipart `file`) → TorrentParseResult · `POST /api/torrents/confirm`
(ConfirmTorrentRequest) → TorrentDTO · `GET /api/torrents` → TorrentDTO[] · `GET /api/torrents/:id`
→ TorrentDTO · `POST /api/torrents/:id/stop` → TorrentDTO · `DELETE /api/torrents/:id` → 204.
(Frontend also uses existing `GET /api/tmdb/search?q=&type=movie|tv` for the confirm match step.)

### After Phase 4
Continue Phases 5→10 per the table. Keep updating THIS file + AGENTS.md.

## ⚠️ Gotchas / decisions to remember

- Windows dev host; paths use backslashes in shell but forward slashes inside containers.
- Media/download/transcode roots are container paths (`/data/...`) bind-mounted via compose volumes.
- Never commit `.env`, media, or `.torrent` files (gitignored).
- TMDb API key stays server-side — frontend hits our `/api/tmdb/*` proxy, never TMDb directly.
- Path-traversal safety is REQUIRED on all streaming/media/download path handling (Phase 8/10).
- Concurrent transcode sessions must use per-session output dirs (no collisions) — Phase 8.
- No commits made yet; user hasn't asked to commit/push.
- **Prisma 5.22 pinned**; 7.8 is available (major). Deferred to avoid mid-build breakage — revisit before v1 ship.
- **npm audit**: 2 moderate, both a transitive build-time PostCSS advisory via Next's toolchain
  (GHSA-qx2v-qp2m-jg93). `npm audit fix --force` would downgrade Next to v9 — DO NOT. Not
  runtime-exploitable (we never stringify untrusted CSS). Left as-is intentionally.
- Phase numbers in some backend `// TODO(phase N)` code comments predate the canonical table
  above (e.g. code says torrents=phase5); trust THIS file's table, not the inline numbers.
- Throwaway postgres (`flux-migrate-pg`, host port 5433) was used to create the migration, then
  removed. The committed compose does NOT expose Postgres to the host (security) — use the same
  throwaway pattern, or `docker compose exec backend npx prisma migrate dev`, for future migrations.
