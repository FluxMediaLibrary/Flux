sub init()
    m.theme = FluxTheme()
    m.backdrop = m.top.findNode("backdrop")
    m.backdropFallback = "pkg:/images/placeholder-backdrop.png"
    m.backdrop.observeField("loadStatus", "onBackdropLoadStatus")
    m.actions = m.top.findNode("actions")
    m.actions.observeField("itemSelected", "onActionSelected")
end sub

sub renderHero()
    data = m.top.heroData
    if data = invalid then return
    backdropUrl = data.backdropUrl
    if backdropUrl = invalid or backdropUrl = "" then backdropUrl = "pkg:/images/placeholder-backdrop.png"
    m.backdrop.uri = backdropUrl
    m.top.findNode("title").text = data.title
    m.top.findNode("overview").text = data.overview
    eyebrow = "FEATURED"
    if data.mediaType = "episode" then eyebrow = "CONTINUE WATCHING"
    m.top.findNode("eyebrow").text = eyebrow
    metadata = ""
    if data.year <> invalid then metadata = appendHeroMetadata(metadata, data.year.ToStr())
    if data.contentRating <> invalid and data.contentRating <> "" then metadata = appendHeroMetadata(metadata, data.contentRating)
    if data.runtimeMinutes <> invalid then metadata = appendHeroMetadata(metadata, data.runtimeMinutes.ToStr() + " min")
    if data.rating <> invalid then metadata = appendHeroMetadata(metadata, FormatJson(data.rating) + "/10")
    if data.genres <> invalid and data.genres.Count() > 0 then metadata = appendHeroMetadata(metadata, data.genres.Join(", "))
    if metadata = "" and data.subtitle <> invalid then metadata = data.subtitle
    if data.mediaType <> invalid then metadata = appendHeroMetadata(metadata, UCase(data.mediaType))
    m.top.findNode("metadata").text = metadata
    accent = m.top.accentColor
    if accent = invalid then accent = m.theme.accent
    m.top.findNode("accent").color = accent
    m.top.findNode("progressFill").color = accent

    hasProgress = data.progress <> invalid and data.progress.percent <> invalid and data.progress.percent > 0 and not data.progress.completed
    m.top.findNode("progressTrack").visible = hasProgress
    m.top.findNode("progressFill").visible = hasProgress
    if hasProgress
        percent = data.progress.percent
        if percent > 1 then percent = 1
        m.top.findNode("progressFill").width = Int(650 * percent)
    end if

    actions = CreateObject("roSGNode", "ContentNode")
    if data.available
        play = actions.CreateChild("ContentNode")
        if hasProgress then play.title = "Resume" else play.title = "Play"
        play.addFields({ id: "play" })
    end if
    if data.mediaType <> "retry"
        details = actions.CreateChild("ContentNode")
        details.title = "Details"
        details.addFields({ id: "details" })
    end if
    m.actions.content = actions
    m.top.hasActions = actions.GetChildCount() > 0
end sub

function appendHeroMetadata(current as String, value as String) as String
    if value = "" then return current
    if current = "" then return value
    return current + "  |  " + value
end function

sub onActionSelected()
    if m.actions.content = invalid then return
    index = m.actions.itemSelected
    item = m.actions.content.GetChild(index)
    if item = invalid then return
    m.top.actionSelected = { action: item.id, item: m.top.heroData }
end sub

sub onBackdropLoadStatus()
    if m.backdrop.loadStatus = "failed" and m.backdrop.uri <> m.backdropFallback then m.backdrop.uri = m.backdropFallback
end sub
