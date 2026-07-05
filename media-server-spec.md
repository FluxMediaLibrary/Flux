# Media Library Platform — V1 Spec

## 1. Overview

A self-hosted media library platform (Plex-like) with a built-in torrent acquisition
system and user/request management, deployed as a single system on one VPS.

**Explicitly built by us:** backend API, database, library scanner, streaming/transcode
orchestration, admin panel, member web app, request browser, notification system,
torrent management UI.

**Explicitly NOT reinventing (used as libraries/services, not as external apps):**
- **FFmpeg** — video transcoding/packaging engine, invoked by our backend
- **WebTorrent** (Node) — embedded torrent engine, runs inside our backend process
- **TMDb API** — movie/TV metadata, posters, cast, trailers
- A JWT-based auth scheme (not a specific library mandated)

No Jellyfin/Plex/Sonarr/Radarr/qBittorrent/Overseerr in this architecture. Those
categories of functionality are built into our own backend instead.

---

## 2. Media Scope

- **Movies** and **TV Shows** only for v1 (no music, audiobooks, etc.)
- TV structure: full **Show → Season → Episode** hierarchy
- Per-episode watch progress tracking (not just per-show)

---

## 3. User System

- Two roles only: **Admin**, **Member**
- **Invite-only signup**, enforced from day one — no open registration
  - Admin generates invite links/codes from the admin panel
  - Invite codes are single-use and expiring
  - Signup flow requires a valid invite code
- Auth: JWT-based (not cookie-session-only), so the same API can later serve a
  mobile/TV app without rework

### 3.1 Profiles

Each **account** (the login/invite-holder) can have multiple **profiles**, Netflix-style:
- Login → profile picker → pick a profile → that profile is "who's watching"
- **No limit** on number of profiles per account for v1
- **No PINs/restricted profiles** in v1 — all profiles under an account have equal
  access (deferred; see Section 10)
- Profiles belong to the account, not to a separate login — one JWT session per
  account, with an active-profile selection layered on top (e.g. stored in the
  session/token claims or set per-request)

**What's per-profile vs. per-account:**
- **Per-profile:** watch progress/resume, continue watching, media requests
  (a request is logged against the specific profile that made it, not just the account)
- **Per-account:** the login itself, invite relationship, role (Admin/Member — role
  is not per-profile; an account's role applies across all its profiles)

This means `watch_progress` and `requests` key off `profile_id`, not `user_id`
directly — `profile_id` in turn belongs to an account. Admin-role checks (e.g. who
can upload torrents) still check the account's role, since Admin/Member is not a
profile-level concept.

---

## 4. Torrent Acquisition (Admin-only)

### 4.1 Flow
1. Admin uploads a **`.torrent` file** (magnet links NOT supported in v1 — file upload only)
2. Backend parses the torrent's internal filename(s) and **auto-guesses** title
   (and season/episode numbers, for TV) using a filename-parsing library/heuristics
3. Admin **reviews and confirms/corrects** the guess before download starts:
   - Category: Movie or TV Show
   - Matched TMDb title (search-and-confirm against TMDb, not free text)
   - For TV: season/episode mapping if the torrent contains multiple files
     (season pack) — auto-parsed per-file, admin can correct any mismatches
4. Backend adds the confirmed torrent to the embedded WebTorrent engine, begins download
5. Admin panel shows **live progress**: % complete, download speed, peers, ETA
6. **On completion:**
   - Files are automatically renamed and moved into the correct library folder
     structure based on confirmed metadata (e.g. `/media/movies/Title (Year)/`,
     `/media/tv/Show Name/Season 01/Show Name - S01E01.mkv`)
   - For season packs, each episode file is split out and placed individually
   - Library entry becomes available; if linked to a member request, that request
     is marked fulfilled and triggers a notification
7. **Seeding:** continues indefinitely after download completes
   - Panel shows seeding stats: ratio, total uploaded, time seeding, seeders/leechers
   - **No auto-stop rules in v1** — admin manually stops/removes seeding whenever
     they choose

### 4.2 Explicitly deferred (not v1)
- Magnet link support
- Automated indexer search / "fully automatic" acquisition
- Auto-stop seeding rules (ratio/time based)

---

## 5. Media Requests (Member-facing)

A dedicated **Request tab**, functioning as a full TMDb browser:
- Search by title, browse/filter by genre
- Full metadata display per title: poster, backdrop, synopsis, cast, trailer
  (YouTube embed via TMDb trailer links)
- This browses **all of TMDb's catalog**, not just what's currently in the library
- If a title is already in the library (matched by TMDb ID), show a **Play/Watch**
  action instead of Request
- If not in the library, show a **Request** action
- Requesting logs: requesting **profile** (and its parent account), TMDb ID,
  timestamp, status (`pending` → `approved`/`downloading` → `fulfilled`)
- Fulfillment is linked to the torrent flow above: when an admin adds a torrent that
  matches a pending request's TMDb ID (or the admin manually marks a request
  fulfilled), status updates and the requesting **profile's account** is notified

---

## 6. Notifications

Admin-configurable from the admin dashboard, supporting multiple channels
simultaneously:
- **Discord webhook** — admin pastes a webhook URL in settings
- **Email via SMTP** — admin configures host/port/username/password/from-address
- Both are optional/independently toggleable; if none configured, notifications
  are simply skipped (not required for core app function)

