sub init()
    m.video = m.top.findNode("video")
    m.heartbeat = m.top.findNode("heartbeat")
    m.audioTracks = m.top.findNode("audioTracks")
    m.exitTimer = m.top.findNode("exitTimer")
    m.video.observeField("state", "onVideoState")
    m.video.observeField("position", "updatePlaybackOverlays")
    m.audioTracks.observeField("itemSelected", "onAudioSelected")
    m.heartbeat.observeField("fire", "sendProgress")
    m.exitTimer.observeField("fire", "clearExitControls")
    m.exitArmed = false
end sub

sub clearExitControls()
    m.exitArmed = false
    m.top.findNode("exitControls").visible = false
end sub

sub startPlayback()
    playback = m.top.playbackData
    if playback = invalid or playback.url = invalid then return
    content = CreateObject("roSGNode", "ContentNode")
    content.url = playback.url
    content.title = playback.title
    content.description = playback.subtitle
    content.hdPosterUrl = playback.artworkUrl
    if playback.contentType = "application/x-mpegURL"
        content.streamFormat = "hls"
    else
        content.streamFormat = "mp4"
    end if
    if playback.subtitleTracks <> invalid and playback.subtitleTracks.Count() > 0
        subtitleTracks = []
        selectedSubtitleUrl = ""
        for each track in playback.subtitleTracks
            if track.url <> invalid and track.url <> ""
                language = track.language
                if language = invalid or language = "" then language = "und"
                description = track.title
                if description = invalid or description = "" then description = language
                subtitleTracks.Push({ Language: language, Description: description, TrackName: track.url })
                if track.selected then selectedSubtitleUrl = track.url
            end if
        end for
        if subtitleTracks.Count() > 0 then content.SubtitleTracks = subtitleTracks
        if selectedSubtitleUrl <> "" then content.SubtitleConfig = { TrackName: selectedSubtitleUrl }
    end if
    m.video.content = content
    if playback.method = "direct" then m.positionOffset = 0 else m.positionOffset = playback.positionSeconds
    m.video.control = "play"
    if playback.method = "direct" and playback.positionSeconds > 0 then m.video.seek = playback.positionSeconds
    m.video.SetFocus(true)
    clearExitControls()
    m.introSkipped = false
    if playback.next <> invalid
        m.top.findNode("nextTitle").text = playback.next.title
        m.top.findNode("nextSubtitle").text = playback.next.subtitle
    end if
    audioContent = CreateObject("roSGNode", "ContentNode")
    if playback.audioTracks <> invalid
        for each track in playback.audioTracks
            item = audioContent.CreateChild("ContentNode")
            label = track.title
            if label = invalid or label = "" then label = track.language
            if label = invalid or label = "" then label = "Track " + track.index.ToStr()
            if track.channels <> invalid then label = label + " · " + track.channels.ToStr() + " ch"
            item.title = label
            item.id = track.index.ToStr()
            item.addFields({ language: track.language })
        end for
    end if
    m.audioTracks.content = audioContent
end sub

sub onAudioSelected()
    item = m.audioTracks.content.GetChild(m.audioTracks.itemSelected)
    if item = invalid then return
    m.top.findNode("audioOverlay").visible = false
    m.video.SetFocus(true)
    m.top.audioTrackSelected = { index: Val(item.id), positionSeconds: safePosition(), language: item.language }
end sub

sub updatePlaybackOverlays()
    playback = m.top.playbackData
    if playback = invalid then return
    position = safePosition()
    intro = invalid
    credits = invalid
    if playback.markers <> invalid
        for each marker in playback.markers
            if marker.type = "intro" then intro = marker
            if marker.type = "credits" then credits = marker
        end for
    end if
    showIntro = intro <> invalid and not m.introSkipped and position >= intro.startSeconds and position < intro.endSeconds
    m.top.findNode("skipIntro").visible = showIntro
    showNext = false
    if playback.next <> invalid
        if credits <> invalid and position >= credits.startSeconds then showNext = true
        if not showNext and playback.durationSeconds <> invalid and playback.durationSeconds - position <= 60 then showNext = true
    end if
    m.top.findNode("upNext").visible = showNext
end sub

sub onVideoState()
    state = m.video.state
    if state = "playing"
        m.heartbeat.control = "start"
    else if state = "paused" or state = "buffering"
        sendProgress()
    else if state = "finished"
        m.heartbeat.control = "stop"
        m.top.stopped = stopPayload("ended")
    else if state = "error"
        m.heartbeat.control = "stop"
        m.top.stopped = stopPayload("error")
    end if
end sub

sub sendProgress()
    if m.top.playbackData = invalid then return
    m.top.progressEvent = {
        sessionId: m.top.playbackData.sessionId
        positionSeconds: safePosition()
        durationSeconds: safeDuration()
        state: LCase(m.video.state)
    }
end sub

function stopPayload(reason as String) as Object
    return {
        sessionId: m.top.playbackData.sessionId
        positionSeconds: safePosition()
        durationSeconds: safeDuration()
        reason: reason
    }
end function

function safePosition() as Float
    if m.video.position = invalid or m.video.position < 0 then return 0
    return m.video.position + m.positionOffset
end function

function safeDuration() as Dynamic
    if m.top.playbackData <> invalid and m.top.playbackData.durationSeconds <> invalid and m.top.playbackData.durationSeconds > 0 then return m.top.playbackData.durationSeconds
    if m.video.duration = invalid or m.video.duration <= 0 then return invalid
    return m.video.duration + m.positionOffset
end function

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "back"
        if m.top.findNode("audioOverlay").visible
            m.top.findNode("audioOverlay").visible = false
            m.video.SetFocus(true)
            return true
        end if
        if not m.exitArmed
            m.exitArmed = true
            m.top.findNode("exitControls").visible = true
            m.exitTimer.control = "start"
            return true
        end if
        m.video.control = "stop"
        m.heartbeat.control = "stop"
        m.top.stopped = stopPayload("back")
        return true
    else if key = "OK" and m.top.findNode("skipIntro").visible
        intro = invalid
        for each marker in m.top.playbackData.markers
            if marker.type = "intro" then intro = marker
        end for
        if intro <> invalid
            target = intro.endSeconds - m.positionOffset
            if target < 0 then target = 0
            m.video.seek = target
            m.introSkipped = true
            m.top.findNode("skipIntro").visible = false
        end if
        return true
    else if key = "OK" and m.top.findNode("upNext").visible
        nextItem = m.top.playbackData.next
        m.top.nextRequested = { mediaItemId: nextItem.mediaItemId, episodeId: nextItem.episodeId, title: nextItem.title, subtitle: nextItem.subtitle, artworkUrl: nextItem.artworkUrl, positionSeconds: safePosition() }
        return true
    else if key = "down" and m.audioTracks.content <> invalid and m.audioTracks.content.GetChildCount() > 1
        m.top.findNode("audioOverlay").visible = true
        m.audioTracks.SetFocus(true)
        return true
    end if
    return false
end function
