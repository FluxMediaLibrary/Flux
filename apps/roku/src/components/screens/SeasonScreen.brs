sub init()
    m.theme = FluxTheme()
    m.episodes = m.top.findNode("episodes")
    m.emptyState = m.top.findNode("emptyState")
    m.emptyActions = m.top.findNode("emptyActions")
    m.episodes.observeField("itemSelected", "onSelected")
    m.emptyActions.observeField("itemSelected", "onEmptyAction")
    m.top.findNode("eyebrow").font = FluxFont(22, true)
    m.top.findNode("header").font = FluxFont(52, true)
    m.top.findNode("summary").font = FluxFont(24, false)
    m.top.findNode("emptyTitle").font = FluxFont(36, true)
    m.top.findNode("emptyBody").font = FluxFont(26, false)
    m.top.findNode("topbar").contextLabel = "Back returns to the show"
end sub

sub renderHeader()
    m.top.findNode("eyebrow").text = UCase(m.top.showTitle)
    if m.top.season = 0 then label = "Specials" else label = "Season " + m.top.season.ToStr()
    m.top.findNode("header").text = label
end sub

sub renderEpisodes()
    root = CreateObject("roSGNode", "ContentNode")
    data = m.top.episodesData
    if data = invalid then data = []
    available = 0
    for each episode in data
        item = FluxContentFromCard(episode, "thumbnail")
        number = invalid
        if episode.episodeNumber <> invalid then number = episode.episodeNumber
        item.addFields({ episodeNumber: number })
        if episode.available <> false then available = available + 1
        root.AppendChild(item)
    end for
    m.episodes.content = root
    empty = root.GetChildCount() = 0
    m.emptyState.visible = empty
    m.episodes.visible = not empty
    summary = data.Count().ToStr() + " episode"
    if data.Count() <> 1 then summary = summary + "s"
    if available < data.Count() then summary = summary + "   ·   " + available.ToStr() + " available"
    m.top.findNode("summary").text = summary
    if empty
        actions = CreateObject("roSGNode", "ContentNode")
        action = actions.CreateChild("ContentNode")
        action.title = "Back to show"
        action.addFields({ id: "back", icon: "", primary: true })
        m.emptyActions.content = actions
        m.emptyActions.SetFocus(true)
    else
        m.episodes.SetFocus(true)
    end if
end sub

sub onEmptyAction()
    m.top.backRequested = true
end sub

sub onSelected()
    if m.episodes.content = invalid then return
    index = m.episodes.itemSelected
    item = m.episodes.content.GetChild(index)
    if item = invalid then return
    m.top.episodeSelected = { id: item.id, parentMediaId: m.top.mediaId, focusIndex: [index, 0] }
end sub

sub restoreFocus()
    if m.top.focusIndex <> invalid and m.top.focusIndex.Count() >= 1
        m.episodes.jumpToItem = m.top.focusIndex[0]
        m.episodes.SetFocus(true)
    end if
end sub
