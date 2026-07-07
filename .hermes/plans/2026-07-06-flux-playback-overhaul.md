# Flux Playback System Overhaul — Implementation Plan

> **For Hermes:** Dispatch 3 parallel delegate_task agents per phase using the flux skill's agent pattern.

**Goal:** Redesign the Flux video playback pipeline to deliver Jellyfin/Plex-class performance: instant startup, adaptive streaming, quality/track switching, pre-generated assets, and a polished player UI.

**Architecture:** Move per-playback work into import-time background jobs. Store media analysis (ffprobe) in the database. Build adaptive HLS with quality selection. Add player settings menu, trickplay thumbnails, preloading, and a debug overlay.

**Tech Stack:** Fastify + Prisma (backend), Next.js 16 + hls.js (frontend), FFmpeg, TypeScript ESM

---

## Part 1: Architecture Analysis & Bottlenecks

### 1.1 Current Pipeline

```
User clicks episode
  ↓
getPlaybackInfo() → ffprobe spawn (500-2000ms) → decide direct/hls
  ↓
If direct: <video src> → byte-range endpoint
If HLS: GET manifest → spawn FFmpeg → poll (up to 20s) → poll segments (up to 8s) → play
```

### 1.2 Bottlenecks (Impact-ranked)

| # | Bottleneck | Impact | Fix |
|---|-----------|--------|-----|
| 1 | **Per-playback ffprobe**: `decidePlayback()` spawns ffprobe on EVERY play request. Blocks the /info endpoint for 500-2000ms. | Highest | Store probe results in DB at import time. Playback decision becomes a DB read. |
| 2 | **On-demand HLS transcode**: FFmpeg starts when user clicks play. Manifest polling up to 20s. Segment head-start up to 8s. | High | Pre-generate HLS streams at import or on first play with session persistence. |
| 3 | **Single-quality HLS only**: No adaptive streaming. All transcodes produce one tier (H.264 CRF 23, AAC 160k). | High | Generate multi-quality master playlist with `var_stream_map`. |
| 4 | **No track switching UI**: Player has no audio/subtitle track selector. ffprobe only reads first streams. | Medium | Probe ALL tracks. Add settings gear with track lists. |
| 5 | **Per-scrub ffmpeg thumbnail**: Each seek position spawns a new ffmpeg process. Thumbnails lag behind scrub. | Medium | Pre-generate trickplay sprite sheets at import time (like Jellyfin). |
| 6 | **No preloading**: Next episode metadata/streams not pre-fetched. | Medium | Preload next episode near end of current. |
| 7 | **In-memory session tracking**: `hlsSessions` Map lost on restart. No session cleanup. | Low | Persist to DB. Add TTL/cleanup. |
| 8 | **React re-renders**: 4x/second `timeupdate` → `setCurrent` → re-render entire control bar. | Low | Use refs for time tracking, throttle state updates. |
| 9 | **Fixed buffer config**: hls.js maxBufferLength=60, no bitrate awareness. | Low | Bitrate-aware buffer sizing (Jellyfin pattern). |
| 10 | **No debug overlay**: Cannot diagnose playback issues in production. | Low | Add optional developer debug overlay. |

### 1.3 Jellyfin Architectural References

Jellyfin's approach (studied from jellyfin/jellyfin and jellyfin/jellyfin-web):

- **MediaInfo table**: Full stream metadata stored at library scan time. Columns: codec, bitrate, resolution, framerate, HDR info, audio channels, subtitle format, etc. Playback decision = DB query, not process spawn.
- **TranscodingReason**: Server traces why it chose transcode over direct play (e.g. "VideoCodecNotSupported", "ContainerNotSupported").
- **DeviceProfile**: Client reports codec/container compatibility. Server builds a device-aware playback profile.
- **EncodingHelper**: 2000+ line class handling codec negotiation, hardware acceleration detection, subtitle burn-in decisions, HLS master playlist construction with multi-bitrate variants, trickplay generation.
- **htmlVideoPlayer plugin**: DirectPlay → HLS/FLV → error recovery. Tracks subtitle/audio track selection, ASS/PGS rendering, aspect ratio, stats collection.
- **Adaptive HLS**: Master playlist with `#EXT-X-STREAM-INF` entries for each resolution tier. Uses `-var_stream_map` + `-filter_complex` scale filters.
- **Trickplay**: Pre-generated sprite sheets stored alongside media. Served as static files. Frontend uses CSS background-position animation.

