# CONTINUE-OFF — Flux build handoff

> Purpose: if this session ends, hand THIS file to another AI/session to resume
> exactly where we left off. Keep it updated after every meaningful step.
> Read alongside: `media-server-spec.md` (product scope), `AGENTS.md` (conventions).

**Last updated:** 2026-07-05 — Phases 1–3 DONE and integration pass GREEN (installs,
prisma generate, both builds, initial migration). Next up: Phase 4 (torrents).

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
| 3 | TMDb integration (backend proxy + browse) | ✅ DONE (backend proxy; browse UI is Phase 6) |
| 4 | Torrent acquisition (admin): upload/parse/confirm/download/organize | ⬜ TODO |
| 5 | Requests (member browser, lifecycle, admin queue) | ⬜ TODO |
| 6 | Library + browsing (scanner, homepage rows, detail, Play vs Request) | ⬜ TODO |
| 7 | Seeding (indefinite, stats, manual stop) | ⬜ TODO |
| 8 | Streaming (direct play + range; FFmpeg→HLS; concurrent sessions) | ⬜ TODO |
| 9 | Notifications (Discord + SMTP fan-out service, triggers, settings UI) | ⬜ TODO |
| 10 | Hardening (auth on all routes, zod validation, path-traversal safety, prod) | ⬜ TODO |

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

## ⏭️ NEXT ACTIONS (do these when resuming)

1. (Optional) End-to-end smoke test: `docker compose up --build`, hit `GET /health`, sign up
   with an admin-generated invite, pick a profile. Needs a real `TMDB_API_KEY` for TMDb routes.
2. **Proceed to Phase 4 (torrents)** — build sequentially (too interdependent to fan out):
   parse .torrent (use `parse-torrent`), filename guess (`parse-torrent-title` or similar —
   VERIFY), TMDb confirm step, WebTorrent download, progress polling, on-complete
   rename/move + season-pack split into `/data/media/...`, fulfill linked request.
5. Continue Phases 5→10 per the table. Keep updating THIS file + AGENTS.md.

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
