# Flux Android casting and updater audit

Audit completed before the rewrite on 2026-07-17.

## Existing application

Flux Android is a native Java Android shell around a `WebView`, not a TWA, Capacitor, Cordova, React Native, or a native media player. It uses Google Cast Framework (`play-services-cast-framework`) plus AndroidX MediaRouter. The Google Default Media Receiver is configured through `FluxCastOptionsProvider`.

## Casting findings

1. Two sender paths were live simultaneously: `MainActivity` rendered a native `MediaRouteButton`, while `ControlBar.tsx` injected the Google Cast Web Sender SDK and rendered a second launcher. Vidstack also had Google Cast enabled.
2. The old paths called `GET /api/stream/:id/cast-info`, so metadata could reach the receiver even when the actual receiver stream was inaccessible or a duplicate sender controlled the session.
3. That endpoint embedded a general profile JWT in the receiver URL. The TV fetches media itself without WebView cookies, which explains title-without-video failures across different network, TLS, and HLS child-request conditions.
4. HLS resume was inconsistent: the stream received a generated offset while the receiver was loaded at zero. Receiver requests also depended on token propagation and CORS through every manifest level.
5. The web sender was not a safe Android fallback and created a duplicate/blank control surface.

## Replacement decisions

- One application-level Google Cast sender owns discovery, session restoration, and remote controls. Android exposes one native `MediaRouteButton`.
- The WebView reports playback context through a narrow native bridge; it does not host a Cast SDK or Cast button.
- `POST /api/cast/sessions` creates a short-lived receiver-only URL, checked against an in-memory grant limited to one media item, episode, account, and profile.
- The Default Media Receiver remains appropriate for standard media control. Flux direct-plays only MP4/H.264/AAC; all other media uses the existing HLS/FFmpeg fallback.
- APK updates move out of the web banner into a verified Android downloader and installer backed by a server-owned release manifest.

## Test boundary

The workspace can validate contracts, builds, and signing. Physical Chromecast/Vizio playback, TV network/TLS reachability, and an actual device upgrade require target hardware and a deployed HTTPS Flux server; they cannot be claimed from a local build alone.
