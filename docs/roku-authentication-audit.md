# Flux Roku authentication audit

## Current system

Flux authenticates accounts with email/password and Argon2id. Login returns a signed JWT with account id and role. Profile activation verifies ownership and returns another JWT containing `activeProfileId`. Media, requests, and progress use that selected profile. Normal authenticated requests re-check that the account exists and is enabled.

Tokens expire according to `JWT_EXPIRES_IN`, currently defaulting to seven days. The backend has no refresh tokens, token rotation, token identifiers, session records, logout invalidation, or device-code records. A disabled account is rejected on subsequent normal API calls. Profiles do not support PINs.

The browser keeps the JWT in local storage. Android is a WebView client and reads that value only to ask the backend for a scoped Cast session. Android does not offer a reusable native login or device-registration flow.

## Roku security requirements

Roku should never collect the account password. It needs a device authorization grant with these properties:

1. A random private device code stored only as a hash server-side and never logged.
2. A short, human-entered user code with collision handling and a strict expiry.
3. A verification URL derived from validated server configuration.
4. Poll throttling, `slow_down` handling, maximum attempts, and terminal denied/expired states.
5. Approval only by an authenticated website account on the same server.
6. A persistent device session bound to account, device id, platform, and refresh credential family.
7. Short-lived access tokens and one-time refresh-token rotation.
8. Revocation on sign-out, server-side session removal, account disable, or suspicious refresh reuse.
9. Profile activation that preserves device-session identity and verifies ownership on every switch.

## Proposed backend records

`DeviceAuthorization` should contain an id, hashed device code, normalized user code, device metadata, status, expiry, poll interval, last-polled time, approved account id, and timestamps. Terminal rows can be pruned safely.

`DeviceSession` should contain an id, account id, stable device id, display name, platform, application version, hashed refresh token, refresh family/version, expiry, revoked time/reason, last-seen time, and timestamps. JWT access tokens should carry a session identifier and purpose so receiver/playback tokens cannot be used as ordinary account tokens.

Raw access and refresh tokens must never be persisted in the database or logs. The Roku registry stores only the server identity, access token, refresh token, selected profile id, stable device id, preferences, and non-sensitive connection metadata. Logout clears tokens and selected profile but preserves the server URL unless the user removes the server.

## Profile behavior

After approval, the Roku receives an account-level access token and loads profiles. Selecting a profile calls the Roku profile-selection route and returns a profile-scoped access token. Watch progress remains isolated by the existing profile relations. Because PINs do not exist in Flux today, the bootstrap feature flag must report profile PIN support as false.

## Revocation and recovery

Every authorized Roku route verifies token purpose, device-session state, account state, and selected-profile ownership as applicable. A rejected refresh clears local auth and returns the Device Link screen with a precise reason. Network failures retain the session and permit retry. Changing servers revokes the old device session when reachable, then clears local secrets.

## Current gaps

- No `POST /api/auth/device` or status/approval flow.
- No website link/approval page.
- No refresh endpoint or rotation logic.
- No device-session persistence or remote session list/revoke UI.
- No logout revocation semantics.
- No profile PIN model.
- Stream query-token guard does not currently re-check account disable state.
- Existing JWT purposes are not rejected by all normal API guards, so purpose enforcement must be tightened before adding device and playback tokens.

