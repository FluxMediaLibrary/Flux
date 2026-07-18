# Roku troubleshooting

Start at the earliest failing boundary. A message on the TV is often downstream of server reachability, database state, media probing, or token scope.

## Server cannot be added

- Enter only an origin such as `https://flux.example.com`, without `/api` or another path.
- From another device on the Roku network, request `<origin>/api/client/bootstrap` and confirm `product` is `flux`, `rokuSupported` is true, API ranges overlap, and device linking is enabled.
- Do not use `localhost`; on the Roku that means the Roku itself.
- Check DNS, VLAN/client-isolation rules, reverse-proxy routing, HTTPS certificate chain, and whether the backend is listening on the advertised interface.
- A minimum-version or unsupported-server message is intentional. Align the manifest/client version, `FLUX_SERVER_VERSION`, Roku bounds, and API version rather than bypassing the gate.

## Device code never approves

- Confirm the browser is signed into the same Flux server shown on the TV.
- Codes are case-insensitive for entry but expire. Generate a new code after expiry or denial.
- Respect the displayed polling interval. A `slow_down` response means the client or a proxy is polling too quickly.
- Verify PostgreSQL has the Roku device-session migration and Redis/rate limiting is healthy.
- If approval succeeds in the browser but the TV returns to linking, inspect refresh/session logs for token reuse or a mismatched stable `deviceId`.

## Home, search, or details are empty

- Verify a profile is selected; discovery routes require profile scope.
- Empty states are valid when the library contains no matching available media.
- Confirm media roots and request/library records in the backend. The Roku does not invent demo titles.
- TMDb failure may remove enrichment or artwork, but local titles and packaged Flux placeholders should still render.
- A disabled Requests item is controlled by `ROKU_FEATURE_REQUESTS`; it is not a client cache bug.

## Playback fails before video starts

1. Inspect the `playback/resolve` response and backend log for the selected method and warning.
2. Verify the media file exists inside the backend environment and FFprobe can read it.
3. Request the returned scoped URL before it expires. For HLS, verify the master/media playlist and at least one segment.
4. Confirm `PUBLIC_API_BASE_URL` is reachable by the Roku and not a Docker-only hostname.
5. Check FFmpeg availability, codec/container output, transcode directory permissions, disk space, and process logs.
6. Compare the actual source codecs/bitrate to the Roku model and OS. Do not force direct play based only on an `.mp4` extension.

HTTP 401 usually means the account access token expired; the client should perform one refresh. HTTP 403 on a media or subtitle URL usually indicates a playback-scope mismatch, revoked/stopped session, or wrong episode. HTTP 404 may mean unavailable media/session or a disabled feature. HTTP 429 means back off according to the route policy. The JSON error envelope is `{ "error", "message", "statusCode" }`.

## Playback starts but is wrong

- Wrong resume point: compare the resolve position with the profile's stored progress; switch Settings between Resume automatically and Restart.
- No audio or wrong language: inspect returned audio tracks, selected flags, Roku native track support, and preferred language.
- Captions absent: confirm the feature flag, returned WebVTT URL, stream index, playback token scope, conversion logs, and Roku caption setting. Test on real hardware.
- Buffering: lower maximum bitrate, confirm segment generation stays ahead, and check Wi-Fi plus backend CPU/disk throughput.
- Progress missing: verify 15-second heartbeat requests and the final stop call, then reload the profile's Home/details data.
- Skip Intro or Up Next absent: verify valid server markers and next-episode availability. The client deliberately does not infer them from elapsed time alone.

## Sideload or package failure

- Enable developer mode and confirm the device IP/password. The username defaults to `rokudev`.
- Ensure the computer can reach `http://<roku-ip>/plugin_install`; guest Wi-Fi isolation commonly blocks it.
- Run `npm run roku:check`, `npm run roku:test`, and `npm run roku:package` separately to identify compile, behavior-test, structure, or zip errors.
- Store-signed `.pkg` creation requires the Roku developer key and physical device workflow; the repository zip is a sideload/source package, not a signed Store artifact.

When escalating, include app version, server version, Roku model/OS, screen/action, UTC timestamp, media ID (not filesystem path), source codecs/container, selected method, HTTP status/error code, and sanitized backend/player logs. Never include access, refresh, playback tokens, developer password, or account password.
