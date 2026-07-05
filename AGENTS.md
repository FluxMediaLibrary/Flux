# AGENTS.md — Working in the Flux codebase

> Living doc: how to develop, run, and stay consistent in this repo.
> Product scope lives in `media-server-spec.md` (one-time input, not a living file).

## What Flux is

Self-hosted, Plex-like media library platform with built-in torrent acquisition,
TMDb-backed requests, invite-only auth with Netflix-style profiles, and HLS
streaming. Single VPS, Docker Compose. Movies + TV only (v1).

## Stack

- **Backend** (`packages/backend`): Node.js + TypeScript, **Fastify**, **Prisma** (Postgres),
  **BullMQ** (Redis) for jobs, **WebTorrent** (embedded), **FFmpeg** (transcode), JWT auth.
- **Frontend** (`packages/frontend`): **Next.js** (App Router), React, `hls.js` player.
  Single app, **role-gated routes** (`/admin/*` = ADMIN only; member routes for all).
- **Shared** (`shared`): `@flux/shared` — the REST API contract (DTOs + enums). Import
  types from here on both sides; never redefine wire shapes.
- **Infra**: `postgres:16`, `redis:7`, root `docker-compose.yml`.

## Repo layout

```
flux/
├── docker-compose.yml
├── .env.example            # copy to .env
├── shared/                 # @flux/shared API contract types
├── packages/backend/
│   ├── prisma/schema.prisma  # THE data contract — change via migrations
│   └── src/{modules,jobs,lib,plugins}/
└── packages/frontend/
    └── app/{(member),admin,(auth)}/
```

## Core domain rules (do not violate)

- **Account vs Profile**: `User` = the login/account (holds `role`). `Profile` =
  Netflix-style sub-profile under an account (unlimited, no PINs in v1).
- **Per-profile**: `watch_progress`, `requests`, continue-watching all key off
  `profileId`. **Per-account**: login, invite, `role`.
- **Admin checks use the account's `role`**, never a profile. Resolve `profile → user.role`.
- JWT carries `sub` (accountId) + `role`; `activeProfileId` is added after profile
  selection. Per-profile routes require `activeProfileId`.
- Invite-only signup: signup requires a valid, unexpired, single-use invite code.
- TMDb ID (`tmdbId` + `mediaType`) is the join key between library and requests.

## Conventions

- **Language**: TypeScript strict everywhere. ES modules.
- **API**: REST/JSON under `/api`. JWT in `Authorization: Bearer`. Validate all input
  with **zod**. Return `ApiError` shape on failure.
- **Naming**: DTOs suffixed `DTO` in `@flux/shared`. Backend modules are folders under
  `src/modules/<domain>/` with `*.routes.ts`, `*.service.ts`, `*.schema.ts`.
- **Security**: never trust client paths — sanitize/resolve every media/stream/download
  path against its configured root (prevent path traversal). Secrets only via env.
  Passwords hashed with argon2/bcrypt. TMDb key stays server-side (proxy TMDb).
- **DB changes**: edit `schema.prisma` → `npm run prisma:migrate` (named migration).
  Never hand-edit generated client. `profileId`/account rules above are load-bearing.

## Run / build

```bash
cp .env.example .env            # fill in TMDB_API_KEY, secrets
docker compose up --build       # full stack
# Local dev per package:
npm run dev:backend
npm run dev:frontend
npm run prisma:migrate          # apply schema changes
npm run typecheck               # all workspaces
```

## Status

Phases 1–3 complete and building green (auth, profiles, invites, TMDb proxy on the
backend; auth/profile/invites UI on the frontend). Initial Prisma migration committed.
Next: Phase 4 (torrent acquisition). See `CONTINUE-OFF.md` for the live handoff state.
Update this file as modules land.
