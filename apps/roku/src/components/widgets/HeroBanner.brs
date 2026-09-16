sub init()
    m.theme = FluxTheme()
    m.backdrop = m.top.findNode("backdrop")
    m.backdropFallback = "pkg:/images/placeholder-backdrop.png"
    m.backdrop.observeField("loadStatus", "onBackdropLoadStatus")
    m.actions = m.top.findNode("actions")
    m.actions.observeField("itemSelected", "onActionSelected")
    m.top.findNode("eyebrow").font = FluxFont(22, true)
    m.top.findNode("title").font = FluxFont(64, true)
    m.top.findNode("metadata").font = FluxFont(24, false)
    m.top.findNode("overview").font = FluxFont(26, false)
end sub

sub renderHero()
    data = m.top.heroData
    if data = invalid then return
    backdropUrl = data.backdropUrl
    if backdropUrl = invalid or backdropUrl = "" then backdropUrl = m.backdropFallback
    if m.backdrop.uri <> backdropUrl then m.backdrop.uri = backdropUrl
    m.top.findNode("title").text = data.title
    overview = data.overview
    if overview = invalid then overview = ""
    m.top.findNode("overview").text = overview
    eyebrow = "FEATURED"
    if data.mediaType = "episode" then eyebrow = "CONTINUE WATCHING"
    if data.mediaType = "retry" then eyebrow = "ROW UNAVAILABLE"
    m.top.findNode("eyebrow").text = eyebrow

    parts = []
    if data.year <> invalid then parts.Push(data.year.ToStr())
    if data.contentRating <> invalid and data.contentRating <> "" then parts.Push(data.contentRating)
    parts.Push(FluxRuntime(data.runtimeMinutes))
    if data.rating <> invalid and data.rating > 0 then parts.Push(Left(FormatJson(data.rating), 3) + " / 10")
    if data.genres <> invalid and data.genres.Count() > 0
        genres = []
        for each genre in data.genres
            if genres.Count() >= 3 then exit for
            genres.Push(genre)
        end for
        parts.Push(genres.Join(", "))
    end if
    if data.mediaType = "episode" and data.subtitle <> invalid then parts.Unshift(data.subtitle)
    m.top.findNode("metadata").text = FluxJoinMeta(parts)
    m.top.findNode("progressFill").color = m.top.accentColor

    percent = FluxProgressPercent(data.progress)
    hasProgress = percent > 0.01 and percent < 0.98
    m.top.findNode("progressTrack").visible = hasProgress
    m.top.findNode("progressFill").visible = hasProgress
    if hasProgress then m.top.findNode("progressFill").width = Int(420 * percent)

    actions = CreateObject("roSGNode", "ContentNode")
    if data.available
        play = actions.CreateChild("ContentNode")
        if hasProgress then play.title = "Resume" else play.title = "Play"
        play.addFields({ id: "play", icon: "pkg:/images/icon-play.png", primary: true })
    end if
    if data.mediaType <> "retry"
        details = actions.CreateChild("ContentNode")
        details.title = "Details"
        details.addFields({ id: "details", icon: "", primary: false })
    end if
    m.actions.content = actions
    if actions.GetChildCount() > 0 then m.actions.numColumns = actions.GetChildCount()
    m.top.hasActions = actions.GetChildCount() > 0
    m.actions.visible = m.top.hasActions
end sub

sub onActionSelected()
    if m.actions.content = invalid then return
    item = m.actions.content.GetChild(m.actions.itemSelected)
    if item = invalid then return
    m.top.actionSelected = { action: item.id, item: m.top.heroData }
end sub

sub onBackdropLoadStatus()
    if m.backdrop.loadStatus = "failed" and m.backdrop.uri <> m.backdropFallback then m.backdrop.uri = m.backdropFallback
end sub
