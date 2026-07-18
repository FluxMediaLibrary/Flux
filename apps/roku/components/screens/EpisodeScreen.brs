sub init()
    m.actions = m.top.findNode("actions")
    m.actions.observeField("itemSelected", "onAction")
end sub

sub renderEpisode()
    episode = m.top.episode
    if episode = invalid then return
    backdropUrl = episode.artwork.backdrop
    if backdropUrl = invalid or backdropUrl = "" then backdropUrl = "pkg:/images/placeholder-backdrop.png"
    thumbnailUrl = episode.artwork.thumbnail
    if thumbnailUrl = invalid or thumbnailUrl = "" then thumbnailUrl = "pkg:/images/placeholder-backdrop.png"
    m.top.findNode("backdrop").uri = backdropUrl
    m.top.findNode("thumbnail").uri = thumbnailUrl
    m.top.findNode("showTitle").text = episode.showTitle
    m.top.findNode("title").text = episode.title
    metadata = "S" + episode.season.ToStr() + " E" + episode.episode.ToStr()
    if episode.runtimeMinutes <> invalid then metadata = metadata + "  |  " + episode.runtimeMinutes.ToStr() + " min"
    if episode.airDate <> invalid and episode.airDate <> "" then metadata = metadata + "  |  " + episode.airDate
    m.top.findNode("metadata").text = metadata
    overview = episode.overview
    if overview = invalid or overview = "" then overview = "No episode description is available."
    m.top.findNode("overview").text = overview
    progressText = "Not watched"
    if episode.watched
        progressText = "Watched"
    else if episode.progress <> invalid and episode.progress.positionSeconds > 0
        progressText = "Resume at " + FormatTime(episode.progress.positionSeconds)
    end if
    m.top.findNode("progress").text = progressText

    actions = CreateObject("roSGNode", "ContentNode")
    if episode.available
        play = actions.CreateChild("ContentNode")
        if episode.progress <> invalid and episode.progress.positionSeconds > 0 and not episode.watched then play.title = "Resume episode" else play.title = "Play episode"
        play.id = "play"
        restart = actions.CreateChild("ContentNode")
        restart.title = "Restart from beginning"
        restart.id = "restart"
    else
        back = actions.CreateChild("ContentNode")
        back.title = "Back to season"
        back.id = "back"
    end if
    m.actions.content = actions
    m.top.findNode("availability").visible = not episode.available
    if episode.available then m.actions.translation = [780, 610] else m.actions.translation = [780, 690]
    m.actions.SetFocus(true)
end sub

function FormatTime(seconds as Float) as String
    total = Int(seconds)
    minutes = Int(total / 60)
    remaining = total mod 60
    suffix = remaining.ToStr()
    if remaining < 10 then suffix = "0" + suffix
    return minutes.ToStr() + ":" + suffix
end function

sub onAction()
    action = m.actions.content.GetChild(m.actions.itemSelected)
    if action = invalid then return
    if action.id = "back"
        m.top.backRequested = true
    else
        m.top.playSelected = { id: m.top.episode.id, mediaType: "episode", parentMediaId: m.top.episode.parentMediaId, restart: action.id = "restart" }
    end if
end sub
