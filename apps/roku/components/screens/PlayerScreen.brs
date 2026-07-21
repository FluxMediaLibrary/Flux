sub init()
    m.video = m.top.findNode("video")
    m.inputCapture = m.top.findNode("inputCapture")
    m.heartbeat = m.top.findNode("heartbeat")
    m.audioTracks = m.top.findNode("audioTracks")
    m.subtitleTracks = m.top.findNode("subtitleTracks")
    m.playbackOptions = m.top.findNode("playbackOptions")
    m.qualityOptions = m.top.findNode("qualityOptions")
    m.exitTimer = m.top.findNode("exitTimer")
    m.transportOverlay = m.top.findNode("transportOverlay")
    m.transportTimer = m.top.findNode("transportTimer")
    m.seekFill = m.top.findNode("seekFill")
    m.currentTime = m.top.findNode("currentTime")
    m.durationTime = m.top.findNode("durationTime")
    m.bufferingOverlay = m.top.findNode("bufferingOverlay")
    m.bufferingSpinner = m.top.findNode("bufferingSpinner")
    m.video.observeField("state", "onVideoState")
    m.video.observeField("position", "updatePlaybackOverlays")
    m.audioTracks.observeField("itemSelected", "onAudioSelected")
    m.subtitleTracks.observeField("itemSelected", "onSubtitleSelected")
    m.playbackOptions.observeField("itemSelected", "onPlaybackOptionSelected")
    m.qualityOptions.observeField("itemSelected", "onQualitySelected")
    m.heartbeat.observeField("fire", "sendProgress")
    m.exitTimer.observeField("fire", "clearExitControls")
    m.transportTimer.observeField("fire", "hideTransport")
    m.exitArmed = false
    renderPlaybackOptions()
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
    m.inputCapture.SetFocus(true)
    clearExitControls()
    setBufferingVisible(false)
    showTransport()
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
    renderSubtitleTracks(playback)
    renderQualityOptions()
end sub

sub hideTransport()
    if m.video.state <> "paused" then m.transportOverlay.visible = false
end sub

sub setBufferingVisible(visible as Boolean)
    m.bufferingOverlay.visible = visible
    m.bufferingSpinner.visible = visible
end sub

sub showTransport()
    renderTransport()
    m.transportOverlay.visible = true
    m.transportTimer.control = "stop"
    m.transportTimer.control = "start"
end sub

sub renderTransport()
    position = safePosition()
    duration = safeDuration()
    percent = 0
    if duration <> invalid and duration > 0
        percent = position / duration
        if percent < 0 then percent = 0
        if percent > 1 then percent = 1
    end if
    m.seekFill.width = Int(1536 * percent)
    m.currentTime.text = FormatTransportTime(position)
    if duration = invalid then m.durationTime.text = "--:--" else m.durationTime.text = FormatTransportTime(duration)
end sub

function FormatTransportTime(seconds as Dynamic) as String
    if seconds = invalid or seconds < 0 then return "--:--"
    total = Int(seconds)
    hours = Int(total / 3600)
    minutes = Int((total mod 3600) / 60)
    remaining = total mod 60
    minuteText = minutes.ToStr()
    secondText = remaining.ToStr()
    if minutes < 10 then minuteText = "0" + minuteText
    if remaining < 10 then secondText = "0" + secondText
    if hours > 0
        hourText = hours.ToStr()
        if hours < 10 then hourText = "0" + hourText
        return hourText + ":" + minuteText + ":" + secondText
    end if
    return minuteText + ":" + secondText
end function

sub renderPlaybackOptions()
    content = CreateObject("roSGNode", "ContentNode")
    for each option in [{ id: "audio", title: "Audio track" }, { id: "subtitles", title: "Captions" }, { id: "quality", title: "Stream quality" }]
        item = content.CreateChild("ContentNode")
        item.id = option.id
        item.title = option.title
    end for
    m.playbackOptions.content = content
end sub

sub renderSubtitleTracks(playback as Object)
    content = CreateObject("roSGNode", "ContentNode")
    off = content.CreateChild("ContentNode")
    off.id = "off"
    off.title = "Captions off"
    off.addFields({ enabled: false, language: "" })
    if playback.subtitleTracks <> invalid
        for each track in playback.subtitleTracks
            if track.index = invalid then continue for
            item = content.CreateChild("ContentNode")
            language = track.language
            if language = invalid or language = "" then language = "Undetermined"
            title = track.title
            if title = invalid or title = "" then title = language
            if track.selected then title = title + " (Selected)"
            item.id = track.index.ToStr()
            item.title = title
            item.addFields({ enabled: true, language: language })
        end for
    end if
    m.subtitleTracks.content = content
