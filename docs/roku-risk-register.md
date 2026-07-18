# Flux Roku risk register

| ID | Severity | Risk | Current evidence | Mitigation and release gate |
| --- | --- | --- | --- | --- |
| R1 | Critical | Playback is claimed without hardware/media validation. | No Roku device or running Flux media stack was available in Phase 0. | Keep a device/media evidence matrix; do not mark direct, remux, transcode, tracks, or 4K complete without observed playback. |
| R2 | Critical | A general JWT in query strings leaks through logs/history/manifests. | Current browser HLS rewrites the profile JWT into every URI. | Issue short-lived playback-session stream tokens, redact URLs, use no-store, and validate session scope for every asset. |
| R3 | Critical | Receiver/device tokens can be reused as normal account tokens. | JWT verification accepts claims without globally enforcing token purpose. | Add explicit token purposes and reject stream/playback/device tokens outside their guards; cover with negative tests. |
| R4 | High | Device authorization can be brute-forced or polled without bound. | No device-link implementation exists. | Hash private codes, rate-limit public/user-code attempts, expire quickly, enforce poll intervals/attempt limits, and audit approvals. |
| R5 | High | Refresh token theft provides durable access. | No refresh/session model exists. | Store only hashes, rotate once, detect reuse, bind to device session, expire/revoke, and never log token material. |
| R6 | High | HLS processes and directories accumulate. | In-memory sessions lack inactivity cleanup and normal stop handling. | Add stop/TTL cleanup, last-seen updates, process termination, directory containment, and stale sweep tests. |
| R7 | High | Roku duplicates browser codec rules and diverges. | Current resolver is browser-specific and Cast adds another narrower decision. | Centralize analysis and client capability decisions in backend playback service; Roku receives a resolved mode and reason. |
| R8 | High | Subtitle or audio selection silently plays the wrong track. | Audio restart exists; subtitle delivery does not. | Use stable track ids, validate requested streams, convert/extract to WebVTT or burn in, and test multilingual/missing-track failures. |
| R9 | High | Full library responses exhaust low-memory devices. | Current library endpoint returns all matching titles. | Add bounded pagination, compact DTOs, lazy rows, image sizing, and large-library tests. |
| R10 | High | A backend restart invalidates in-memory playback state unpredictably. | Cast and HLS session maps are process-local. | Persist authorization/playback ownership, return explicit refresh/retry errors, and test restart recovery. |
| R11 | Medium | Remote branding produces unreadable or unsafe UI. | No remote branding validation exists. | Validate URL schemes/colors/lengths, enforce contrast fallbacks, cache safely, and never accept code/layout payloads. |
| R12 | Medium | Roku Store update behavior is confused with Android self-update. | Android downloads and launches APK installation. | Roku endpoints expose version compatibility only; documentation states Roku manages binaries. |
| R13 | Medium | Existing web/Android clients regress during centralization. | Streaming services are shared and recently stabilized. | Make additive routes, retain legacy DTOs, rebuild `@flux/shared`, run workspace build/typecheck, and add route regression tests. |
| R14 | Medium | External TMDb originals waste memory/bandwidth. | Clients construct public TMDb URLs directly. | Backend supplies constrained artwork variants; Roku uses only requested sizes and bounded caches. |
| R15 | Medium | D-pad focus becomes lost or trapped. | No SceneGraph client exists. | Central navigation stack, explicit focus restoration, remote-only navigation tests, modal focus containment, and per-screen neighbor review. |
| R16 | Medium | Server URL setup accepts an arbitrary HTTP 200 service. | Bootstrap endpoint does not exist. | Validate product, server id, API range, Roku support, auth method, required fields, and URL normalization. |
| R17 | Medium | Local HTTP support weakens public deployments. | Roku must support LAN HTTP; production should prefer HTTPS. | Permit explicit HTTP input, surface security diagnostics, never downgrade HTTPS automatically, and document LAN-only use. |
| R18 | Medium | Test confidence is overstated. | Repository has no automated test suite. | Add deterministic backend contract tests and Roku static/unit validation, and keep physical-device/store certification separate. |

## Current release status (2026-07-17)

- R2 through R10 and R12 through R13 now have implementation mitigations in the typed backend/Roku contract, persistent device and playback sessions, scoped tokens, cleanup, subtitle/audio handling, pagination, and additive routes. Automated checks pass, but database integration and hardware media evidence are still release gates.
- R1 remains open. An onn. Roku TV and Roku Express 4K+ were discovered on Roku OS 15.2.4, but neither exposes the developer installer, so the channel cannot yet be sideloaded.
- R11 is constrained to server-produced name, HTTPS logo URL, and color values; layout/code cannot be delivered remotely. Hardware contrast review remains open.
- R14 is partially mitigated with `w300`, `w342`, and `w1280` artwork variants plus packaged fallbacks. Long-session image-memory behavior still needs the low-memory soak test.
- R15 is covered by explicit navigation/focus state, focus-safe empty actions, static compilation, and navigation helper tests. Remote-only traversal on both discovered devices remains open.
- R18 now has 14 backend tests, 42 off-device BrightScript assertions, static focus/event contracts for 13 interactive screens, full workspace build/type checks, package validation, and a documented hardware matrix. It stays open until the physical matrix is recorded.
- The Home hero now has explicit Play/Resume and Details event contracts, progress and metadata rendering, and bounded server-controlled rotation. Physical focus and timing behavior remain part of R18 hardware validation.
- The test-only `@rokucommunity/brs` interpreter currently brings npm advisories through transitive development dependencies. It is excluded from production dependencies and from the Roku zip, but should be upgraded or replaced when an upstream-safe release is available. `npm audit --omit=dev` separately reports the existing Next/PostCSS moderate advisories.
