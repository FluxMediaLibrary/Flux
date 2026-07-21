# Flux Roku changelog

## 1.0.0 (Roku build 11) — cinema-layout correction

- Replaced the remaining legacy screen geometry with a full-width television composition: Home now uses a horizontal command rail, a 1776px feature stage, and larger content rails instead of the former fixed sidebar layout.
- Re-composed library, search, requests, settings, profiles, season, details, episode, onboarding, recovery, splash, and player surfaces around the same cinema canvas so layout—not merely colors and controls—changes across the application.
- Added layout contracts to Roku validation so the old Home/sidebar geometry and small-card grid cannot silently return.

## 1.0.0 (Roku build 11)

- Rebuilt the Roku SceneGraph interface with a unified television-safe design system, premium browse surfaces, shared media cards, and consistent player, onboarding, dialog, and settings presentation.
- Added an in-player D-pad control hub for audio tracks, captions, and stream-quality preferences; selections resume at the current playback position through the Roku playback resolver.
- Replaced stock Roku transport controls with Flux seek, elapsed-time, duration, pause/resume, and remote-seek chrome.
- Added a typed Roku trailer contract that exposes a Flux web destination only when TMDb metadata has a trailer; external YouTube embed pages are never misrepresented as native Roku playback.
- Added an explicit Debug settings category, voice-search handoff, a non-focusable in-player buffering indicator, and a recoverable playback-error decision flow.
- Hardened image-load and API-shape failures with packaged-art fallbacks and user-facing retry states, including device-link/profile activation validation.
- Fixed Roku hardware transport input: custom player controls now hold focus on an invisible capture node so `Video` cannot swallow Select, seek, or options commands.

## 1.0.0

- Added the native SceneGraph application, configurable server startup, secure device linking, profile selection, server-driven home/library/search/request screens, details and episodes, deep links, settings, sanitized diagnostics, validation, packaging, and sideload tooling.
- Added persistent scoped playback sessions, device-aware direct/remux/transcode decisions, resume and progress synchronization, URL recovery, WebVTT subtitle conversion, native audio/caption selection, playback markers, Skip Intro, Up Next, and autoplay.
- Added hero artwork, dedicated season navigation, watched/genre filters and sort controls, recent searches, focus-safe empty states, remote configuration, branded placeholders, and off-device BrightScript unit tests.
- Completed the interactive home hero with rich metadata, progress, Play/Resume and Details actions, plus server-configured rotation that pauses on remote interaction.
- Added typed episode details, independently retryable Home rows, route integration tests, navigation-contract validation, and focused AppScene controller modules.