end sub

sub renderQualityOptions()
    content = CreateObject("roSGNode", "ContentNode")
    for each bitrate in [8000000, 20000000, 40000000]
        item = content.CreateChild("ContentNode")
        label = Int(bitrate / 1000000).ToStr() + " Mbps"
        if bitrate = m.top.qualityPreference then label = label + " (Current)"
        item.id = bitrate.ToStr()
        item.title = label
    end for
    m.qualityOptions.content = content
end sub

sub onAudioSelected()
    if m.audioTracks.content = invalid then return
    item = m.audioTracks.content.GetChild(m.audioTracks.itemSelected)
    if item = invalid then return
    m.top.findNode("audioOverlay").visible = false
    m.inputCapture.SetFocus(true)
    m.top.audioTrackSelected = { index: Val(item.id), positionSeconds: safePosition(), language: item.language }
end sub

sub onSubtitleSelected()
    if m.subtitleTracks.content = invalid then return
    item = m.subtitleTracks.content.GetChild(m.subtitleTracks.itemSelected)
    if item = invalid then return
    m.top.findNode("subtitleOverlay").visible = false
    m.inputCapture.SetFocus(true)
    enabled = item.enabled = true
    index = invalid
    if enabled then index = Val(item.id)
    m.top.subtitleTrackSelected = { index: index, enabled: enabled, positionSeconds: safePosition(), language: item.language }
end sub

sub onQualitySelected()
    if m.qualityOptions.content = invalid then return
    item = m.qualityOptions.content.GetChild(m.qualityOptions.itemSelected)
    if item = invalid then return
    m.top.findNode("qualityOverlay").visible = false
    m.inputCapture.SetFocus(true)
    m.top.qualitySelected = { bitrate: Val(item.id), positionSeconds: safePosition() }
end sub

sub onPlaybackOptionSelected()
    if m.playbackOptions.content = invalid then return
    item = m.playbackOptions.content.GetChild(m.playbackOptions.itemSelected)
    if item = invalid then return
    m.top.findNode("playbackMenu").visible = false
    if item.id = "audio"
        if m.audioTracks.content <> invalid and m.audioTracks.content.GetChildCount() > 1
            m.top.findNode("audioOverlay").visible = true
            m.audioTracks.SetFocus(true)
        else
            m.inputCapture.SetFocus(true)
        end if
    else if item.id = "subtitles"
        m.top.findNode("subtitleOverlay").visible = true
        m.subtitleTracks.SetFocus(true)
    else if item.id = "quality"
        m.top.findNode("qualityOverlay").visible = true
        m.qualityOptions.SetFocus(true)
    end if
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
    if m.transportOverlay.visible then renderTransport()
end sub

sub onVideoState()
    state = m.video.state
    if state = "playing"
        setBufferingVisible(false)
        m.heartbeat.control = "start"
    else if state = "paused"
        setBufferingVisible(false)
        sendProgress()
        showTransport()
    else if state = "buffering"
        setBufferingVisible(true)
        sendProgress()
    else if state = "finished"
        setBufferingVisible(false)
        m.heartbeat.control = "stop"
        m.top.stopped = stopPayload("ended")
    else if state = "error"
        setBufferingVisible(false)
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
        if closePlaybackOverlay()
            m.inputCapture.SetFocus(true)
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
    else if key = "OK" and m.inputCapture.HasFocus()
        if m.video.state = "playing"
            m.video.control = "pause"
        else if m.video.state = "paused"
            m.video.control = "resume"
        else
            m.video.control = "play"
        end if
        showTransport()
        return true
    else if (key = "left" or key = "right") and m.inputCapture.HasFocus()
        target = safePosition()
        if key = "left" then target = target - 10 else target = target + 10
        duration = safeDuration()
        if duration <> invalid and target > duration then target = duration
        if target < 0 then target = 0
        relativeTarget = target - m.positionOffset
        if relativeTarget < 0 then relativeTarget = 0
        m.video.seek = relativeTarget
        showTransport()
        return true
    else if key = "down" and m.inputCapture.HasFocus()
        m.top.findNode("playbackMenu").visible = true
        m.playbackOptions.SetFocus(true)
        return true
    end if
    return false
end function

function closePlaybackOverlay() as Boolean
    for each overlayId in ["playbackMenu", "audioOverlay", "subtitleOverlay", "qualityOverlay"]
        overlay = m.top.findNode(overlayId)
        if overlay <> invalid and overlay.visible
            overlay.visible = false
            return true
        end if
    end for
    return false
end function
