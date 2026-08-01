# Flux Android changelog

## 1.1.6 — 2026-08-01

### Fixed

- Fixed **Next Episode** starting at the timestamp carried over from the previous episode while casting.
- Made Cast episode changes issue one atomic receiver load at `0:00` for both direct-play and HLS media.
- Added media and episode identity to Cast state so stale receiver time cannot be applied or saved against the incoming episode.

### Verification

- Passed the focused Cast episode-identity regression tests.
- Passed frontend typechecking, lint, and the production build.
- Compiled and packaged the signed Android application against SDK 35 and Google Cast Framework 22.0.0.

## 1.1.5 — 2026-08-01

### Added

- Converted the in-app player into a live remote while media is playing on a Cast receiver.
- Added Cast-aware play, pause, ten-second skip, timeline seek, volume, mute, and Skip Intro controls.
- Added an **Intros** admin workspace for selecting seasons, starting scan queues, and viewing coverage.
- Added live intro-scan stages, percentage progress, worker logs, results, and recent run history.
- Added detailed FFmpeg and Chromaprint diagnostics to failed fingerprint entries.

### Fixed

- Fixed completed intro jobs preventing later rescans of the same season.
- Fixed Chromaprint scans failing every episode when the requested fingerprint window ended exactly at EOF.
- Fixed intro matching across codec/encode variations by using tolerant fingerprint alignment and whole-segment confidence checks.
- Fixed player time, title, duration, buffering, and playback state not following the Cast receiver.
- Fixed HLS Cast seeks so forward, backward, timeline, and Skip Intro requests restart at the requested absolute position.
- Preserved manual intro markers unless an administrator explicitly enables forced overwrite.

### Verification

- Passed 26 backend tests and all shared, backend, and frontend production builds.
- Verified detection against real Chromaprint output from MP3, AAC, Opus, and FLAC encodes with different cold-open offsets.
- Verified the Intros queue, progress console, responsive layout, and repeat scans in the browser.
- Compiled and packaged the Android application against SDK 35 and Google Cast Framework 22.0.0.
