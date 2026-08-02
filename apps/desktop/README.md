# Flux Desktop

Flux Desktop is an Electron shell for Windows, macOS, and Linux that connects to a self-hosted Flux server. It loads the configured Flux deployment, keeps authentication cookies in an isolated persistent Electron session, and adds native integrations that a browser cannot provide.

## Local development

```powershell
npm install
$env:FLUX_DISCORD_CLIENT_ID='your-public-discord-application-id'
npm run dev:desktop
```

The first launch asks for an HTTP(S) Flux server URL and checks its `/health` endpoint before saving it. The address can be changed later from the application menu or the profile menu in Flux.

## Discord Rich Presence

Create a Discord application named `Flux`, upload a square fallback art asset with the key `flux`, and set its public application ID in `FLUX_DISCORD_CLIENT_ID`. No client secret or user token is used.

While the desktop client is on a watch page, the frontend sends the movie/show title, season and episode, poster URL, pause state, and authoritative player position to the isolated preload bridge. The main process publishes a Watching activity with a repository button and start/end timestamps. Discord's buttons are only visible to other users viewing the presence.

The public Discord application ID is stored in the desktop package metadata. `FLUX_DISCORD_CLIENT_ID` can override it for a local build; no Discord secret or user token is used.

## Local packaging and GitHub Releases

Publishing a `pc-v<version>` GitHub Release builds and uploads ready-to-use packages for Windows, macOS, and Linux. Android releases use their own tags and never enter the desktop update channel. The local script provides a manual rebuild/upload path when needed.

The package version in `apps/desktop/package.json` must match the release tag. To rebuild a platform locally, create or reuse a release such as `pc-v1.2.3`, then run:

```powershell
# Windows: NSIS installers for x64 and ARM64
powershell -ExecutionPolicy Bypass -File ./scripts/release-desktop.ps1 -Platform win -Tag pc-v1.2.3

# macOS: DMG and ZIP packages for Intel and Apple Silicon
pwsh ./scripts/release-desktop.ps1 -Platform mac -Tag pc-v1.2.3

# Linux: AppImage, Debian, and RPM packages for x64 and ARM64
pwsh ./scripts/release-desktop.ps1 -Platform linux -Tag pc-v1.2.3
```

The script authenticates with GitHub CLI, runs the desktop tests, builds locally, and uploads the installers plus platform update metadata and blockmaps directly to the existing release. macOS packages must be produced on macOS; they cannot be built on Windows.

Installed builds check shortly after launch and every four hours. Updates download in the background, prompt for a restart when ready, and install automatically on a later quit if the user postpones the restart.

The highest published `pc-v` tag is the desktop version source of truth, even when a newer Android release exists. Desktop release tags must use `pc-v` followed by semantic versioning. Builds are currently unsigned, so Windows SmartScreen and macOS Gatekeeper can warn users. macOS automatic installation requires a future signed/notarized build; unsigned macOS packages remain available for manual installation.

## Security boundary

The remote Flux page runs with Node integration disabled, context isolation enabled, sandboxing enabled, and a narrow preload API. IPC calls validate the sender against the configured server origin. Cross-origin navigation opens in the system browser, and the desktop app never receives or stores Flux account credentials directly.