---

## Part 2: Implementation Phases

### Phase 1: Media Analysis at Import (eliminate per-playback ffprobe)

**Objective:** Store ffprobe results in the database when media is imported. Playback decision becomes a sub-millisecond DB read.

**Schema changes:**
- New model `MediaInfo` (one-to-one with MediaItem/Episode):
```prisma
model MediaStream {
  id          String   @id @default(cuid())
  mediaItemId String?
  episodeId   String?
  type        String   // "video", "audio", "subtitle"
  index       Int      // stream index (0-based)
  codec       String?  // h264, aac, dts, etc.
  profile     String?  // Main, High, etc.
  level       Int?
  width       Int?     // video only
  height      Int?     // video only
  bitrate     Int?     // bits/s
  framerate   Float?   // frames/s
  hdr         String?  // "HDR10", "DV", "HLG", null
  channels    Int?     // audio only
  language    String?  // eng, jpn, etc.
  title       String?  // "Commentary", "Director's Cut"
  isDefault   Boolean @default(false)
  isForced    Boolean @default(false)
  
  mediaItem MediaItem? @relation(fields: [mediaItemId], references: [id], onDelete: Cascade)
  episode   Episode?   @relation(fields: [episodeId], references: [id], onDelete: Cascade)
  
  @@index([mediaItemId])
  @@index([episodeId])
  @@map("media_streams")
}

model MediaInfo {
  id            String   @id @default(cuid())
  mediaItemId   String?
  episodeId     String?
  container     String   // mp4, mkv, avi
  durationSec   Float
  sizeBytes     BigInt
  hasVideo      Boolean
  hasAudio      Boolean
  hasSubtitles  Boolean
  
  mediaItem MediaItem? @relation(fields: [mediaItemId], references: [id], onDelete: Cascade)
  episode   Episode?   @relation(fields: [episodeId], references: [id], onDelete: Cascade)
  
  @@unique([mediaItemId])
  @@unique([episodeId])
  @@map("media_info")
}
```

**Files to create/modify:**
- `packages/backend/prisma/schema.prisma` — add MediaStream + MediaInfo models
- `packages/backend/src/lib/media-analyzer.ts` — new: ffprobe runner that stores results
- `packages/backend/src/lib/media-paths.ts` — extend safeJoin if needed
- `packages/backend/src/modules/streaming/streaming.service.ts` — modify `decidePlayback()` to read from DB, fall back to live probe
- `packages/backend/src/modules/streaming/streaming.routes.ts` — modify /info endpoint
- `packages/backend/src/jobs/` — add import-analysis job to run after torrent PROCESSING completes

**Key changes to `decidePlayback()`:**
```ts
export async function decidePlayback(filePath: string, mediaItemId: string, episodeId?: string) {
  // 1. Try DB-stored analysis first (sub-ms)
  const streams = await prisma.mediaStream.findMany({ where: episodeId ? { episodeId } : { mediaItemId } });
  if (streams.length > 0) {
    return decideFromStreams(streams, filePath);
  }
  // 2. Fall back to live probe (existing behavior)
  const probe = await probeMedia(filePath);
  return decideFromProbe(probe, filePath);
}
```

**Verification:** `npm run typecheck` passes. Existing playback still works.

---

### Phase 2: Adaptive HLS with Multi-Quality Master Playlist

**Objective:** Generate a proper HLS master playlist with multiple quality variants. Player auto-switches based on bandwidth, with manual override.

**Quality tiers:**
| Label | Resolution | Video Bitrate | Audio Bitrate |
|-------|-----------|---------------|---------------|
| 4K | 3840×2160 | 15000k | 192k |
| 1440p | 2560×1440 | 9000k | 192k |
| 1080p | 1920×1080 | 5000k | 192k |
| 720p | 1280×720 | 2800k | 160k |
| 480p | 854×480 | 1400k | 128k |
| 360p | 640×360 | 800k | 96k |

