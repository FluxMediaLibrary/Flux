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
| Roku: source restored (`apps/roku/src`), device link, `/api/roku/*` | done; **not sideloaded on a device yet** |
| Deployment (compose health checks, `FLUX_MEDIA_PATH`, preflight) | done |
| Android Cast recovery | code done, compiles; **no signed release built** |
| List-surface performance (media-lite projection + indexes) | done |
| Categorised logging | done |
| Web UI visual redesign | **not started** (see docs/OVERHAUL.md "Remaining work") |
| Fresh install / upgrade end-to-end run in Docker | **not run** |

## How to verify locally

```bash
npm run typecheck && npm run lint
npm test --workspace @flux/backend      # 50 tests
npm test --workspace @flux/desktop
cd packages/frontend && npx next build  # passes on Next 16.3.5
```

New migrations (all additive/idempotent): `20260915000000_setup_and_storage_policy`,
`20260915120000_device_link_and_playback_sessions`, `20260915130000_media_list_indexes`.

## Next actions

1. Run the stack in Docker from a clean `.env` (`./setup.sh`), walk the wizard,
   scan a folder with a couple of movies, play one, check admin Storage/Playback.
2. Sideload `node apps/roku/package.mjs` on a Roku, link it via `/link`, play
   a movie and an episode, confirm Continue Watching updates on web.
3. Build a signed Android release (`scripts/release-android.ps1`) with the Cast
   recovery changes; test lock/unlock and Wi-Fi drop while casting.
4. UI pass per the master prompt (Phase 9/24/25) once a running stack is
   available to look at.

## Gotchas

- Never add AI co-author trailers to commits (user rule).
- `.next/dev/types` can hold stale generated types; delete it if `tsc` complains
  about a missing page.
- `lib/redis.ts` uses `lazyConnect`; unit tests import backend modules with
  placeholder `DATABASE_URL`/`REDIS_URL`/`JWT_SECRET` env vars (see any `*.test.ts`).
- Heredocs containing `$$`/backslash-escapes are mangled by the shell tool on
  this machine; write patch scripts to files instead.
