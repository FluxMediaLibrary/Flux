# Flux for Roku

Flux for Roku is a native BrightScript and SceneGraph client for a self-hosted Flux server. It uses the same profiles, library, requests, stream analysis, transcoding, and watch progress as the web client. The Roku app never embeds a Flux server address, account password, or reusable account token.

## Requirements

- A Flux server with the Roku migrations applied and a URL reachable from the Roku
- Roku OS developer mode for sideloading, or a packaged channel release
- Node.js 22+ for validation and packaging
- FFmpeg and FFprobe on the Flux backend for analysis, HLS, and subtitle conversion
- HTTPS for production deployments

## Validate and package

From the repository root:

```powershell
npm install
npm run roku:test
npm run roku:check
npm run roku:package
```

The package is written to `apps/roku/dist/flux-roku-<version>.zip`. To sideload on Windows:

```powershell
./apps/roku/deploy-dev.ps1 -RokuIp 192.168.1.50 -Password '<developer-password>'
```

The shell equivalents are `package.sh` and `deploy-dev.sh`. Roku developer mode and sideloading are documented in the [official setup guide](https://developer.roku.com/dev/docs/developer-setup).

To enable developer mode, follow the Roku remote-key sequence in the official guide, accept the developer agreement, set a device password, and restart. Record the Roku's LAN IP from Settings > Network > About. Keep the developer password out of shell history and source control.

## First launch

1. Enter the public or LAN Flux backend origin, such as `https://flux.example.com`.
2. Flux validates `/api/client/bootstrap` and the Roku version contract.
3. The app displays a short code and the server's `/link` URL.
4. Sign in to the Flux website and approve the Roku.
5. Select a profile, then browse Home, Movies, Shows, Requests, or Search.

Server settings, device refresh credentials, the active profile, client preferences, and a small sanitized diagnostic ring buffer are stored in the Roku registry. Account passwords are never entered or stored on the Roku. Signing out revokes the server-side device session.

## Source layout

- `source/`: startup, routing, registry, version, logging, and playback helpers
- `components/screens/`: SceneGraph screens including the full-screen `Video` player
- `components/controllers/`: focused AppScene startup/auth, browse, playback, and settings controllers
- `components/tasks/`: background HTTP and device-link polling
- `images/`: packaged Flux artwork for FHD and HD
- `manifest`: channel metadata and version
- `package.*` and `deploy-dev.*`: deterministic packaging and sideloading

Backend discovery and playback decisions are authoritative. The Roku sends conservative capability data; the server selects direct play, HLS remux, or transcode and returns short-lived media-scoped URLs.

## Verification boundary

`npm run roku:check` performs BrightScript/SceneGraph compile validation plus package-structure checks. It does not emulate Roku OS media behavior. Final release approval requires sideloading on representative Roku hardware and running the matrix in `docs/roku-testing.md` against real Flux media.

## Known verification limits

- The off-device BrightScript suite does not emulate SceneGraph rendering, native remote focus behavior, codecs, DRM, captions, or the `Video` node.
- Store signing requires a physical developer-mode Roku and the channel's private developer key; `roku:package` produces an unsigned source/sideload zip.
- Direct/remux/transcode selection depends on real probe data and device capability, so it must be checked against representative HD and 4K hardware.
- Server-side requests can be disabled by configuration. Profile PIN entry is advertised as unsupported and is never bypassed by the client.
- `ROKU_HERO_ROTATION_SECONDS` controls automatic featured-item rotation; set it to `0` to disable rotation. Rotation pauses as soon as the viewer interacts with Home.

See `docs/roku-authentication.md`, `docs/roku-playback.md`, `docs/roku-publishing.md`, and `docs/roku-troubleshooting.md` for operational details.
