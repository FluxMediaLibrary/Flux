# Flux Player Replacement — Vidstack Integration Plan

> **For Hermes:** Use the flux skill + parallel-subagents workflow. Dispatch 3 agents per phase.

**Goal:** Completely replace Flux's hand-rolled video player with Vidstack v1.15.x as the playback engine, building a custom Flux-branded UI layer on top.

**Architecture:** Vidstack handles all playback concerns (HLS, ABR, buffering, seeking, fullscreen, PiP, AirPlay, Chromecast, keyboard shortcuts, captions). Flux provides a custom UI (controls, settings, timeline, thumbnails, chapter/intro markers, debug overlay) and API integration. The backend streaming pipeline (direct play, HLS transcode, adaptive master playlists) remains unchanged — it already produces standard HLS that Vidstack consumes natively.

**Tech Stack:** `@vidstack/react@next` (v1.15.6), React 19, Next.js 16, existing backend (Fastify + FFmpeg HLS)

---

## Research Summary

### Library Comparison

| Criterion | Vidstack v1.15 | hls.js alone | Shaka Player | Video.js | Media Chrome |
|-----------|---------------|--------------|--------------|----------|--------------|
| HLS playback | ✅ Built-in (hls.js under the hood) | ✅ Native | ✅ | ✅ | ⚠️ BYO provider |
| Adaptive bitrate | ✅ Auto + manual level select | ✅ `hls.currentLevel` | ✅ | ✅ | ❌ You build it |
| Quality switching | ✅ `qualityList` + menu API | ⚠️ Manual | ✅ | ✅ | ❌ |
| Subtitle tracks | ✅ Built-in captions renderer (VTT/SRT/SSA) | ⚠️ Manual via `subtitleTracks` | ✅ | ✅ via plugins | ❌ |
| Audio tracks | ✅ Built-in audio track menu | ⚠️ Manual | ✅ | ✅ | ❌ |
| Thumbnail scrubbing | ✅ `SliderThumbnail` component | ❌ | ❌ | ❌ | ❌ |
| Keyboard shortcuts | ✅ Built-in, customizable | ❌ | ❌ | ❌ | ❌ |
| Mobile support | ✅ Gestures, playsInline normalization | ⚠️ You build it | ✅ | ✅ | ⚠️ |
| TV compatibility | ✅ AirPlay, Google Cast built-in | ❌ | ❌ | ❌ | ❌ |
| React integration | ✅ First-class React components + hooks | ⚠️ Manual ref wrangling | ❌ No React lib | ⚠️ Wrapper needed | ✅ Web Components |
| Custom UI | ✅ Headless components + 18+ hooks | ❌ From scratch | ❌ | ❌ | ⚠️ Bare-bones |
| Bundle size | 54 kB gzip (core) | ~170 kB | ~500 kB | 195 kB gzip | ~30 kB |
| Maintenance | ✅ Active (v1.15.6, June 2026) | ✅ Active | ✅ Active | ✅ Active | ✅ Mux-backed |
| React 19 compat | ✅ Working (confirmed by users) | ✅ | N/A | ⚠️ | ✅ |

### Decision: Vidstack v1.15.6

Vidstack is the clear winner. It provides everything Flux needs out of the box while maintaining a headless architecture that lets us build our own UI. Key advantages:

1. **Battle-tested** — originally built for Reddit at scale
2. **Active maintenance** — v1.15.6 released June 2026, PRs merged regularly
3. **React 19 compatible** — users confirm it works with Next.js 15 + React 19
4. **Headless components** — build Flux's UI without fighting a pre-built skin
5. **Migration path** — creator says Vidstack → Video.js v10 migration will be "smooth"
6. **Package**: `npm install @vidstack/react@next` → v1.15.6

