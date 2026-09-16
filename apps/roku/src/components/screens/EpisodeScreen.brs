sub init()
    m.theme = FluxTheme()
    m.actions = m.top.findNode("actions")
    m.backdrop = m.top.findNode("backdrop")
    m.thumbnail = m.top.findNode("thumbnail")
    m.fallback = "pkg:/images/placeholder-backdrop.png"
    m.backdrop.observeField("loadStatus", "onBackdropLoadStatus")
    m.thumbnail.observeField("loadStatus", "onThumbnailLoadStatus")
    m.actions.observeField("itemSelected", "onAction")
    m.top.findNode("showTitle").font = FluxFont(22, true)
    m.top.findNode("title").font = FluxFont(54, true)
    m.top.findNode("metadata").font = FluxFont(24, false)
    m.top.findNode("overview").font = FluxFont(26, false)
    m.top.findNode("progress").font = FluxFont(22, false)
    m.top.findNode("availability").font = FluxFont(26, true)
    m.top.findNode("topbar").contextLabel = "Back returns to the season"
end sub

sub renderEpisode()
    episode = m.top.episode
    if episode = invalid then return
    m.backdrop.uri = FluxArtworkUrl(episode, "backdrop", m.fallback)
    m.thumbnail.uri = FluxArtworkUrl(episode, "thumbnail", FluxArtworkUrl(episode, "backdrop", m.fallback))
    showTitle = episode.showTitle
    if showTitle = invalid or showTitle = "" then showTitle = "Flux"
    episodeTitle = episode.title
    if episodeTitle = invalid or episodeTitle = "" then episodeTitle = "Untitled episode"
    m.top.findNode("showTitle").text = UCase(showTitle)
    m.top.findNode("title").text = episodeTitle
    parts = []
    if episode.season <> invalid and episode.episode <> invalid then parts.Push("Season " + episode.season.ToStr() + ", Episode " + episode.episode.ToStr())
    parts.Push(FluxRuntime(episode.runtimeMinutes))
    if episode.airDate <> invalid and episode.airDate <> "" then parts.Push(episode.airDate)
    m.top.findNode("metadata").text = FluxJoinMeta(parts)
    overview = episode.overview
    if overview = invalid or overview = "" then overview = "No description is available for this episode."
    m.top.findNode("overview").text = overview

    percent = FluxProgressPercent(episode.progress)
    resumable = percent > 0.01 and percent < 0.98 and not (episode.watched = true)
    m.top.findNode("progressTrack").visible = resumable
    m.top.findNode("progressFill").visible = resumable
    if resumable then m.top.findNode("progressFill").width = Int(568 * percent)
    progressText = ""
    if episode.watched = true
        progressText = "Watched"
    else if resumable
        progressText = "Resume at " + FormatClock(episode.progress.positionSeconds)
    end if
    m.top.findNode("progress").text = progressText

    actions = CreateObject("roSGNode", "ContentNode")
    if episode.available <> false
        play = actions.CreateChild("ContentNode")
        if resumable then play.title = "Resume" else play.title = "Play"
        play.addFields({ id: "play", icon: "pkg:/images/icon-play.png", primary: true })
        if resumable or episode.watched = true
            restart = actions.CreateChild("ContentNode")
            restart.title = "Start over"
            restart.addFields({ id: "restart", icon: "", primary: false })
        end if
    else
        back = actions.CreateChild("ContentNode")
        back.title = "Back"
        back.addFields({ id: "back", icon: "", primary: false })
    end if
    m.actions.content = actions
    m.actions.numColumns = actions.GetChildCount()
    availability = m.top.findNode("availability")
    availability.visible = episode.available = false
    if availability.visible then availability.translation = [744 + 276, 596]
    m.actions.SetFocus(true)
end sub

function FormatClock(seconds as Dynamic) as String
    if seconds = invalid or seconds < 0 then return "0:00"
    total = Int(seconds)
    hours = Int(total / 3600)
    minutes = Int((total mod 3600) / 60)
    remaining = total mod 60
    secondText = remaining.ToStr()
    if remaining < 10 then secondText = "0" + secondText
    if hours > 0
        minuteText = minutes.ToStr()
        if minutes < 10 then minuteText = "0" + minuteText
        return hours.ToStr() + ":" + minuteText + ":" + secondText
    end if
    return minutes.ToStr() + ":" + secondText
end function

sub onBackdropLoadStatus()
    if m.backdrop.loadStatus = "failed" and m.backdrop.uri <> m.fallback then m.backdrop.uri = m.fallback
end sub

sub onThumbnailLoadStatus()
    if m.thumbnail.loadStatus = "failed" and m.thumbnail.uri <> m.fallback then m.thumbnail.uri = m.fallback
end sub

sub onAction()
    if m.actions.content = invalid then return
    action = m.actions.content.GetChild(m.actions.itemSelected)
    if action = invalid then return
    if action.id = "back"
        m.top.backRequested = true
    else
        m.top.playSelected = { id: m.top.episode.id, mediaType: "episode", parentMediaId: m.top.episode.parentMediaId, restart: action.id = "restart" }
    end if
end sub