**Backend changes:**
- `streaming.service.ts`: New `buildMasterPlaylist()` that generates multi-variant FFmpeg args using `-filter_complex` scale + `-var_stream_map`
- `streaming.routes.ts`: New `GET /api/stream/:id/hls/master.m3u8` endpoint
- Transcode session produces: `master.m3u8` + `stream_N/` directories each with their own `index.m3u8` + `segment_*.ts`

**FFmpeg pattern (single command, multi-output):**
```bash
ffmpeg -i source.mkv \
  -filter_complex "[0:v]split=6[v1][v2][v3][v4][v5][v6];
    [v1]scale=w=3840:h=2160:force_original_aspect_ratio=decrease[v1out];
    [v2]scale=w=2560:h=1440:force_original_aspect_ratio=decrease[v2out];
    [v3]scale=w=1920:h=1080:force_original_aspect_ratio=decrease[v3out];
    [v4]scale=w=1280:h=720:force_original_aspect_ratio=decrease[v4out];
    [v5]scale=w=854:h=480:force_original_aspect_ratio=decrease[v5out];
    [v6]scale=w=640:h=360:force_original_aspect_ratio=decrease[v6out]" \
  -map "[v1out]" -c:v:0 libx264 -b:v:0 15000k -maxrate:v:0 16500k -bufsize:v:0 30000k \
  -map "[v2out]" -c:v:1 libx264 -b:v:1 9000k -maxrate:v:1 9900k -bufsize:v:1 18000k \
  ... (similar pattern for audio maps with -map 0:a:N) \
  -f hls -hls_time 4 -hls_list_size 0 \
  -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3 v:4,a:4 v:5,a:5" \
  -master_pl_name master.m3u8 \
  -hls_segment_filename "stream_%v/segment_%05d.ts" \
  "stream_%v/index.m3u8"
```

**Frontend changes:**
- `FluxPlayer.tsx`: When mode='hls', point hls.js at master.m3u8 instead of index.m3u8. hls.js natively handles adaptive ABR switching.
- `FluxPlayer.tsx`: Add quality menu. Read `hls.levels` for available qualities. Set `hls.currentLevel` for manual selection (-1 = auto).

---

### Phase 3: Player Settings Menu

**Objective:** Add a settings gear icon in the control bar that opens a menu for quality, audio track, subtitle, and playback speed.

**UI design (inspired by Netflix/Disney+):**
```
┌──────────────────────────────┐
│ ⚙ Playback                   │
│ ─────────────────────────────│
│ Quality          Auto ▼      │
│ Audio        English ▼       │
│ Subtitles         Off ▼      │
│ Speed              1x ▼      │
└──────────────────────────────┘
```

**Files to modify:**
- `FluxPlayer.tsx`: Add state for settings menu open/close, selected audio track index, selected subtitle track index, selected quality level
- New component inline or separate: `PlayerSettings` menu (positioned absolutely above the controls)
- CSS additions (inline styles or app-level CSS)

**hls.js integration:**
- `hls.audioTracks` for audio track list
- `hls.subtitleTracks` for embedded subtitles
- `hls.audioTrack = N` to switch audio
- `hls.subtitleTrack = N` to switch subtitles (-1 = off)
- `hls.levels[N].height` / `.bitrate` for quality display
- `hls.currentLevel = N` to switch quality (-1 = auto)

---

### Phase 4: Trickplay Thumbnail Pre-generation

**Objective:** Generate sprite sheets (JPG + VTT) at import time so scrubbing thumbnails appear instantly without spawning ffmpeg per-seek.

**Approach (Jellyfin-style):**
1. At media import analysis time, spawn ffmpeg to extract one frame every N seconds (e.g. every 10s)
2. Tile frames into a sprite sheet (e.g., 10 columns × M rows)
3. Generate a VTT file mapping time ranges → sprite sheet coordinates
4. Serve static sprite sheets and VTT from the transcode root
5. Frontend: during scrub, look up the VTT cue, set CSS `background-image` + `background-position`