### What Vidstack handles (we don't build)
- Playback state management (playing, paused, buffering, seeking, waiting)
- HLS streaming via hls.js (auto-loaded when HLS src is provided)
- Adaptive bitrate (auto quality selection + level switching API)
- Quality levels (`MediaQualityList` → `qualityList`)
- Audio tracks (`MediaAudioTrackList` → `audioTracks`)
- Subtitle/caption tracks (`MediaTextTrackList` → `textTracks`) with custom captions renderer
- Fullscreen API normalization
- Picture-in-Picture
- AirPlay + Google Cast
- Keyboard shortcuts (Space, arrows, F, M, etc.)
- Cross-browser quirks (iOS inline playback, native fullscreen differences)
- Media events system (play, pause, seeking, timeupdate, volumechange, etc.)
- Chapter markers on sliders
- Tooltips and menus

### What Flux builds (our custom UI)
- Control bar with Flux-branded styling
- Custom timeline/seek bar with buffered + played indicators
- Quality selection menu (Auto, 4K, 1440p, 1080p, 720p, 480p, 360p)
- Audio track selector
- Subtitle track selector (embedded + external)
- Playback speed selector
- Volume slider
- Thumbnail scrubbing (sprite sheet + WebVTT generated at import time)
- Chapter markers on timeline
- Intro skip / recap skip / credits skip (custom markers)
- Debug statistics overlay (Ctrl+Shift+D)
- Continue watching (progress reporting every 5s + on pause/visibilitychange)
- Cast button (Chromecast + Remote Playback)
- Settings panel (gear icon → quality/audio/subs/speed/stats)

---

## Architecture Layers

```
┌─────────────────────────────────────────┐
│           Flux Features                  │
│  (chapters, intro skip, thumbnails,     │
│   continue watching, debug overlay)      │
├─────────────────────────────────────────┤
│           Flux Player UI                 │
│  (control bar, timeline, settings,      │
│   quality menu, volume, cast button)    │
├─────────────────────────────────────────┤
│      Flux Playback Controller           │
│  (API integration, source selection,    │
│   progress reporting, playback decision) │
├─────────────────────────────────────────┤
│       Vidstack Playback Engine          │
│  (HLS/MP4 playback, ABR, seeking,      │
│   fullscreen, PiP, captions, keyboard)  │
└─────────────────────────────────────────┘
```

The playback engine (Vidstack) is replaceable — we could swap to Video.js v10 in the future without rewriting the Flux UI layer.

---

## Phased Implementation Plan

### Phase 1: Foundation — Install Vidstack & Replace Core Player

**Goal:** Install Vidstack, create the new FluxPlayer shell, remove the old player, verify basic playback works.

#### Task 1.1: Install Vidstack packages

```
cd packages/frontend
npm install @vidstack/react@next --legacy-peer-deps
```

Files to update:
- `packages/frontend/package.json` — add `@vidstack/react` dependency

Expected: package installs, `npm run typecheck` passes (no imports yet).

#### Task 1.2: Create the new FluxPlayer shell

Create: `packages/frontend/components/FluxPlayer2.tsx`

Minimal Vidstack player setup:
```tsx
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  MediaPlayer,
  MediaProvider,
  type MediaPlayerInstance,
} from '@vidstack/react';

interface FluxPlayerProps {
  mediaItemId: string;
  episodeId?: string;
  title: string;
  subtitle?: string;
  startPositionSeconds?: number;
  fill?: boolean;
  onProgress?: (positionSeconds: number, durationSeconds: number) => void;
  onBack?: () => void;
  onNearEnd?: () => void;
}

export function FluxPlayer2(props: FluxPlayerProps) {
  const playerRef = useRef<MediaPlayerInstance>(null);
  // ... state and effects

  return (
    <MediaPlayer
      ref={playerRef}
      src={/* HLS or direct stream URL */}
      aspectRatio="16/9"
      load="visible"
      playsInline
      crossOrigin
    >
      <MediaProvider />
      {/* Custom Flux UI to be added in later phases */}
    </MediaPlayer>
  );
}
```

#### Task 1.3: Wire source selection logic

