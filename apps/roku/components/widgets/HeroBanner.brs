sub init()
    m.actions = m.top.findNode("actions")
    m.actionIds = []
    m.actions.observeField("buttonSelected", "onActionSelected")
end sub

sub renderHero()
    data = m.top.heroData
    if data = invalid then return
    backdropUrl = data.backdropUrl
    if backdropUrl = invalid or backdropUrl = "" then backdropUrl = "pkg:/images/placeholder-backdrop.png"
    m.top.findNode("backdrop").uri = backdropUrl
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
    m.top.findNode("accent").color = m.top.accentColor
    m.top.findNode("progressFill").color = m.top.accentColor

    hasProgress = data.progress <> invalid and data.progress.percent <> invalid and data.progress.percent > 0 and not data.progress.completed
    m.top.findNode("progressTrack").visible = hasProgress
    m.top.findNode("progressFill").visible = hasProgress
    if hasProgress
        percent = data.progress.percent
        if percent > 1 then percent = 1
        m.top.findNode("progressFill").width = Int(620 * percent)
    end if

    buttons = []
    m.actionIds = []
    if data.available
        if hasProgress then buttons.Push("Resume") else buttons.Push("Play")
        m.actionIds.Push("play")
    end if
    if data.mediaType <> "retry"
        buttons.Push("Details")
        m.actionIds.Push("details")
    end if
    m.actions.buttons = buttons
end sub

function appendHeroMetadata(current as String, value as String) as String
    if value = "" then return current
    if current = "" then return value
    return current + "  |  " + value
end function

sub onActionSelected()
    index = m.actions.buttonSelected
    if index < 0 or index >= m.actionIds.Count() then return
    m.top.actionSelected = { action: m.actionIds[index], item: m.top.heroData }
end sub
