# ISSUES.md — Known issues & next priorities

> Generated 2026-07-05 after Phase 1–10 completion.
> These are the tasks for the next session. Ordered by user priority.

---

## 🔴 PRIORITY 1: Browse page needs trending/popular discovery

**Problem:** The `/browse` page requires the user to manually type a search query.
There's no way to discover movies/shows without knowing exactly what to search for.
It should work like IMDb/Plex/Netflix — showing popular, trending, top-rated content
by default before the user searches.

**Current state:** `GET /api/tmdb/search?q=&type=all` — only search, no discovery endpoints.

**What to build:**

### Backend: Add TMDb discover endpoints

TMDb has these endpoints we're NOT using yet:
- `GET /trending/{media_type}/{time_window}` — trending movies/tv this week
- `GET /movie/popular` — popular movies
- `GET /tv/popular` — popular TV shows
- `GET /discover/movie` — discover movies by genre/filters
- `GET /discover/tv` — discover TV by genre/filters
- `GET /genre/movie/list` + `GET /genre/tv/list` — genre lists

We need to:
1. Add new routes in `packages/backend/src/modules/tmdb/`:
   - `GET /api/tmdb/trending?type=movie|tv` → TmdbSearchResult[]
   - `GET /api/tmdb/popular?type=movie|tv` → TmdbSearchResult[]
   - `GET /api/tmdb/genres?type=movie|tv` → { id: number, name: string }[]
   - `GET /api/tmdb/discover?type=movie|tv&genre=28` → TmdbSearchResult[]

2. Update `@flux/shared` with the new DTOs

### Frontend: Redesign `/browse` page

The browse page should be the "main" discovery experience:
- **Hero section** at top: trending/popular carousel with backdrops
- **Genre filter bar** — horizontal scrollable genre pills
- **Default view:** popular movies grid (no search required)
- **Search bar** stays at top but as secondary feature
- **Filter tabs:** Movies / TV Shows / Trending / Popular
- **Grid of posters** — responsive, Netflix-style card layout
- **Each card:** poster, title, year, rating, "Request" or "In Library" button

Reference: Look at how Netflix/IMDb/Letterboxd show discovery grids.
Emulate that layout. Dark theme, emerald accent (#10b981).

### API client additions

Add to `packages/frontend/lib/api.ts`:
```ts
trending(type: MediaType, signal?: AbortSignal)
popular(type: MediaType, signal?: AbortSignal)
discover(type: MediaType, genreId?: number, signal?: AbortSignal)
listGenres(type: MediaType, signal?: AbortSignal)
```

---

## 🔴 PRIORITY 2: Video playback is broken

**Problem:** The `/watch/[id]` page with hls.js doesn't actually play videos.
HLS transcode via FFmpeg has never been tested. The video player UI is bare.

**Likely root causes:**
1. **No media files in library** — postprocess just started working (2026-07-05).
   Until a movie actually finishes processing, there's nothing to play.
2. **FFmpeg HLS path:** `/api/stream/:id/hls/index.m3u8` — FFmpeg spawns in background,
   but we've never verified it produces valid HLS segments in Docker.
3. **Direct play path:** `/api/stream/:id` — serves raw file via HTTP range.
   File resolution uses `safeJoin(config.MEDIA_ROOT, filePath)` which depends on
   postprocess having placed files correctly.
4. **CORS/nginx:** `/api/stream/*` must pass through nginx proxy.

**Debugging steps:**
1. After a torrent finishes postprocessing, check if files exist:
   ```bash
   docker compose exec backend ls -la /data/media/movies/
   ```
2. Test direct play directly:
   ```bash
   curl -I -H "Authorization: Bearer <JWT>" https://flux.personal.deadstudios.xyz/api/stream/<mediaItemId>
   ```
   Should return 200 with Content-Type video/mp4 or similar.
3. Test HLS:
   ```bash
   curl -H "Authorization: Bearer <JWT>" https://flux.personal.deadstudios.xyz/api/stream/<id>/hls/index.m3u8
   ```
   Should return .m3u8 playlist after a 15-second wait (transcode startup).

---

## 🟡 PRIORITY 3: Library detail page UI is bad

**Problem:** The `/library/[id]` detail page is functional but visually poor.
Doesn't match Plex/Netflix quality.

**Current state:** Backdrop image with gradient overlay + basic metadata + episode list.

**What to improve:**
- **Backdrop hero:** full-width cinematic backdrop with title treatment
- **Metadata row:** year, rating, runtime, genres as styled badges
- **Cast row** (if TMDb data includes it)
- **"Resume" / "Play from beginning"** buttons — Netflix-style pill buttons
- **Episode list for TV:** better layout, progress indicators per episode
- **Mobile responsive** design
- **Related/similar titles** (optional, nice-to-have)

---

## 🟡 PRIORITY 4: Homepage could be richer

**Current state:** Three rows (continue watching, recently added, by genre) with poster cards.

**Improvements:**
- **Hero/featured section** at top — newest or most popular item
- **Better poster hover effects** — scale, glow, info overlay
- **Row navigation arrows** — left/right scroll buttons on hover
- **Lazy loading / virtualization** for large libraries
- **Loading skeletons** match the actual layout better

---

## 🟢 PRIORITY 5: Misc polish

- **favicon** exists as SVG but browser may prefer .ico format
- **Error states** across pages could be more helpful (show actual error messages)
- **Empty states** on homepage and library pages could be more welcoming
- **Form validation** feedback on login/signup could be more specific
- **Transmission web UI** is accessible at `http://vps:9091` with admin:flux — document this
- **Transmission session ID rotation on restart** — frontend RPC calls handle it but it's fragile
- **Seeding stats** in TorrentDashboard show 0 until the first Transmission poll
- **progress bar** on continue watching items needs the `progress` data from watch progress
- **hls.js** imported dynamically but we never test on Safari (native HLS) or Firefox

---

## Build verification

```bash
npm run typecheck   # all 3 workspaces: ✅
npm run build       # shared + backend + frontend (12 routes): ✅
```

---

## Next session game plan

1. **First:** Build TMDb trending/popular/discover endpoints (backend)
2. **Second:** Redesign `/browse` page with discovery grids (frontend)
3. **Third:** Fix video playback — verify FFmpeg HLS works, test direct play
4. **Fourth:** Polish library detail page UI
5. **Fifth:** Homepage improvements
