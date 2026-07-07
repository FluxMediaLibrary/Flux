# Flux

Self-hosted media library platform with built-in torrent acquisition, TMDb-backed requests, invite-only auth with Netflix-style profiles, and HLS streaming.

Movies and TV only. Single VPS, Docker Compose.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js, TypeScript, Fastify |
| Database | PostgreSQL 16 (Prisma ORM) |
| Job queue | BullMQ (Redis 7) |
| Torrent client | Transmission (sidecar) |
| Streaming | Direct play (byte-range) with FFmpeg HLS transcode fallback |
| Frontend | Next.js (App Router), React 19, hls.js |
| Auth | JWT, argon2 password hashing |
| Infra | Docker Compose, nginx reverse proxy |

## Architecture

### Account vs Profile

- **User (account)**: the login. Holds email, password, and role (ADMIN / MEMBER). Owns one or more profiles.
- **Profile**: Netflix-style sub-profile under an account. Watch progress, requests, and continue-watching all key off `profileId`.

JWT carries `sub` (accountId) + `role`. After selecting a profile, the token also carries `activeProfileId` for per-profile routes.

### Access control

- `/admin/*`: ADMIN role only
- Member routes: requires an active profile (profile selection gate)
- Invite-only signup: signup requires a valid, unexpired, single-use invite code

### How media is joined

TMDb ID (`tmdbId` + `mediaType`) is the join key between the library and requests. Library items are matched to TMDb at ingest; requests use the same key so a fulfilled request automatically links to the matching library item.

### Playback

1. **Direct play** the original file via the byte-range endpoint. Works for browser-native codecs (MP4/WebM/H.264+AAC).
2. If the browser cannot decode the file, **fall back** to an on-demand FFmpeg HLS transcode streamed through hls.js.

Playback decisions are made per-file by probing codec support.

## Prerequisites

- Docker and Docker Compose
- A TMDb API key (v3). Get one at https://www.themoviedb.org/settings/api
- A domain pointed at your VPS (for the frontend origin + invite links)

## Setup

### 1. Clone

```bash
git clone <repo-url> flux
cd flux
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

- `TMDB_API_KEY`: your TMDb v3 API key
- `JWT_SECRET`: a long random string (`openssl rand -hex 48`)
- `POSTGRES_PASSWORD`: a strong database password
- `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`: initial admin account credentials
- `FRONTEND_ORIGIN`: the public URL of your frontend (e.g. `https://flux.example.com`)
- `NEXT_PUBLIC_API_BASE_URL`: the public URL of your backend (built into the frontend at compile time)

### 3. Start the stack

```bash
docker compose up --build
```

On first run the backend automatically applies pending Prisma migrations, then seeds the bootstrap admin account if no users exist yet.

### 4. Set up nginx (optional)

Reverse proxy both services:

- Frontend: `localhost:4938`
- Backend: `localhost:6948`

The backend needs its port exposed for the frontend to proxy API calls at build time and for direct streaming access.

## Services and ports

| Service | Internal port | Notes |
|---|---|---|
| Frontend | 4938 | Next.js standalone server |
| Backend | 6948 | Fastify API + streaming |
| PostgreSQL | 5432 | loopback only |
| Redis | 6379 | loopback only |
| Transmission RPC | 9091 | loopback only |
| Transmission peer | 51413 | TCP + UDP, public for seeding |

Transmission runs in `network_mode: host` so peer port binding works correctly.

## Development

### Local setup

```bash
cp .env.example .env
# Fill in secrets, but point DATABASE_URL and REDIS_URL at localhost
npm install
npm run prisma:generate
npm run prisma:migrate   # or prisma:migrate:dev for local dev
npm run dev:backend      # backend on :6948
npm run dev:frontend     # frontend on :3000
```

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Full Docker Compose stack |
| `npm run dev:backend` | Backend with hot reload (tsx watch) |
| `npm run dev:frontend` | Frontend with hot reload (next dev) |
| `npm run build` | Build all workspaces |
| `npm run typecheck` | Type-check all workspaces |
| `npm run lint` | Lint all workspaces |
| `npm run prisma:migrate` | Apply pending migrations (production) |
| `npm run prisma:migrate:dev` | Create and apply migration (development) |
| `npm run prisma:generate` | Regenerate Prisma client |

### Project layout

```
flux/
├── docker-compose.yml
├── .env.example
├── shared/                    # @flux/shared API contract (DTOs + enums)
│   └── src/index.ts
├── packages/
│   ├── backend/
│   │   ├── prisma/schema.prisma   # central data contract
│   │   └── src/
│   │       ├── modules/           # domain modules (auth, profiles, library, etc.)
│   │       ├── jobs/              # BullMQ job processors
│   │       └── lib/               # shared utilities
│   └── frontend/
│       ├── app/                   # Next.js App Router
│       │   ├── (auth)/            # login, signup
│       │   ├── (member)/          # home, browse, library, watch
│       │   ├── admin/             # info, torrents, requests, invites, settings
│       │   └── profiles/          # profile selection
│       └── components/            # shared UI components
└── transmission-settings.json  # Transmission config (private tracker defaults)
```

### Conventions

- **Language**: TypeScript strict, ES modules
- **API**: REST/JSON under `/api`. JWT in `Authorization: Bearer`. All input validated with Zod. Errors return `ApiError` shape.
- **DTO types**: defined in `@flux/shared`. Never redefine wire shapes on either side.
- **DB changes**: edit `schema.prisma`, then `npm run prisma:migrate` (named migration). Never hand-edit the generated Prisma client.
- **Security**: all media/stream/download paths are resolved against their configured root to prevent path traversal. Secrets only via env. TMDb key stays server-side.

## Routes

### Auth (unauthenticated)

| Route | Description |
|---|---|
| `/login` | Sign in with email + password |
| `/signup` | Create account (requires invite code) |

### Member (requires profile)

| Route | Description |
|---|---|
| `/home` | Continue watching, recently added, by-genre rows |
| `/browse` | TMDb-powered discover (trending, popular, genres) |
| `/library` | Library grid with filtering |
| `/library/[id]` | Detail page with cast, episodes, play button |
| `/watch/[id]` | Video player (Plex-style UI) |
| `/profiles` | Profile selection and management |

### Admin

| Route | Description |
|---|---|
| `/admin/info` | System dashboard (uptime, storage, DB stats) |
| `/admin/torrents` | Upload and manage torrents |
| `/admin/requests` | View and approve media requests |
| `/admin/invites` | Generate invite codes |
| `/admin/settings` | Notification settings (Discord/SMTP) |

## Data model

- **Users**: accounts with email, password, role (ADMIN/MEMBER)
- **Profiles**: sub-profiles under a user, each with independent watch progress and requests
- **Invites**: single-use, expiring codes required for signup
- **MediaItems**: library entries matched to TMDb IDs (movies and shows)
- **Episodes**: per-season, per-episode files for shows
- **Torrents**: admin-managed downloads with status tracking (pending, downloading, processing, seeding, stopped, error)
- **Requests**: per-profile media requests keyed to TMDb IDs
- **WatchProgress**: per-profile save state (position, duration, completed flag)
- **NotificationSettings**: singleton row for Discord and SMTP config
