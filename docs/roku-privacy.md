# Flux for Roku privacy notes

Flux for Roku connects only to the Flux server address entered by the viewer and to artwork URLs returned by that server. Flux stores the device identifier, model/name, application version, account/device-session relationship, selected profile, playback sessions, and watch progress on the configured Flux server. TMDb artwork may be loaded from `image.tmdb.org` when provided by Flux.

On the Roku, Flux stores the configured server identity, opaque device refresh/access credentials, selected profile, playback preferences, recent search terms, and up to 50 sanitized diagnostic events. Informational events are retained only when Local diagnostics is enabled; warnings and errors remain available for local troubleshooting. It does not collect or store the account password. Log sanitization removes keys containing token, password, code, authorization, or URL. Signing out revokes the device session and clears authentication data; changing server also clears the prior server identity.

Self-hosters are responsible for their own public privacy policy, retention schedule, account deletion process, transport security, and any jurisdiction-specific disclosure. This engineering note is not a substitute for the policy shown to end users or submitted to Roku.
