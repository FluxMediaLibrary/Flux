# Roku authentication

Flux uses device authorization because passwords and browser-style cookies do not belong on a TV. The Roku generates no account credentials and never receives the user's password. A signed-in Flux web session approves a short code at `/link`.

## Authorization sequence

1. The Roku validates `GET /api/client/bootstrap` and confirms `product=flux`, `rokuSupported=true`, API compatibility, and `authentication.deviceLink=true`.
2. It sends `POST /api/auth/device` with its model name, stable device ID, platform, and semantic app version.
3. The backend returns an opaque `deviceCode`, human-readable `userCode`, verification URL, expiry, and minimum polling interval. Only hashes of both codes are stored.
4. The Roku displays the user code and polls `POST /api/auth/device/status`. It honors `pollInterval` and increases its delay after `slow_down`.
5. A user signs in to Flux in a normal browser and approves or denies the code on `/link`.
6. Approval returns a 15-minute device access token and a one-time refresh token. If the account has multiple profiles, the Roku asks for one and calls `POST /api/roku/profiles/select`.
7. Profile selection rotates both tokens and adds the authorized profile to the device session. Profile-bound discovery and playback routes reject tokens without that selection.

Pending codes expire and can be denied. Approval is rejected after a code is consumed, denied, or expired. Device creation, polling, approval, and refresh are rate limited.

## Token lifecycle

- Access tokens are signed device-purpose JWTs with account, session, and optional profile scope. They expire after 15 minutes and are sent only in `Authorization: Bearer ...` for JSON APIs.
- Refresh tokens are opaque random secrets. The database stores their hashes, never the clear token.
- Every refresh replaces the stored refresh hash. Reusing a rotated token is treated as compromise and revokes the entire device session.
- Selecting a profile rotates credentials so an old account-only token cannot inherit profile access.
- `POST /api/auth/logout` revokes the server session before the Roku clears local credentials.
- A 401 causes one serialized refresh attempt. Concurrent requests wait for that attempt; they do not independently rotate the same refresh token.
- If refresh fails, the client clears both tokens and returns to device linking without erasing the configured server.

The Roku registry stores the server origin, stable device ID, current profile, preferences, and current device tokens. Account passwords, web cookies, playback signing secrets, and raw diagnostic response bodies are not stored.

## Playback authorization is separate

The native Roku `Video` node cannot reliably attach an account bearer token to every playlist, media segment, and caption request. `POST /api/roku/playback/resolve` therefore creates a persistent, server-side playback session and returns a short-lived media URL containing a playback-purpose token.

That token is limited to one account, profile, device session, playback session, media item, and optional episode. It cannot call account APIs. Stream and caption handlers verify the signature, scope, live playback row, expiry, and revoked/stopped state on every protected request.

## Operational response

To revoke one TV, revoke its device session in the database or invoke the logout flow while it is connected. To respond to suspected refresh-token reuse, leave the session revoked and require a new device code. Rotating `JWT_SECRET` invalidates all current access and playback JWTs and should be treated as a broad sign-out event.

Production Flux origins must use HTTPS with a certificate chain accepted by Roku OS. Do not place developer passwords, account tokens, or a private signing key in the channel package.