**Backend:**
- `packages/backend/src/lib/trickplay-generator.ts` — new: spawns ffmpeg for sprite generation
- `packages/backend/src/modules/streaming/streaming.routes.ts` — serve `.jpg` sprite sheets + `.vtt` files
- `packages/backend/src/jobs/` — trigger trickplay generation after media analysis

**Frontend:**
- `FluxPlayer.tsx`: Replace per-seek ffmpeg thumb endpoint with sprite-sheet-based preview
- New helper `trickplay.ts` in `lib/` — resolves VTT cue → CSS position

---

### Phase 5: Preloading, Smarter Buffering, Performance

**Objective:** Preload metadata and streams for the next episode. Use bitrate-aware buffer sizing. Reduce React re-renders.

**Preloading:**
- `FluxPlayer.tsx`: At 85% playback, fetch next episode's playback info in background
- Watch page: Preload next episode `<link rel="prefetch">` or subtle API pre-warming
- Backend: Allow `/info` to be called aggressively with cache headers

**Bitrate-aware buffering (Jellyfin pattern):**
```ts
const bitrate = hls.levels[hls.currentLevel]?.bitrate ?? 5000000;
const maxBufferLength = bitrate >= 25000000 ? 6 : 30; // Jellyfin's 25Mbps threshold
```

**Performance:**
- `FluxPlayer.tsx`: Replace `useState(current)` with a ref for `currentTime`. Only update state at 250ms intervals for UI display.
- Progress reporting already uses 5s interval — keep that.
- Memoize expensive calculations (playedPct, bufferedPct).

---

### Phase 6: Debug Overlay

**Objective:** Optional developer overlay showing playback diagnostics.

**State tracked:**
```ts
interface DebugInfo {
  playbackMethod: 'direct' | 'hls';
  videoCodec: string | null;
  audioCodec: string | null;
  currentBitrate: number;      // from hls.js
  currentResolution: string;   // e.g. "1920x1080"
  selectedQuality: string;     // "Auto" or "1080p"
  bufferSize: number;          // seconds buffered
  droppedFrames: number;       // video.getVideoPlaybackQuality()
  startupTime: number;         // ms from mount to first frame
  serverResponseTime: number;  // ms for /info endpoint
  abrSwitches: number;         // count of quality switches
}
```

**UI:** Semi-transparent overlay in top-left corner. Toggle with `Ctrl+Shift+D` or a hidden button.

---

## Phase 7: Incremental Improvement Notes

### Stream session persistence
Move `hlsSessions` Map to database (`TranscodeSession` model) for restart survival. Add TTL-based cleanup (BullMQ job or cron).

### Audio/subtitle stream selection
Add backend support for selecting specific audio/subtitle streams in the transcode. Currently uses `0:a:0?` which picks first audio. Add query params `audioIndex` and `subIndex` to the HLS endpoint.

### Chapter markers
Extract chapter metadata during import analysis (ffprobe `-show_chapters`). Store in `MediaInfo.chapters` JSON. Render chapter dots on the seek bar.

### Intro/credits detection
Deferred — requires either external plugin (like Jellyfin's intro-skipper) or ML-based detection. Not in scope for this overhaul.

---

## Execution Strategy

Use Hermes `delegate_task` with 3 parallel agents per phase:

| Phase | Agent 1 | Agent 2 | Agent 3 |
|-------|---------|---------|---------|
| 1 (DB) | Prisma schema + migration | Backend media-analyzer + service | Routes + API client |
| 2 (HLS) | Backend FFmpeg args + master playlist | Backend routes + session mgmt | Frontend player integration |
| 3 (UI) | Player settings component + CSS | Track/quality integration | Keyboard/touch/gesture polish |
| 4 (Trickplay) | Backend sprite generator + routes | Frontend VTT parser + preview | Import job integration |
| 5 (Preload) | Backend preload hints + cache | Frontend preload logic | Buffer + perf optimization |
| 6 (Debug) | Backend stats collection | Frontend debug overlay UI | Toggle + keyboard shortcut |

**After each phase:** Read all modified files, fix conflicts, run `npm run typecheck` and `npm run build`.

---
