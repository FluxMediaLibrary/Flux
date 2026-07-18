sub resolvePlaybackSelection(selection as Object)
    m.playbackSelection = selection
    m.playbackReturnDestination = m.currentDestination
    m.state = "RESOLVING_PLAYBACK"
    body = BuildPlaybackRequest(selection, m.registry.preferences)
    runRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.resolvePlayback), method: "POST", token: m.registry.accessToken, body: body }, "onPlaybackResolved", "onPlaybackResolveFailed")
end sub

sub onPlaybackResolved(event as Object)
    m.state = "READY"
    m.currentDestination = "player"
    m.activePlayback = event.GetData().data
    LogEvent("info", "playback", "playback_resolved", { sessionId: m.activePlayback.sessionId, mediaId: m.activePlayback.mediaItemId, method: m.activePlayback.method })
    m.playerStopping = false
    m.playbackRetryAttempted = false
    showPlayer()
end sub

sub showPlayer()
    screen = showScreen("PlayerScreen")
    screen.playbackData = m.activePlayback
    screen.observeField("progressEvent", "onPlaybackProgress")
    screen.observeField("stopped", "onPlaybackStopped")
    screen.observeField("nextRequested", "onNextRequested")
    screen.observeField("audioTrackSelected", "onAudioTrackSelected")
end sub

sub onAudioTrackSelected(event as Object)
    if m.playerStopping then return
    choice = event.GetData()
    if choice.language <> invalid and choice.language <> ""
        m.registry.preferences.audioLanguage = choice.language
        WritePreferences(m.registry.preferences)
    end if
    m.playerStopping = true
    runBackgroundRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.progress), method: "POST", token: m.registry.accessToken, body: { sessionId: m.activePlayback.sessionId, positionSeconds: choice.positionSeconds, durationSeconds: m.activePlayback.durationSeconds, state: "buffering" } })
    selection = { id: m.activePlayback.mediaItemId, mediaType: "movie", parentMediaId: invalid }
    if m.activePlayback.episodeId <> invalid then selection = { id: m.activePlayback.episodeId, mediaType: "episode", parentMediaId: m.activePlayback.mediaItemId }
    m.playbackSelection = selection
    body = BuildPlaybackRequest(selection, m.registry.preferences)
    body.audioStreamIndex = choice.index
    body.positionSeconds = choice.positionSeconds
    runRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.resolvePlayback), method: "POST", token: m.registry.accessToken, body: body }, "onPlaybackResolved", "onPlaybackRecoveryFailed")
end sub

sub onNextRequested(event as Object)
    if m.playerStopping then return
    m.playerStopping = true
    nextItem = event.GetData()
    currentPosition = nextItem.positionSeconds
    if currentPosition = invalid then currentPosition = m.activePlayback.positionSeconds
    runBackgroundRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.stopPlayback), method: "POST", token: m.registry.accessToken, body: { sessionId: m.activePlayback.sessionId, positionSeconds: currentPosition, durationSeconds: m.activePlayback.durationSeconds, reason: "ended" } })
    m.playbackSelection = { id: nextItem.episodeId, mediaType: "episode", parentMediaId: nextItem.mediaItemId }
    body = BuildPlaybackRequest(m.playbackSelection, m.registry.preferences)
    runRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.resolvePlayback), method: "POST", token: m.registry.accessToken, body: body }, "onPlaybackResolved", "returnAfterPlayback")
end sub

sub onPlaybackResolveFailed(event as Object)
    failure = event.GetData()
    LogEvent("error", "playback", "resolve_failed", { status: failure.status, error: failure.code })
    showError("Unable to play", failure.message, failure.retryable, "retryPlayback")
end sub

sub retryPlayback()
    if m.playbackSelection = invalid then returnFromMessage() else resolvePlaybackSelection(m.playbackSelection)
end sub

sub onPlaybackProgress(event as Object)
    payload = event.GetData()
    runBackgroundRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.progress), method: "POST", token: m.registry.accessToken, body: payload })
end sub

sub onPlaybackStopped(event as Object)
    if m.playerStopping then return
    payload = event.GetData()
    LogEvent("info", "progress", "playback_stopped", { sessionId: payload.sessionId, reason: payload.reason, position: payload.positionSeconds })
    if payload.reason = "error" and not m.playbackRetryAttempted
        m.playerStopping = true
        m.playbackRetryAttempted = true
        m.activePlayback.positionSeconds = payload.positionSeconds
        runBackgroundRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.progress), method: "POST", token: m.registry.accessToken, body: { sessionId: payload.sessionId, positionSeconds: payload.positionSeconds, durationSeconds: payload.durationSeconds, state: "buffering" } })
        runRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.refreshPlayback), method: "POST", token: m.registry.accessToken, body: { sessionId: payload.sessionId, positionSeconds: payload.positionSeconds } }, "onPlaybackUrlRefreshed", "onPlaybackRecoveryFailed")
        return
    end if
    m.playerStopping = true
    runBackgroundRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.stopPlayback), method: "POST", token: m.registry.accessToken, body: payload })
    if payload.reason = "ended" and m.registry.preferences.autoplayNext and m.activePlayback.episodeId <> invalid
        url = JoinUrl(m.registry.serverUrl, m.routes.nextPlayback) + "?sessionId=" + UrlEncode(m.activePlayback.sessionId)
        runRequest({ url: url, method: "GET", token: m.registry.accessToken }, "onNextPlaybackLoaded", "returnAfterPlayback")
    else
        returnAfterPlayback()
    end if
end sub

sub onPlaybackUrlRefreshed(event as Object)
    data = event.GetData().data
    m.activePlayback.url = data.url
    m.activePlayback.expiresAt = data.expiresAt
    m.playerStopping = false
    showPlayer()
end sub

sub onPlaybackRecoveryFailed(event as Object)
    if m.activePlayback <> invalid
        runBackgroundRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.stopPlayback), method: "POST", token: m.registry.accessToken, body: { sessionId: m.activePlayback.sessionId, positionSeconds: m.activePlayback.positionSeconds, reason: "error" } })
    end if
    returnAfterPlayback()
end sub

sub onNextPlaybackLoaded(event as Object)
    nextItem = event.GetData().data.next
    if nextItem = invalid
        returnAfterPlayback()
        return
    end if
    m.playbackSelection = { id: nextItem.episodeId, mediaType: "episode", parentMediaId: nextItem.mediaItemId }
    body = BuildPlaybackRequest(m.playbackSelection, m.registry.preferences)
    runRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.resolvePlayback), method: "POST", token: m.registry.accessToken, body: body }, "onPlaybackResolved", "returnAfterPlayback")
end sub

sub returnAfterPlayback(event = invalid as Dynamic)
    m.activePlayback = invalid
    m.playerStopping = false
    if m.playbackReturnDestination = "episode" and m.currentEpisodeData <> invalid
        showEpisodeFromCache()
    else if m.playbackReturnDestination = "season" and m.currentSeasonEpisodes <> invalid
        showSeasonFromCache()
    else if m.playbackReturnDestination = "detail" and m.currentDetailData <> invalid
        showDetailFromCache()
    else if m.playbackReturnDestination = "movies" or m.playbackReturnDestination = "shows"
        loadLibrary(m.playbackReturnDestination, m.libraryPage)
    else
        loadHome()
    end if
end sub

sub returnFromMessage()
    if m.returnDestination = "movies" or m.returnDestination = "shows"
        loadLibrary(m.returnDestination, m.libraryPage)
    else
        loadHome()
    end if
end sub

