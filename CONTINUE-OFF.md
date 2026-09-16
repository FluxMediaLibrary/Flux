# CONTINUE-OFF — Flux platform overhaul

Branch: `overhaul/platform` (11 commits on top of `master`, not pushed).
Full record with rationale: `docs/OVERHAUL.md`. Driving spec:
`Flux Complete Overhaul Master Prompt.md` (untracked, local).

## Status

| Area | State |
|---|---|
| Canonical settings (cache + Redis change bus, storage/setup fields) | done |
| Storage service (reserve policy, size-aware placement, diagnostics) | done, unit-tested |
| First-run wizard `/setup` + `/api/setup` | done |
| Library import scan (`/api/admin/library/scan`) | done, matcher unit-tested |
| Dependabot advisories | resolved, `npm audit` clean |
| Transcode diagnostics + verified HW accel | done |
| Request lifecycle stages + cancel | done, tested |
| Roku: source restored (`apps/roku/src`), device link, `/api/roku/*` | done, API verified live; **not sideloaded on a device yet** |
| Deployment (compose health checks, `FLUX_MEDIA_PATH`, preflight) | done |
| Android Cast recovery | code done, compiles; **no signed release built** |
| List-surface performance (media-lite projection + indexes) | done |
| Categorised logging | done |
| Web UI | reviewed at desktop + phone widths, overflow/false-error fixes applied; no wholesale restyle (see docs/OVERHAUL.md) |
| Fresh install end-to-end (clean Postgres/Redis, wizard, scan, direct/HLS play, Roku link + playback, revoke) | **done** — see docs/OVERHAUL.md Stage 11 |

## How to verify locally

```bash
npm run typecheck && npm run lint
npm test --workspace @flux/backend      # 51 tests
npm test --workspace @flux/desktop
cd packages/frontend && npx next build  # passes on Next 16.3.5
```

New migrations (all additive/idempotent): `20260915000000_setup_and_storage_policy`,
`20260915120000_device_link_and_playback_sessions`, `20260915130000_media_list_indexes`.

## Next actions

1. Sideload `node apps/roku/package.mjs` on a Roku, link it via `/link`, play
   a movie and an episode, confirm Continue Watching updates on web.
2. Build a signed Android release (`scripts/release-android.ps1`) with the Cast
   recovery changes; test lock/unlock and Wi-Fi drop while casting.
3. Further UI polish if wanted — screenshots of every page at 1440px and 400px
   were reviewed; the member UI already matches the cinematic direction.

## Gotchas

- Never add AI co-author trailers to commits (user rule).
- `.next/dev/types` can hold stale generated types; delete it if `tsc` complains
  about a missing page.
- `lib/redis.ts` uses `lazyConnect`; unit tests import backend modules with
  placeholder `DATABASE_URL`/`REDIS_URL`/`JWT_SECRET` env vars (see any `*.test.ts`).
- Local dev stack used for validation: `docker run` postgres:16-alpine on
  127.0.0.1:5433 and redis:7-alpine on 127.0.0.1:6380 (`flux-dev-pg`,
  `flux-dev-redis`, started with `--rm`), backend via `tsx watch` with the env in
  `<scratchpad>/fluxdata/dev.env`, frontend via `next dev -p 3000`.
- `npm run prisma:generate` fails with EPERM while a backend is running (the
  query engine DLL is locked); stop the dev backend first.
- Heredocs containing `$$`/backslash-escapes are mangled by the shell tool on
  this machine; write patch scripts to files instead.
