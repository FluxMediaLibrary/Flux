sub Main()
    failures = 0

    failures += ExpectEqual("normalizes trailing slash", NormalizeServerUrl("https://flux.example/"), "https://flux.example")
    failures += ExpectEqual("rejects missing protocol", NormalizeServerUrl("flux.example"), "")
    failures += ExpectEqual("rejects URL paths", NormalizeServerUrl("https://flux.example/api"), "")
    failures += ExpectEqual("joins API route", JoinUrl("https://flux.example/", "api/roku/bootstrap"), "https://flux.example/api/roku/bootstrap")

    failures += ExpectEqual("semantic versions compare lower", CompareSemanticVersions("1.9.0", "1.10.0"), -1)
    failures += ExpectEqual("semantic versions compare equal", CompareSemanticVersions("1.0", "1.0.0"), 0)
    failures += ExpectEqual("semantic versions compare greater", CompareSemanticVersions("2.0.0", "1.99.99"), 1)

    flags = NormalizeFeatureFlags({ profiles: true, requests: false, skipIntro: true })
    failures += ExpectEqual("feature flag profiles", flags.profiles, true)
    failures += ExpectEqual("feature flag default", flags.subtitles, false)
    failures += ExpectEqual("feature flag explicit false", flags.requests, false)

    parsed = SafeJsonParse("{""name"":""Flux"",""apiVersion"":1}")
    failures += ExpectEqual("API JSON parsing", parsed.name, "Flux")
    failures += ExpectEqual("empty JSON is invalid", SafeJsonParse(""), invalid)
    safeLog = SanitizeLogValue({ mediaId: "movie-1", accessToken: "secret", playbackUrl: "signed" })
    failures += ExpectEqual("logger preserves safe IDs", safeLog.mediaId, "movie-1")
    failures += ExpectEqual("logger removes tokens", safeLog.accessToken, invalid)
    failures += ExpectEqual("logger removes signed URLs", safeLog.playbackUrl, invalid)
    defaults = DefaultPreferences()
    failures += ExpectEqual("registry default resume behavior", defaults.resumeBehavior, "auto")
    failures += ExpectEqual("registry default diagnostics", defaults.diagnostics, false)
    roundTrip = DeserializePreferences(SerializePreferences({ maxBitrate: 8000000, autoplayNext: false, extra: "ignored" }))
    failures += ExpectEqual("registry round-trip bitrate", roundTrip.maxBitrate, 8000000)
    failures += ExpectEqual("registry round-trip autoplay", roundTrip.autoplayNext, false)
    failures += ExpectEqual("registry fills missing defaults", roundTrip.subtitleMode, "auto")
    failures += ExpectEqual("registry ignores unknown keys", roundTrip.extra, invalid)

    failures += ExpectEqual("progress calculates percentage", ProgressPercent(46, 100), 0.46)
    failures += ExpectEqual("progress clamps overflow", ProgressPercent(120, 100), 1.0)
    failures += ExpectEqual("progress rejects missing duration", ProgressPercent(50, invalid), 0.0)
    apiFailure = MapApiFailure(503, { error: "TRANSCODER_OFFLINE", message: "Transcoder unavailable" })
    failures += ExpectEqual("API error code mapping", apiFailure.code, "TRANSCODER_OFFLINE")
    failures += ExpectEqual("server errors are retryable", apiFailure.retryable, true)
    clientFailure = MapApiFailure(400, invalid)
    failures += ExpectEqual("plain HTTP error mapping", clientFailure.code, "HTTP_400")
    failures += ExpectEqual("client errors are not retryable", clientFailure.retryable, false)

    navigation = CreateNavigationState()
    failures += ExpectEqual("navigation begins empty", navigation.stack.Count(), 0)
    PushNavigation(navigation, "home", { focus: 4 })
    PushNavigation(navigation, "details", { id: "movie-1" })
    failures += ExpectEqual("navigation current screen", CurrentNavigation(navigation).name, "details")
    previous = PopNavigation(navigation)
    failures += ExpectEqual("navigation pops to home", previous.name, "home")
    failures += ExpectEqual("navigation root does not pop", PopNavigation(navigation), invalid)

    failures += ExpectEqual("4K resolution mapping", ResolutionName("2160p HDR"), "2160p")
    failures += ExpectEqual("full HD resolution mapping", ResolutionName("1080p"), "1080p")
    failures += ExpectEqual("unknown resolution is conservative", ResolutionName("480p"), "720p")

    selection = { id: "episode-2", parentMediaId: "show-1", mediaType: "episode", restart: true }
    preferences = {
        maxBitrate: 8000000
        audioLanguage: "en"
        subtitleLanguage: "es"
        subtitleMode: "on"
        resumeBehavior: "auto"
    }
    capabilities = {
        model: "test"
        firmware: "test"
        supports4k: true
        supportsHevc: true
        supportsHdr10: false
        maxBitrate: 1
    }
    request = BuildPlaybackRequestForCapabilities(selection, preferences, capabilities)
    failures += ExpectEqual("episode parent media id", request.mediaItemId, "show-1")
    failures += ExpectEqual("episode id", request.episodeId, "episode-2")
    failures += ExpectEqual("preferred audio", request.preferredAudioLanguage, "en")
    failures += ExpectEqual("preferred subtitle", request.preferredSubtitleLanguage, "es")
    failures += ExpectEqual("subtitles enabled", request.subtitlesEnabled, true)
    failures += ExpectEqual("explicit restart position", request.positionSeconds, 0)
    failures += ExpectEqual("preference bitrate applied", request.capabilities.maxBitrate, 8000000)

    print "FLUX_TEST_FAILURES="; failures.ToStr()
end sub

function ExpectEqual(name as String, actual as Dynamic, expected as Dynamic) as Integer
    if actual = expected
        print "PASS: "; name
        return 0
    end if
    print "FAIL: "; name; " expected="; expected; " actual="; actual
    return 1
end function
