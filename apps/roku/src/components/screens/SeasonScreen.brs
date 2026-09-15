sub init()
    m.episodes = m.top.findNode("episodes")
    m.episodes.observeField("rowItemSelected", "onSelected")
    m.top.findNode("emptyActions").observeField("itemSelected", "onEmptyAction")
end sub

sub renderHeader()
    m.top.findNode("header").text = m.top.showTitle + " · Season " + m.top.season.ToStr()
end sub

sub renderEpisodes()
    root = CreateObject("roSGNode", "ContentNode")
    row = root.CreateChild("ContentNode")
    for each episode in m.top.episodesData
        item = row.CreateChild("ContentNode")
        item.id = episode.id
        item.title = episode.title
        item.description = episode.subtitle
        item.hdPosterUrl = FluxArtworkUrl(episode, "thumbnail", "pkg:/images/placeholder-backdrop.png")
        item.addFields({ available: episode.available, parentMediaId: m.top.mediaId, watched: episode.watched, progress: episode.progress })
    end for
    m.episodes.content = root
    empty = row.GetChildCount() = 0
    m.top.findNode("empty").visible = empty
    m.episodes.visible = not empty
    emptyActions = m.top.findNode("emptyActions")
    emptyActions.visible = empty
    if not empty
        m.episodes.SetFocus(true)
    else
        actions = CreateObject("roSGNode", "ContentNode")
        action = actions.CreateChild("ContentNode")
        action.title = "Back to show"
        emptyActions.content = actions
        emptyActions.SetFocus(true)
    end if
end sub

sub onEmptyAction()
    m.top.backRequested = true
end sub

sub onSelected()
    indices = m.episodes.rowItemSelected
    if indices.Count() <> 2 then return
    if m.episodes.content = invalid then return
    row = m.episodes.content.GetChild(indices[0])
    if row = invalid then return
    item = row.GetChild(indices[1])
    if item = invalid then return
    m.top.episodeSelected = { id: item.id, parentMediaId: item.parentMediaId, focusIndex: indices }
end sub

sub restoreFocus()
    if m.top.focusIndex <> invalid and m.top.focusIndex.Count() = 2
        m.episodes.jumpToRowItem = m.top.focusIndex
        m.episodes.SetFocus(true)
    end if
end sub
