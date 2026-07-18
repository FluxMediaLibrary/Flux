# Roku publishing and release

This repository creates a repeatable sideload zip from the checked-in Roku sources. A Roku Streaming Store submission additionally requires a developer account, physical Roku in developer mode, channel signing key, listing metadata, certification evidence, and Roku-hosted release workflow. Those credentials are intentionally not stored in Git.

## Prepare the server

1. Back up PostgreSQL and apply the Roku Prisma migrations.
2. Configure the public values in `.env.example`. `PUBLIC_API_BASE_URL` and the verification URL must be reachable from the Roku network; never use localhost for a device run.
3. Use production HTTPS and verify its certificate chain on Roku hardware.
4. Confirm FFmpeg/FFprobe, media-root permissions, transcode storage, cleanup, PostgreSQL, and Redis.
5. Probe `/health`, `/api/client/bootstrap`, `/api/clients/roku/version`, and `/api/clients/roku/config` from the same network as the test device.
6. Keep the server minimum/latest Roku versions aligned with the manifest release.

## Build a candidate

Increment the semantic manifest fields and update `apps/roku/CHANGELOG.md`. `build_version` must increase for each submitted candidate even when major/minor do not change.

```powershell
npm ci
npm run build
npm run lint
npm test --workspace @flux/backend
npm run roku:test
npm run roku:check
npm run roku:package
git diff --check
```

Record the zip path, byte size, SHA-256, commit, manifest version, backend version, and test date. The source package is written to `apps/roku/dist/flux-roku-<version>.zip`.

For developer-mode validation:

```powershell
./apps/roku/deploy-dev.ps1 -RokuIp 192.168.1.50 -Password '<developer-password>'
```

Run the complete hardware matrix in `docs/roku-testing.md`. A compile, off-device unit test, or successful sideload is not playback certification.

## Sign and submit

Use Roku's developer web interface and device packaging page to create the signed package with the developer key associated with the channel. Keep the signing password and `.pkg` outside the repository. Complete listing artwork, screenshots, description, support contact, privacy-policy URL, content/caption declarations, regions, and certification questions before submission.

Follow Roku's current official [developer setup](https://developer.roku.com/dev/docs/developer-setup), [manifest](https://developer.roku.com/dev/docs/channel-manifest), [packaging](https://developer.roku.com/dev/docs/packaging-channels), and [publishing](https://developer.roku.com/dev/docs/channel-publishing-guide) documentation; Store requirements may change independently of this repository.

## Rollout and rollback

Deploy compatible backend changes before distributing a client that requires them. Use the minimum-version response only for a genuine compatibility or security requirement; normal upgrades remain non-blocking. Announcements and release notes come from server configuration.

If a client release fails, stop rollout in the Roku dashboard and restore the prior compatible channel version. If the server contract fails, roll back backend and database together. Revoke affected device or playback sessions as needed. Never point a released client at an emergency alternate origin; server selection remains user-controlled.

Retain the release record, package hash, signed artifact location, hardware evidence, known limitations, and rollback decision for each production version.
