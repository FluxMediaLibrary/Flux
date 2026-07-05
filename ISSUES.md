# ISSUES.md — Known issues & next priorities

> Updated 2026-07-05 (session 2) — Priorities 1, 3, 4 built; Priority 2 root-caused & fixed in code.
> Build verified green: `npm run typecheck` + `npm run build` all pass (12 routes).

---

## ✅ DONE THIS SESSION

### P1 — Browse discovery (COMPLETE)
- **Backend:** new TMDb endpoints in `packages/backend/src/modules/tmdb/`:
  - `GET /api/tmdb/trending?type=movie|tv&window=day|week`
  - `GET /api/tmdb/popular?type=movie|tv&page=`
  - `GET /api/tmdb/genres?type=movie|tv` → `{ id, name }[]`
  - `GET /api/tmdb/discover?type=movie|tv&genre=<id>&page=`
  - Service fns: `getTrending`, `getPopular`, `getGenres`, `discover` (all annotate `inLibrary`).
  - Added `voteAverage` to `TmdbSearchResult` (shared) + mapping.
- **Shared:** `TmdbGenreDTO`, `TrendingWindow`, `TmdbDiscoverResult`, `voteAverage`.
- **API client** (`lib/api.ts`): `trending`, `popular`, `discover`, `listGenres`, `tmdbDetail`.
- **Frontend `/browse`:** full redesign — trending hero carousel (auto-rotate + dots),
  Movies/TV toggle, scrollable genre pills (Popular + genres), Netflix-style poster grid
  with rating badges, In-Library/request-status badges, per-card Request/Play, loading
  skeletons. Search is now secondary (debounced, clearable).

### P2 — Video playback (ROOT-CAUSED & FIXED IN CODE — needs real-media verification)
Two concrete bugs found and fixed:
1. **Auth couldn't reach the stream.** `/api/stream/*` used `requireProfile`, which only reads
   the `Authorization` header — but `<video>`/hls.js segment loads **cannot send headers**, so
   every request 401'd. Fix: new `requireProfileStream` guard accepts the JWT via `?token=`
   (header still works). `getStreamUrl`/`getHlsUrl` now append `token`. The HLS manifest route
   rewrites each segment URI to carry `token` (+`episodeId`) so hls.js **and** Safari-native both
   authenticate. See `plugins/auth.ts`, `modules/streaming/streaming.routes.ts`, `lib/api.ts`.
2. **HLS never attached (mount-order bug).** The watch page's `loading` early-return meant the
   `<video>` element wasn't mounted when the HLS setup effect ran (`videoRef.current` null), and
   deps never changed to re-run it. Fix: video is always mounted; a "Preparing stream…" overlay
   covers startup. Added a back bar.
3. **HLS sessions are now keyed per `(mediaItemId, episodeId)`** so switching episodes of a show
   no longer replays the previous episode.

> ⚠️ STILL TO VERIFY IN THE REAL ENV (could not be done here — needs actual media files +
> FFmpeg in Docker): finish a torrent → confirm files land in `/data/media` → open `/watch/:id`
> and confirm the m3u8 + segments stream and play. Also test Safari native HLS and Firefox.

### P3 — Library detail page (COMPLETE)
Cinematic hero, metadata as `.detail-badge` pills (year, runtime, episode count, ★ rating,
genres), a **Cast** row (via `api.tmdbDetail`), Resume/Play buttons, and a per-season switcher
for TV. Enrichment fetch fails silently so the page still works offline of TMDb.

### P4 — Homepage (COMPLETE)
Featured hero (first item with a backdrop), rail hover-scroll arrows (‹/›, edge-disabled),
poster hover glow, retained continue-watching progress bars + skeletons.

---

## 🟢 REMAINING (P5 polish + verification)

1. **Verify playback end-to-end** in Docker with real media (see P2 warning above).
2. **Transcode session cleanup** — `hlsSessions` + `/data/transcode` dirs are never GC'd; grows
   unbounded. Add TTL cleanup / cap concurrent sessions.
3. **Growing-playlist UX** — while FFmpeg transcodes, the manifest has no `#EXT-X-ENDLIST`; hls.js
   treats it as live and reloads. Works, but seeking past the transcoded point may stall. Consider
   pre-generating VOD or a longer segment strategy.
4. **favicon** — SVG exists; add `.ico` fallback.
5. **Empty/error states** — homepage/library could be more welcoming.
6. **Transmission web UI** at `http://vps:9091` (admin:flux) — document.
7. **Seeding stats** show 0 until first Transmission poll.
8. Token-in-query is logged by nginx/access logs — acceptable for a personal server (Plex does the
   same with `X-Plex-Token`), but rotate JWTs on a sane expiry.

---

## Build verification

```bash
npm run typecheck   # shared + backend + frontend: ✅
npm run build       # shared + backend + frontend (12 routes): ✅
```
