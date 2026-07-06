' PlayerScreen.brs
' Video playback using Roku's built-in Video node with HLS streaming.

sub init()
    m.video = m.top.FindNode("videoPlayer")
    m.spinner = m.top.FindNode("spinner")
    m.statusLabel = m.top.FindNode("statusLabel")
    m.errorLabel = m.top.FindNode("errorLabel")
    
    m.video.ObserveField("state", "onVideoState")
    m.video.ObserveField("position", "onPositionChanged")
    
    m.mediaItemId = m.top.mediaItemId
    m.episodeId = m.top.episodeId
    
    m.lastSavedPosition = 0
    m.duration = 0
    m.saveTimer = CreateObject("roTimespan")
    
    m.startPlayback()
end sub

sub startPlayback()
    m.spinner.visible = true
    m.statusLabel.text = "Loading..."
    m.statusLabel.visible = true
    
    api = m.top.api
    
    ' Always use HLS on Roku for reliable codec support
    url = api.getHlsUrl(m.mediaItemId, m.episodeId)
    
    content = CreateObject("roSGNode", "ContentNode")
    content.url = url
    content.title = m.top.contentTitle
    content.streamFormat = "hls"
    
    ' Set up video player
    m.video.content = content
    m.video.control = "play"
end sub

sub onVideoState(event as object)
    state = event.GetData()
    
    if state = "playing"
        m.spinner.visible = false
        m.statusLabel.visible = false
    else if state = "buffering"
        m.spinner.visible = true
        m.statusLabel.text = "Buffering..."
        m.statusLabel.visible = true
    else if state = "paused"
        m.spinner.visible = false
        m.statusLabel.text = "Paused"
        m.statusLabel.visible = true
    else if state = "finished"
        m.spinner.visible = false
        ' Save progress as completed
        m.saveProgress(true)
    else if state = "error"
        m.spinner.visible = false
        m.errorLabel.text = "Playback error. The file may not be ready yet."
        m.errorLabel.visible = true
    else if state = "stopped"
        m.saveProgress(false)
        m.top.close = true
    end if
end sub

sub onPositionChanged(event as object)
    position = event.GetData()
    if m.duration = 0 then m.duration = m.video.duration
    
    ' Save progress periodically (every 10 seconds)
    if m.saveTimer.TotalMilliseconds() > 10000
        m.saveTimer.Mark()
        if Abs(position - m.lastSavedPosition) > 5
            m.saveProgressToApi(position, false)
            m.lastSavedPosition = position
        end if
    end if
end sub

sub saveProgress(completed as boolean)
    position = m.video.position
    if m.duration = 0 then m.duration = m.video.duration
    m.saveProgressToApi(position, completed)
end sub

sub saveProgressToApi(position as integer, completed as boolean)
    api = m.top.api
    
    body = {
        positionSeconds: position
    }
    
    if m.mediaItemId <> ""
        body.mediaItemId = m.mediaItemId
    end if
    if m.episodeId <> ""
        body.episodeId = m.episodeId
    end if
    if m.duration > 0
        body.durationSeconds = m.duration
    end if
    
    ' Fire-and-forget — don't block playback
    api.saveProgress(body)
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if NOT press then return false
    
    if key = "back"
        m.video.control = "stop"
        return true
    else if key = "play"
        if m.video.state = "paused"
            m.video.control = "resume"
        else
            m.video.control = "play"
        end if
        return true
    end if
    
    return false
end function
