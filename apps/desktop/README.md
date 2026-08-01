# Flux Desktop

Flux Desktop is a Windows-first Electron shell for a self-hosted Flux server. It loads the configured Flux deployment, keeps authentication cookies in an isolated persistent Electron session, and adds native integrations that a browser cannot provide.

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

For GitHub builds, add the ID as the repository variable `FLUX_DISCORD_CLIENT_ID` under Actions variables. The desktop app still runs if this variable is omitted, but Rich Presence stays disabled.

## GitHub Releases and updates

Publishing a semantic-version GitHub Release such as `v1.2.3` runs `.github/workflows/desktop-release.yml`. It builds and uploads:

- the NSIS installer;
- its blockmap;
- `latest.yml`, which `electron-updater` uses to discover and apply the release.

Installed builds check shortly after launch and every four hours. Updates download in the background, prompt for a restart when ready, and install automatically on a later quit if the user postpones the restart.

The GitHub Release tag is the desktop version source of truth. A published tag must use semantic versioning. Add a base64 certificate/PFX and password as the Actions secrets `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` to sign public installers. macOS auto-update support requires a separately signed/notarized macOS target.

## Security boundary

The remote Flux page runs with Node integration disabled, context isolation enabled, sandboxing enabled, and a narrow preload API. IPC calls validate the sender against the configured server origin. Cross-origin navigation opens in the system browser, and the desktop app never receives or stores Flux account credentials directly.
