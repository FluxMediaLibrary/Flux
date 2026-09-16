sub init()
    m.theme = FluxTheme()
    m.items = m.top.findNode("items")
    m.filters = m.top.findNode("filters")
    m.topbar = m.top.findNode("topbar")
    m.titleLabel = m.top.findNode("titleLabel")
    m.pageLabel = m.top.findNode("pageLabel")
    m.emptyState = m.top.findNode("emptyState")
    m.emptyActions = m.top.findNode("emptyActions")
    m.items.observeField("itemSelected", "onSelected")
    m.filters.observeField("itemSelected", "onFilterSelected")
    m.emptyActions.observeField("itemSelected", "onEmptyAction")
    m.titleLabel.font = FluxFont(52, true)
    m.pageLabel.font = FluxFont(24, false)
    m.top.findNode("emptyTitle").font = FluxFont(36, true)
    m.top.findNode("emptyBody").font = FluxFont(26, false)
    m.topbar.contextLabel = "* sort   ·   Replay watched   ·   Play genre"
    renderFilters()
end sub

sub renderTitle()
    m.titleLabel.text = m.top.title
end sub

sub renderFilters()
    content = CreateObject("roSGNode", "ContentNode")
    entries = [
        { id: "sort", title: "Sort: " + m.top.sortLabel },
        { id: "watched", title: "Show: " + m.top.watchedLabel },
        { id: "genre", title: "Genre: " + m.top.genreLabel }
    ]
    data = m.top.pageData
    if data <> invalid and data.hasPrevious = true then entries.Push({ id: "prev", title: "Previous page" })
    if data <> invalid and data.hasNext = true then entries.Push({ id: "next", title: "Next page" })
    for each entry in entries
        item = content.CreateChild("ContentNode")
        item.id = entry.id
        item.title = entry.title
        item.addFields({ icon: "", primary: false })
    end for
    m.filters.content = content
    m.filters.numColumns = content.GetChildCount()
end sub

sub renderItems()
    data = m.top.pageData
    if data = invalid then return
    root = CreateObject("roSGNode", "ContentNode")
    for each media in data.items
        root.AppendChild(FluxContentFromCard(media))
    end for
    m.items.content = root
    empty = root.GetChildCount() = 0
    m.items.visible = not empty
    m.emptyState.visible = empty
    total = data.total
    if total = invalid or total < 0 then total = 0
    pageCount = data.totalPages
    if pageCount = invalid or pageCount < 1 then pageCount = 1
    page = data.page
    if page = invalid or page < 1 then page = 1
    label = total.ToStr() + " title"
    if total <> 1 then label = label + "s"
    if pageCount > 1 then label = label + "   ·   Page " + page.ToStr() + " of " + pageCount.ToStr()
    m.pageLabel.text = label
    renderFilters()
    if empty
        actions = CreateObject("roSGNode", "ContentNode")
        action = actions.CreateChild("ContentNode")
        action.title = "Back to Home"
        action.addFields({ id: "back", icon: "", primary: true })
        m.emptyActions.content = actions
        m.emptyActions.SetFocus(true)
    else
        m.items.SetFocus(true)
    end if
end sub

sub onEmptyAction()
    m.top.backRequested = true
end sub

sub onFilterSelected()
    if m.filters.content = invalid then return
    item = m.filters.content.GetChild(m.filters.itemSelected)
    if item = invalid then return
    if item.id = "sort"
        m.top.sortRequested = true
    else if item.id = "watched"
        m.top.watchedRequested = true
    else if item.id = "genre"
        m.top.genreRequested = true
    else if item.id = "prev"
        m.top.pageChangeRequested = -1
    else if item.id = "next"
        m.top.pageChangeRequested = 1
    end if
end sub

sub onSelected()
    if m.items.content = invalid then return
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
    tabs = m.topbar.findNode("tabs")
    if key = "options"
        m.top.sortRequested = true
        return true
    else if key = "replay"
        m.top.watchedRequested = true
        return true
    else if key = "play"
        m.top.genreRequested = true
        return true
    else if key = "up"
        if m.items.HasFocus() and focused < m.items.numColumns
            m.filters.SetFocus(true)
            return true
        else if m.filters.HasFocus()
            m.topbar.focusRequested = true
            return true
        else if m.emptyActions.HasFocus()
            m.filters.SetFocus(true)
            return true
        end if
    else if key = "down"
        if tabs.HasFocus()
            m.filters.SetFocus(true)
            return true
        else if m.filters.HasFocus()
            if m.items.visible then m.items.SetFocus(true) else m.emptyActions.SetFocus(true)
            return true
        end if
    else if key = "right" and m.items.HasFocus() and m.top.pageData <> invalid and m.top.pageData.hasNext = true and focused >= itemCount - 1
        m.top.pageChangeRequested = 1
        return true
    else if key = "left" and m.items.HasFocus() and m.top.pageData <> invalid and m.top.pageData.page > 1 and focused <= 0
        m.top.pageChangeRequested = -1
        return true
    end if
    return false
end function
