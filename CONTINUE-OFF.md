# CONTINUE-OFF — Flux build handoff

> Purpose: if this session ends, hand THIS file to another AI/session to resume
> exactly where we left off. Keep it updated after every meaningful step.
> Read alongside: `media-server-spec.md` (product scope), `AGENTS.md` (conventions).

**Last updated:** 2026-07-05 (session 2) — **ALL 10 PHASES COMPLETE + post-build feature pass:**
TMDb discovery (trending/popular/genres/discover) added, `/browse` redesigned as a discovery
experience, library-detail + homepage polished, and **video playback root-caused & fixed in code**
(stream auth via `?token=`, manifest segment tokenization, per-episode HLS sessions, watch-page
mount-order fix). Full build green. ⚠️ Playback still needs real-media verification in Docker —
see `ISSUES.md` P2. Production on VPS at flux.personal.deadstudios.xyz.

---

## TL;DR of the project

Self-hosted Plex-like media platform. Movies + TV (v1). Torrent acquisition (admin,
.torrent files only) via **Transmission** (not WebTorrent), TMDb-backed requests,
invite-only auth with Netflix-style profiles, HLS/direct-play streaming. Single VPS,
Docker Compose.

**Decided stack:** Backend = Fastify + Prisma (Postgres) + BullMQ (Redis) + Transmission
(RPC via `localhost:9091`) + FFmpeg, JWT auth. Frontend = Next.js App Router, single app,
role-gated routes, self-hosted (NOT Vercel), hls.js player. Monorepo via npm workspaces:
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

## Critical architecture decisions (do NOT revert)

### WebTorrent → Transmission