**Triggers (v1):**
- New member request submitted → notify admin (Discord and/or email, per config)
- Request fulfilled → notify the requesting member

Internally this should be a generic notification service that fans out to
whichever channels are configured, rather than hardcoded per-trigger logic.

---

## 7. Library Browsing & Playback (Member-facing)

### 7.1 Homepage
Full Plex-like homepage, scoped to the **active profile**:
- **Continue Watching** row (per-profile, based on saved playback position)
- **Recently Added**
- **Browse by genre**

### 7.2 Playback
- **Direct play first**: if the client can natively handle the file's codec/container,
  serve the original file directly with HTTP range-request support (enables seeking)
- **Transcode fallback**: when direct play isn't viable, transcode on-demand via
  FFmpeg into HLS (`.m3u8` + `.ts` segments), served by our backend
- Frontend video player uses `hls.js` against a plain `<video>` element (portable
  approach — same pattern reusable in a future React Native app)
- **Multiple simultaneous streams required**: different users must be able to watch
  different titles at the same time (backend must handle concurrent transcode/stream
  sessions without collision)

### 7.3 Watch progress
- Playback position tracked **per-profile**, per-episode (or per-movie)
- Resume-from-position on re-open
- Powers the Continue Watching homepage row for the active profile

---

## 8. Metadata

- **TMDb API** used for all movie/TV metadata: titles, posters, backdrops,
  descriptions, cast, trailers, genres
- Library items are matched to TMDb IDs at ingest time (during the torrent
  confirm-match step) — this TMDb ID is the join key between library items and
  requests

---

## 9. High-Level Architecture

**Deployment target:** single VPS, Docker Compose

**Services:**
- `backend` — Node.js/TypeScript API. Owns: auth, users/invites, requests, torrent
  engine (embedded WebTorrent), library scanner, TMDb integration, streaming/transcode
  endpoints, notification service. FFmpeg installed in this container.
- `frontend` — web app (React/Next.js), consumed by both admin panel and member app
  (same app, role-gated views, OR separate admin/member routes within one app —
  to be decided at scaffolding time)
- `postgres` — primary datastore
- `redis` — job queue for background work (transcode jobs, download processing) so
  these don't block the main API event loop

**Data model (core entities, non-exhaustive):**
- `users` (role: admin | member) — represents the **account**
- `profiles` (belongs to a user/account; name, avatar; no PIN/restrictions in v1)
- `invites` (code, expires_at, used_by, used_at)
- `media_items` (tmdb_id, type: movie|show, title, metadata cache, file paths)
- `episodes` (belongs to media_item, season, episode number, file path)
- `torrents` (file hash, status, progress, category, matched tmdb_id, seeding stats)
- `requests` (**profile_id**, tmdb_id, status, timestamps, linked torrent if fulfilled)
- `watch_progress` (**profile_id**, media_item_id or episode_id, position, updated_at)
- `notification_settings` (discord_webhook_url, smtp_config, enabled flags)

**API design principle:** REST/JSON, JWT auth — designed so a future React Native
app (Android, then TV) can consume the same API without backend changes. **Mobile/TV
apps themselves are out of scope for this v1 build.**

---

## 10. Explicit V1 Scope Boundaries

**In scope:**
- Movies + TV (with season/episode structure)
- Admin-only torrent upload (.torrent file only) with guided title/episode matching
- Auto file renaming/organizing, season-pack splitting
- Manual seeding control, live progress + seeding stats
- Invite-only auth, Admin/Member roles
- **Multiple profiles per account (Netflix-style), unlimited count, no PINs**
- **Per-profile watch progress, continue watching, and media requests**
- Full TMDb-backed request browser
- Discord + SMTP notifications (admin-configurable)
- Plex-like homepage (continue watching, recently added, genres)
- Direct play + FFmpeg transcode fallback via HLS
- Per-episode watch progress/resume
- Multiple concurrent streams

**Explicitly deferred to later:**
- Mobile app (Android) and TV app (API will be ready for it, apps themselves are not built now)
- Magnet link support
- Automated/indexer-based acquisition
- Auto-stop seeding rules
- Music, audiobooks, other media types
- Granular per-user permissions beyond Admin/Member
- **Profile PINs / restricted (e.g. kids) profiles**
- **Per-profile avatars/customization beyond basic name+avatar**

---

## 11. Build Process Note (not a product feature)

This project will be built using **Claude Code**. Where independent pieces of the
system can be worked on in parallel with minimal cross-dependency (e.g. backend
schema/API scaffolding vs. frontend component scaffolding vs. Docker/infra setup),
Claude Code should use parallel sub-agents to speed up delivery.

This is a build-tooling instruction only — it has no bearing on the running
application's architecture or features, and nothing about "agents" should appear
in the product itself (no runtime AI-agent features are in scope for v1; see
Section 10).

**AGENTS.md:** Claude Code should create an `AGENTS.md` file at the repo root
early in the build (once initial structure/conventions exist) and keep it updated
as the project evolves. This file documents *how to work in this codebase* — dev
environment setup, how to run/build/test, directory structure, code conventions,
migration workflow, and any repo-specific gotchas — so that future Claude Code
sessions (e.g. bug fixes or feature additions after v1 ships) stay consistent
without needing this spec re-explained. This is distinct from this spec document,
which describes product scope and is a one-time input rather than a living file.