Port the existing `decidePlayback` pattern:
- Call `api.getPlaybackInfo(mediaItemId, episodeId)` 
- If `directPlay` → set `src` to direct stream URL (MP4)
- If HLS → set `src` to HLS master/index.m3u8 URL

Vidstack auto-detects HLS vs MP4 from the URL extension and loads hls.js automatically for `.m3u8` sources.

#### Task 1.4: Update watch page to use FluxPlayer2

Modify: `packages/frontend/app/(member)/watch/[id]/page.tsx`
- Import `FluxPlayer2` instead of `FluxPlayer`
- Keep all existing props and progress handling

#### Task 1.5: Add Vidstack CSS imports

Add to `packages/frontend/app/globals.css` or the watch page layout:
```css
@import '@vidstack/react/player/styles/default/theme.css';
@import '@vidstack/react/player/styles/default/layouts/video.css';
```

We'll customize these later, but start with the default theme for baseline functionality.

#### Task 1.6: Remove old player CSS

Search `globals.css` for all `.vp-*` selectors and either:
- Remove them (we'll rewrite them in Phase 2)
- Comment them out with a migration note

#### Verification:
- `npm run typecheck` passes
- `npm run build` passes
- Navigate to a watch page — video plays with Vidstack default controls
- HLS stream starts and plays
- Direct play MP4 works
- Seeking works via default Vidstack controls

---

### Phase 2: Custom Flux UI — Control Bar & Timeline

**Goal:** Replace Vidstack's default controls with Flux-branded custom controls. Build the timeline, control bar, and basic overlays.

#### Task 2.1: Create custom control bar component

Create: `packages/frontend/components/player/ControlBar.tsx`

Use Vidstack's headless components and state hooks:
- `useMediaState()` for playing, currentTime, duration, buffered, volume, muted
- `useMediaRemote()` for play(), pause(), seek(), changeVolume()
- Custom-styled buttons with Flux SVG icons (from old FluxPlayer)
- Glass-effect background bar at the bottom

Structure:
```
<ControlBar>
  <PlayButton />
  <SkipBackward seconds={10} />
  <SkipForward seconds={10} />
  <VolumeControl />
  <TimeDisplay />  {/* current / duration */}
  <Spacer />
  <SpeedButton />
  <CastButton />
  <SettingsButton />
  <FullscreenButton />
</ControlBar>
```

#### Task 2.2: Create custom timeline/seek bar

Create: `packages/frontend/components/player/Timeline.tsx`

Vidstack provides `TimeSlider` as a headless component. We style it:
- Track background (dark glass)
- Buffered indicator (lighter glass)
- Played indicator (Flux accent color)
- Thumb (circle, scales on hover/drag)
- Hover tooltip with time
- Touch-friendly (40px hit area)

Use Vidstack's `TimeSlider` component + CSS custom properties.

#### Task 2.3: Create title overlay

Create: `packages/frontend/components/player/TitleOverlay.tsx`
- Top gradient overlay
- Back button (left)
- Title + subtitle (center-left)
- Auto-hides with controls

#### Task 2.4: Create buffering spinner

Use Vidstack's built-in `isBuffering` state via `useMediaState()`.
Style a Flux-branded spinner in the center.

#### Task 2.5: Create error overlay

Styled error message with retry button.
Listen to Vidstack's error events via `useMediaState().error`.

#### Task 2.6: Wire controls visibility

Port the auto-hide logic:
- Show controls on mouse move / tap
- Hide after 3s of inactivity (when playing)
- Always visible when paused
- CSS transitions for smooth fade

#### Task 2.7: Remove Vidstack default layout

In the `MediaPlayer` JSX, remove the `<DefaultVideoLayout />` import.
Replace with our custom components:
```tsx
<MediaPlayer ...>
  <MediaProvider />
  <TitleOverlay />
  <div className="flux-center-overlay">
    {isBuffering && <Spinner />}
  </div>
  <ControlBar>
    <Timeline />
    {/* buttons */}
  </ControlBar>
  <ErrorOverlay />
</MediaPlayer>
```

#### Verification:
- Player starts with Flux-styled controls
- Timeline scrubbing works smoothly
- Play/pause, volume, fullscreen all work
- Controls auto-hide and reappear
- Buffering spinner appears during load
- Error overlay appears on failures
- Mobile touch works

---

### Phase 3: Settings Panel — Quality, Audio, Subtitles, Speed

**Goal:** Build the gear-icon settings panel with quality, audio track, subtitle, and speed selectors.

#### Task 3.1: Quality selector

Vidstack exposes `qualityList` via `useMediaState()`. Build a menu:
```
Quality ▸
  Auto        ✓
  4K (2160p)
  1440p
  1080p
  720p
  480p
  360p
```

Use Vidstack's quality API:
- `useMediaState().qualityList` — available quality levels
- `useMediaRemote().changeQuality(index, type)` — switch quality

Map Vidstack quality indices to our labels (height-based).

#### Task 3.2: Audio track selector

```
Audio ▸
  English      ✓
  Japanese
  Commentary
  Director's Commentary
```

Use `useMediaState().audioTracks` and `useMediaRemote().changeAudioTrack(index)`.

#### Task 3.3: Subtitle selector

```
Subtitles ▸
  Off           ✓
  English
  English [SDH]
  Japanese
```

Use `useMediaState().textTracks` and `useMediaRemote().changeTextTrack(index)`.

Also support subtitles as a standalone toggle button (separate from settings).

#### Task 3.4: Playback speed selector

```
Speed ▸
  0.5×
  1× (Normal)   ✓
  1.25×
  1.5×
  2×
```

Use `useMediaState().playbackRate` and `useMediaRemote().changePlaybackRate(rate)`.

#### Task 3.5: Settings panel component

Create: `packages/frontend/components/player/SettingsPanel.tsx`
- Gear icon trigger
- Slide-in panel (animated, glass effect)
- Nested submenus (clicking "Quality" opens sub-panel)
- Close on outside click / Escape key
- Position: bottom-right above the control bar

#### Verification:
- Settings panel opens/closes smoothly
- Quality switching works during playback (no restart)
- Audio track switching works during playback
- Subtitle toggling works during playback
- Speed changes take effect immediately
- Mobile-friendly (touch targets)

---

### Phase 4: Thumbnail Scrubbing & Timeline Markers

**Goal:** Implement thumbnail previews on timeline hover/drag and chapter/intro markers.

#### Task 4.1: Generate thumbnail sprite sheets at import time

Backend: Wire the existing `trickplay-generator.ts` into the post-process pipeline.

After a torrent finishes downloading and media analysis completes:
1. Generate sprite sheet: N×M grid of JPG thumbnails at ~10s intervals
2. Generate WebVTT metadata file mapping time ranges → sprite coordinates
3. Store alongside the media file or in a dedicated directory

Files to modify:
- `packages/backend/src/lib/trickplay-generator.ts` — ensure it produces WebVTT
- `packages/backend/src/modules/torrents/postprocess.ts` — call generator after analysis
- `packages/backend/src/modules/streaming/streaming.routes.ts` — add route to serve sprite sheets + VTT

#### Task 4.2: Serve trickplay assets

Add route: `GET /api/stream/:mediaItemId/trickplay/:file`
- Serve sprite sheet JPGs
- Serve WebVTT metadata

The WebVTT format:
```vtt
WEBVTT

00:00:00.000 --> 00:00:10.000
thumbnails.jpg#xywh=0,0,160,90

00:00:10.000 --> 00:00:20.000
thumbnails.jpg#xywh=160,0,160,90
```

#### Task 4.3: Frontend: thumbnail preview on scrub

Vidstack provides `SliderThumbnail` component. Wire it to our trickplay WebVTT.

Alternatively, build a custom thumbnail preview that appears above the timeline:
- On hover/drag, calculate the hovered time
- Map time → WebVTT entry → sprite coordinates
- Render a preview div with the sprite as background-image

Use Vidstack's `SliderPreview` or a custom implementation sitting above the `TimeSlider`.

#### Task 4.4: Chapter markers

If chapters exist (from media metadata or external files):
- Display thin vertical markers on the timeline
- On hover, show chapter title tooltip
- Allow clicking to jump to chapter start

Use Vidstack's `SliderChapters` component or custom markers overlaying the `TimeSlider`.

#### Task 4.5: Intro/Recap/Credits skip markers

The backend already has a `playback_markers` table. Use it:

- During playback, when currentTime enters a marker range, show a "Skip Intro" button
- Button appears in the bottom-right, Netflix-style
- Clicking skips to the marker's end time

Create: `packages/frontend/components/player/SkipButton.tsx`

API integration:
- `api.getPlaybackMarkers(mediaItemId, episodeId)` → list of markers
- On timeupdate, check if we're inside a marker's range
- Show skip button if yes

#### Verification:
- Thumbnails appear when hovering/dragging timeline
- Chapter markers render on timeline
- Clicking chapter marker seeks to chapter
- "Skip Intro" button appears during intro segments
- "Skip Credits" button appears during credits
- All work without extra server calls during scrubbing

---

### Phase 5: Continue Watching & Progress Reporting

**Goal:** Update continue watching in real time during playback.

#### Task 5.1: Progress reporting with Vidstack events

Port the existing progress reporting from the old FluxPlayer:
- Report every 5 seconds via `setInterval`
- Report on pause event
- Report on `visibilitychange` (tab hidden)
- Report on `pagehide` / before unload

Use Vidstack's event system: `playerRef.current?.subscribe()` for pause, timeupdate, etc.

#### Task 5.2: Resume playback from saved position

On mount, read `startPositionSeconds` prop and seek to it:
```tsx
// After media is loaded
playerRef.current?.seek(startPositionSeconds);
```

Vidstack's `canPlay` event signals when seeking is safe.

#### Task 5.3: Next-episode preloading

Port the `onNearEnd` callback:
- When playback reaches 85%, fire `onNearEnd()`
- The watch page calls `api.getPlaybackInfo()` to warm the cache

Use Vidstack's `timeUpdate` event.

#### Verification:
- Progress saves while watching (check DB)
- Refreshing the page resumes from saved position
- Switching between episodes works
- Next episode preloading fires at 85%

---

### Phase 6: Debug Statistics Overlay

**Goal:** Toggleable debug overlay with playback statistics.

#### Task 6.1: Debug overlay component

Create: `packages/frontend/components/player/DebugOverlay.tsx`

Toggle: Ctrl+Shift+D (same as old player)

Stats to show:
- **Playback Method**: Direct Play / Direct Stream / Transcode (from `api.getPlaybackInfo`)
- **Codec**: Video codec + Audio codec (from playback info)
- **Resolution**: Current video width × height (`useMediaState().width` × `height`)
- **Bitrate**: Current quality level bitrate (from `qualityList`)
- **Selected Quality**: Auto / 1080p / etc.
- **Buffer Length**: Seconds buffered ahead (from Vidstack buffered state)
- **Dropped Frames**: `video.getVideoPlaybackQuality().droppedVideoFrames`
- **Current FPS**: Approximate via `getVideoPlaybackQuality().totalVideoFrames / elapsed`
- **Audio Codec**: From playback info
- **Subtitle Status**: Active track or "Off"

Use Vidstack's `useMediaState()` for most values. Poll dropped frames via a ref to the underlying `<video>` element: `playerRef.current?.provider?.video`.

#### Verification:
- Ctrl+Shift+D toggles overlay
- All stats display accurate values
- Values update in real time during playback
- Overlay is non-interactive (doesn't block clicks)

---

### Phase 7: Casting & Remote Playback

**Goal:** Integrate Chromecast and Remote Playback with Vidstack.

#### Task 7.1: Google Cast

Vidstack has built-in Google Cast support via the `googleCast` prop on `<MediaPlayer>`.

Port the existing cast integration from `cast.ts`:
- `useCast()` hook for detecting cast availability
- Cast button in control bar
- "Playing on TV" overlay when casting

Since Vidstack already handles cast natively, we may be able to simplify: use Vidstack's built-in cast button or hook into its cast state via `useMediaState().remote`.

#### Task 7.2: Remote Playback (Android TV)

Vidstack supports `playsInline` and remote playback. Port the existing Remote Playback API integration from the old FluxPlayer.

#### Verification:
- Cast button appears when Chromecast is available
- Casting starts when button is clicked
- "Playing on TV" overlay appears
- Local playback pauses when casting
- Remote Playback works on Android

---

### Phase 8: Polish — Animations, Mobile, TV, Glass Effects

**Goal:** Make the player look premium. Flux-branded, inspired by Netflix/Jellyfin/Plex but unique.

#### Task 8.1: CSS polish

- Glass effects (backdrop-filter) on control bar and overlays
- Smooth CSS transitions on all interactive elements
- Flux emerald accent color for played track, buttons, highlights
- Dark gradient overlays (top and bottom)
- Custom scrollbar styling if needed

#### Task 8.2: Animations

- Controls fade in/out (opacity + translateY)
- Center play button scales on hover
- Timeline thumb scales on hover/drag
- Settings panel slides in from right
- Skip button fades in from bottom-right
- Error overlay fades in

All animations use CSS transitions/animations. No JS animation libraries needed.

#### Task 8.3: Mobile support

- Responsive control sizing (larger touch targets on mobile)
- Full-width controls on small screens
- Volume slider hidden on mobile (use device buttons)
- Landscape/portrait handling
- Gesture support (double-tap to skip, swipe for volume — Vidstack provides these)

#### Task 8.4: TV/controller support

- Focus management for controller navigation
- Visible focus indicators on all buttons
- Media session API integration (show title/artwork on lock screen)

#### Task 8.5: Typography

Use the project's existing fonts:
- Bricolage Grotesque for headings
- Inter for body text
- JetBrains Mono for debug overlay

---

### Phase 9: Cleanup — Remove Old Player

**Goal:** Delete all old player code and CSS once the new player is stable.

#### Task 9.1: Delete old FluxPlayer

Remove: `packages/frontend/components/FluxPlayer.tsx`

#### Task 9.2: Remove old player CSS

Clean up `globals.css`:
- Remove all `.vp-*` selectors
- Remove old player SVG icon styles
- Keep only new player styles

#### Task 9.3: Rename FluxPlayer2 → FluxPlayer

- Rename the file
- Update all imports

#### Task 9.4: Remove hls.js direct dependency

If Vidstack bundles hls.js internally and we no longer import it directly, remove `hls.js` from `package.json`.

Check: Vidstack imports hls.js dynamically when HLS sources are used. We no longer need to import it ourselves.

#### Verification:
- `npm run typecheck` passes
- `npm run build` passes
- No references to old `FluxPlayer` remain
- No `.vp-*` CSS remains
- No unused `hls.js` import

---

## Backend Changes Needed

### Trickplay sprite sheet serving
- Add route: `GET /api/stream/:mediaItemId/trickplay/:file`
- Wire `trickplay-generator.ts` into post-processing pipeline

### Playback markers endpoint
- Already exists via `playback_markers` table
- May need a dedicated endpoint: `GET /api/stream/:mediaItemId/markers?episodeId=`

Everything else (direct play, HLS transcode, adaptive master playlists, thumbnail frames, progress saving) already works with standard HLS — Vidstack consumes it without changes.

---

## File Map

### New files
```
packages/frontend/components/player/
├── FluxPlayer.tsx            # Main player component (replaces old FluxPlayer)
├── ControlBar.tsx            # Bottom control bar
├── Timeline.tsx              # Seek bar with buffered/played indicators
├── TitleOverlay.tsx          # Top title bar
├── SettingsPanel.tsx         # Gear icon settings (quality/audio/subs/speed)
├── DebugOverlay.tsx          # Ctrl+Shift+D statistics
├── SkipButton.tsx            # "Skip Intro" / "Skip Credits" button
├── ThumbnailPreview.tsx      # Hover thumbnail on timeline
├── ChapterMarkers.tsx        # Chapter markers on timeline
├── CastButton.tsx            # Chromecast + Remote Playback
├── ErrorOverlay.tsx          # Error display with retry
├── Spinner.tsx               # Buffering spinner
└── icons.tsx                 # SVG icons (ported from old FluxPlayer)
```

### Modified files
```
packages/frontend/
├── package.json                     # Add @vidstack/react
├── app/globals.css                  # Replace .vp-* with new player CSS
├── app/(member)/watch/[id]/page.tsx # Use new FluxPlayer
├── lib/api.ts                       # Add trickplay URL builder, markers endpoint
```

```
packages/backend/src/
├── lib/trickplay-generator.ts       # Ensure WebVTT output
├── modules/torrents/postprocess.ts  # Wire trickplay generation
├── modules/streaming/
│   ├── streaming.routes.ts          # Add trickplay serve route
│   └── streaming.service.ts        # No changes needed (already produces standard HLS)
```

### Removed files
```
packages/frontend/
├── components/FluxPlayer.tsx        # Old player (deleted in Phase 9)
├── lib/cast.ts                      # If Vidstack handles cast natively
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Vidstack v1.15.x is on `next` tag, not `latest` | v1.15.6 has 26k weekly downloads and active maintenance. The `latest` tag (0.6.15) is the abandoned v0.x rewrite. Use `@vidstack/react@next` explicitly. |
| Migrating to Video.js v10 later | Vidstack creator says migration will be "smooth." The custom UI we build sits above Vidstack's component API — replacing the engine underneath is the designed architecture. |
| React 19 compatibility issues | Users confirm it works. v1.15.x fixed React 19 element ref warnings (PR #1815). Install with `--legacy-peer-deps` if needed. |
| Trickplay generation overhead | Generate sprite sheets at import time (post-processing), not on demand. One-time cost. |
| External subtitles not supported by Vidstack HLS | Our server embeds subtitles into the HLS manifest during transcode. For direct-play MP4, we can serve external VTT via Vidstack's `textTracks` API. |
| Cast integration may conflict with Vidstack's built-in cast | Test both paths. Use Vidstack's native cast if it works; fall back to our SDK integration if needed. |

---

## Verification Checklist

- [ ] `npm run typecheck` passes throughout all phases
- [ ] `npm run build` passes
- [ ] Video plays in direct-play mode (MP4/H.264/AAC)
- [ ] Video plays in HLS mode (transcoded)
- [ ] Adaptive HLS (multi-quality master playlist) works with quality switching
- [ ] Seek bar scrubbing is smooth and accurate
- [ ] Thumbnail previews appear on hover/drag
- [ ] Chapter markers display on timeline
- [ ] "Skip Intro" button appears and works
- [ ] Quality switching doesn't restart playback
- [ ] Audio track switching works during playback
- [ ] Subtitle toggling works during playback
- [ ] Playback speed changes take effect
- [ ] Fullscreen toggle works
- [ ] Picture-in-Picture works
- [ ] Keyboard shortcuts work (Space, arrows, F, M)
- [ ] Controls auto-hide after 3s when playing
- [ ] Mobile touch controls work
- [ ] Continue watching updates in real time
- [ ] Debug overlay (Ctrl+Shift+D) shows accurate stats
- [ ] Chromecast casting works (if hardware available)
- [ ] No visual regressions from old player