**WebTorrent v3 does NOT support HTTP/UDP trackers** — only WebSocket (wss://) trackers.
Private trackers (like TD) use HTTP announce URLs. Switched to **Transmission** as a sidecar
Docker container with JSON-RPC control.

- **File:** `packages/backend/src/lib/webtorrent.ts` is now a Transmission RPC client
  (kept the filename for compatibility — rename at your own risk)
- **Transmission container:** `lscr.io/linuxserver/transmission:latest`, port 9091 (RPC,
  localhost-only), port 51413 (P2P, public)
- **RPC auth:** `admin:flux` (configurable via `TRANSMISSION_USER`/`TRANSMISSION_PASS` env)
- **Session ID:** RPC requires X-Transmission-Session-Id header — code handles 409 retries
- **Auto-start:** `TRANSMISSION_START_ON_ADD=true` + explicit `torrent-start` after `torrent-add`
  (the env var alone wasn't reliable)
- **DHT/PEX/LPD:** disabled via `transmission-settings.json` (private tracker requirement)
- **Encryption:** `encryption: 2` (required) — many private trackers reject unencrypted
- **Peer limit:** `peer-limit-global: 0, peer-limit-per-torrent: 0` = unlimited
- **Volume:** Transmission and backend share `downloads` volume mounted at `/data/downloads`

### Ports

| Service | Port | Notes |
|---------|------|-------|
| Frontend | 4938 | Next.js, served via nginx |
| Backend | 6948 | Fastify, proxied by nginx `/api` → `localhost:6948` |
| Postgres | 5432 | localhost only |
| Redis | 6379 | localhost only |
| Transmission RPC | 9091 | localhost only |
| Transmission P2P | 51413 | TCP + UDP, public |

### Backend networking: `network_mode: host`

The backend runs with **host networking** so Transmission can use the full network stack
for P2P. Postgres and Redis are exposed on `127.0.0.1` only — the backend connects via
`localhost`. DATABASE_URL and REDIS_URL are hardcoded in docker-compose.yml (not from .env).

### Auto-postprocess on completion

`listTorrents()` (called by polling every 500ms) checks for torrents at 100% and enqueues
the BullMQ `torrent-postprocess` job. Uses a `Set<string>` to prevent duplicate enqueues.

- **COPY, don't move:** postprocess copies files from `/data/downloads` → `/data/media`
  (seeding needs original files)
- **Movies:** picks largest video file, renames via `moviePlacement()`
- **TV:** uses confirmed `fileMapping` for per-episode placement + Episode upsert
- **Requests:** matching PENDING/APPROVED/DOWNLOADING requests auto-fulfilled
- **Debug:** check backend logs for `[Transmission]` and `[Torrent] Done!` messages

---

## Module inventory

### Backend (`packages/backend/src`)

| Module | Files | Notes |
|--------|-------|-------|
| `lib/webtorrent.ts` | 252 lines | Transmission RPC client (add, stats, stop, remove, resume, getTorrentFiles) |
| `lib/media-paths.ts` | moviePlacement, episodePlacement, safeJoin, torrentDownloadDir, torrentFilePath |
| `lib/filename.ts` | parse-torrent-title wrapper: guessFromTorrentName, guessFileEpisode, isVideoFile |
| `lib/errors.ts` | ApiError class with static factories (badRequest, unauthorized, forbidden, notFound, conflict) |
| `types/torrent-libs.d.ts` | Ambient decls for parse-torrent |
| `modules/auth/` | Signup (invite-gated), login (argon2id), JWT |
| `modules/profiles/` | CRUD, activate (new JWT), last-profile guard |
| `modules/invites/` | Admin create/list, atomic single-use consume |
| `modules/tmdb/` | Proxy search + detail, in-memory TTL cache, inLibrary annotation |
| `modules/torrents/` | schema, service (CRUD + live stats), routes (admin), postprocess |
| `modules/requests/` | schema, service, routes (member create/list + admin approve/reject) |
| `modules/library/` | service (homepage, detail, progress), routes |
| `modules/streaming/` | service (file resolution + HLS session), routes (direct play w/ range + FFmpeg HLS) |
| `modules/notifications/` | service (settings CRUD), routes, notify.ts (Discord webhook + SMTP stub) |
| `jobs/` | BullMQ queues + worker wiring |
| `plugins/auth.ts` | requireAuth, requireAdmin, requireProfile decorators |

### Frontend (`packages/frontend`)

| Route | Type | Notes |
|-------|------|-------|
| `/login` | Static | Login form |
| `/signup` | Static | Signup with invite code |
| `/profiles` | Static | Profile picker / create |
| `/home` | Static | Homepage: featured hero + continue watching, recently added, by genre |
| `/library` | Static | Jellyfin-style grid: all items, watched/unplayed badges, A–Z rail, type filter |
| `/browse` | Static | TMDb discovery: trending hero + popular/genre grid, secondary search |
| `/library/[id]` | Dynamic | Movie/TV detail with backdrop, episodes, Play button |
| `/watch/[id]` | Dynamic | hls.js player with progress tracking |
| `/admin/torrents` | Static | Upload, confirm, dashboard |
| `/admin/invites` | Static | Invite management |
| `/admin/requests` | Static | Request queue with approve/reject |
| `/admin/settings` | Static | Discord webhook + SMTP config |
| Components | `TorrentDashboard`, `UploadConfirm`, `TorrentsAdmin`, `MemberNav`, `AdminNav`, `Guards`, `PlaceholderPage` |

### Infrastructure files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | postgres, redis, transmission, backend (host net), frontend |
| `transmission-settings.json` | DHT/PEX/LPD off, encryption required, unlimited peers |
| `domainsetup.sh` | Updates .env + generates nginx config for domain deployment |
| `.env.example` | All env vars documented |

---

## Deployment (VPS)

**Domain:** flux.personal.deadstudios.xyz  
**Nginx:** proxies `/` → `localhost:4938`, `/api/` → `localhost:6948`

```bash
# Full deploy
git pull && docker compose down && docker compose up -d --build

# Quick frontend-only
git pull && docker compose up -d --build frontend

# Quick backend-only
git pull && docker compose up -d --build backend

# Reset Transmission state (wipe downloads + config)
docker compose down
docker volume rm flux_downloads flux_transmission-config
docker compose up -d --build
```

**Verify Transmission:**
```bash
# Get session ID (handles 409)
SID=$(curl -s -u admin:flux -D - http://localhost:9091/transmission/rpc -d '' 2>&1 | grep -oP 'X-Transmission-Session-Id: \K\S+')
# Query torrents
curl -s -u admin:flux -H "X-Transmission-Session-Id: $SID" \
  -H 'Content-Type: application/json' \
  http://localhost:9091/transmission/rpc \
  -d '{"method":"torrent-get","arguments":{"fields":["id","name","percentDone","rateDownload","peersConnected","status"]}}'
```

---

## ⚠️ Gotchas / decisions

- **We do NOT use WebTorrent anymore.** The file `webtorrent.ts` is now a Transmission RPC wrapper.
- **`webtorrent` npm dep removed** from `package.json`. Only `parse-torrent` + `parse-torrent-title` remain.
- **npm install needs `--ignore-scripts`** on Windows (ip-set has a pnpm preinstall hook).
- **Backend `network_mode: host`** — no port mapping, connects to localhost for DB/Redis.
- **Transmission volumes** — must mount `downloads` at `/data/downloads` (same as backend DOWNLOAD_ROOT).
- **Transmission session ID** — rotates on restart. Code handles 409 automatically.
- **ffmpeg** installed in backend Dockerfile for HLS transcode.
- **Prisma 5.22 pinned** (7.8 available, deferred). Binary targets: `native` + `debian-openssl-3.0.x`.
- **TMDb API key** stays server-side. Frontend hits `/api/tmdb/*` proxy.
- **Never commit `.env`** or credentials.
- **Path traversal** guarded by `safeJoin()` in `media-paths.ts` on all media/download paths.
- **Hardlinks won't work** — `downloads` and `media` are separate Docker volumes. Use copy.
- **Streaming auth** — `/api/stream/*` uses `requireProfileStream` (JWT via `Authorization`
  header OR `?token=` query), because `<video>`/hls.js segment loads can't set headers. The HLS
  manifest route rewrites segment URIs to carry the token (+`episodeId`). `getStreamUrl`/`getHlsUrl`
  in `lib/api.ts` append the stored token. HLS sessions are keyed per `(mediaItemId, episodeId)`.
- **Playback = Plex-style pipeline.** Client (`components/FluxPlayer.tsx`, custom controls)
  **direct-plays** the original file via the range endpoint first (instant, seekable). On a decode
  error it falls back to **HLS**, which is now **codec-aware**: `probeMedia()` (ffprobe) → H.264 video
  is stream-copied (`-c:v copy`, remux, near-instant), AAC audio copied, else re-encoded to
  H.264/AAC. Shows opened without `?episode=` auto-resolve to the first available episode. All in
  `modules/streaming/`. Remaining weak spot: seeking *during* a long full transcode.
- **UI direction = Jellyfin library look** (user-pinned). `components/AmbientBackdrop.tsx` renders a
  fixed blurred backdrop layer; pages call `useAmbient(backdropPath)` to feed it. `GET /api/library/items?type=`
  → `LibraryItemDTO[]` (per-profile `watched` / `unplayedCount` for the grid badges), served by
  `listLibrary()`. `/library` page = grid + A–Z rail + type filter. All `.lib-*`, `.ambient*`, badge,
  and `.az-rail` styles live in `globals.css`.

---

## Current known issues

See `ISSUES.md` for prioritized task list.
