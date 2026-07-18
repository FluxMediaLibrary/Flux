sub init()
    m.items = m.top.findNode("items")
    m.titleLabel = m.top.findNode("titleLabel")
    m.pageLabel = m.top.findNode("pageLabel")
    m.items.observeField("itemSelected", "onSelected")
    m.top.findNode("emptyActions").observeField("itemSelected", "onEmptyAction")
end sub

sub renderTitle()
    m.titleLabel.text = m.top.title
end sub

sub renderSort()
    m.top.findNode("sortDisplay").text = "Sort: " + m.top.sortLabel + "  |  " + m.top.watchedLabel + "  |  " + m.top.genreLabel + "  (* sort, Replay watched, Play/Pause genre)"
end sub

sub renderItems()
    data = m.top.pageData
    if data = invalid then return
    root = CreateObject("roSGNode", "ContentNode")
    for each media in data.items
        item = root.CreateChild("ContentNode")
        item.id = media.id
        item.title = media.title
        item.description = media.overview
        item.hdPosterUrl = media.artwork.poster
        item.addFields({ mediaType: media.mediaType, parentMediaId: media.parentMediaId, progress: media.progress, watched: media.watched, unplayedCount: media.unplayedCount })
    end for
    m.items.content = root
    empty = root.GetChildCount() = 0
    m.items.visible = not empty
    m.top.findNode("empty").visible = empty
    emptyActions = m.top.findNode("emptyActions")
    emptyActions.visible = empty
    if empty
        actions = CreateObject("roSGNode", "ContentNode")
        action = actions.CreateChild("ContentNode")
        action.title = "Back to Home"
        emptyActions.content = actions
        emptyActions.SetFocus(true)
    end if
    pageCount = Int((data.total + data.limit - 1) / data.limit)
    m.pageLabel.text = "Page " + data.page.ToStr() + " of " + pageCount.ToStr()
    if not empty then m.items.SetFocus(true)
end sub

sub onEmptyAction()
    m.top.backRequested = true
end sub

sub onSelected()
    item = m.items.content.GetChild(m.items.itemSelected)
    if item = invalid then return
    m.top.mediaSelected = { id: item.id, mediaType: item.mediaType, parentMediaId: item.parentMediaId, focusIndex: m.items.itemSelected }
end sub

sub restoreFocus()
    if m.top.focusIndex >= 0
        m.items.jumpToItem = m.top.focusIndex
        m.items.SetFocus(true)
    end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    focused = m.items.itemFocused
    itemCount = 0
    if m.items.content <> invalid then itemCount = m.items.content.GetChildCount()
    if key = "options"
        m.top.sortRequested = true
        return true
    else if key = "replay"
        m.top.watchedRequested = true
        return true
    else if key = "play"
        m.top.genreRequested = true
        return true
    else if key = "right" and m.top.pageData <> invalid and m.top.pageData.hasMore and focused >= itemCount - 1
        m.top.pageChangeRequested = 1
        return true
    else if key = "left" and m.top.pageData <> invalid and m.top.pageData.page > 1 and focused <= 0
        m.top.pageChangeRequested = -1
        return true
    end if
    return false
end function
