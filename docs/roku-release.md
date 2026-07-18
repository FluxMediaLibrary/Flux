# Roku release and operations

## Server deployment

1. Back up PostgreSQL.
2. Set the Roku environment variables shown in `.env.example`, especially `PUBLIC_API_BASE_URL`, `FLUX_SERVER_NAME`, and the version bounds.
3. Apply Prisma migrations before deploying the backend.
4. Confirm FFmpeg/FFprobe, media roots, and transcode storage permissions.
5. Probe `/health`, `/api/client/bootstrap`, `/api/clients/roku/version`, and `/api/clients/roku/config` from the Roku network.
6. Complete the hardware matrix before widening availability.

Rollback the backend and database together if a migration or playback contract fails. Device sessions can be revoked server-side without clearing Roku registry data. Expired playback rows remain non-authoritative audit state; active access is denied by state and expiry.

## Channel release

Increment `major_version`, `minor_version`, or `build_version` in `apps/roku/manifest`, update `apps/roku/CHANGELOG.md`, run the complete matrix, then generate the zip with `npm run roku:package`. Roku-hosted production channels update through Roku's managed channel system; the app's version endpoint is for compatibility gates and user messaging, not a custom binary updater.

Follow Roku's official [manifest](https://developer.roku.com/dev/docs/channel-manifest), [packaging](https://developer.roku.com/dev/docs/packaging-channels), and [publishing](https://developer.roku.com/dev/docs/channel-publishing-guide) documentation for signing and Streaming Store submission.

## Submission checklist

- unique channel identity, localized title/description, artwork, screenshots, and support contact
- privacy policy URL and accurate disclosure of server/account/device data handling
- complete deep-link behavior and certification test cases
- captions and audio selection verified with the native Options overlay
- no localhost, private test credentials, developer passwords, or personal server URLs in the package
- production HTTPS certificate chain accepted by Roku hardware
- package version matches release notes and server version bounds

## Current candidate record

The 2026-07-17 unsigned sideload candidate is `apps/roku/dist/flux-roku-1.0.0.zip` (218,217 bytes, 62 entries) with SHA-256 `0735189F18F5232493E9C482C0C00B8CEF7495AC96D7E2BFF54A9A62E11BDEFF`.

This is not a signed Streaming Store package and is not approved for production. The hardware matrix is still empty because the two discovered Roku OS 15.2.4 devices do not have developer mode enabled and no reachable Flux database/backend is available. Rebuild and record a new hash after any source change.
