sub init()
    m.theme = FluxTheme()
    m.rows = m.top.findNode("rows")
    m.topbar = m.top.findNode("topbar")
    m.hero = m.top.findNode("hero")
    m.heroTimer = m.top.findNode("heroTimer")
    m.empty = m.top.findNode("empty")
    m.emptyActions = m.top.findNode("emptyActions")
    m.heroIndex = 0
    m.heroInteracted = false
    m.rows.observeField("rowItemSelected", "onSelected")
    m.rows.observeField("rowItemFocused", "onFocused")
    m.topbar.observeField("destinationSelected", "onDestinationSelected")
    m.hero.observeField("actionSelected", "onHeroActionSelected")
    m.heroTimer.observeField("fire", "onHeroTimer")
    m.emptyActions.observeField("itemSelected", "onEmptyAction")
    m.top.findNode("emptyTitle").font = FluxFont(44, true)
    m.top.findNode("emptyBody").font = FluxFont(26, false)
    m.rows.rowLabelFont = FluxFont(30, true)
    renderNavigation()
end sub

sub renderNavigation()
    destinations = [
        { id: "home", title: "Home" },
        { id: "movies", title: "Movies" },
        { id: "shows", title: "Shows" },
        { id: "search", title: "Search" }
    ]
    if m.top.requestsEnabled then destinations.Push({ id: "requests", title: "Requests" })
    destinations.Push({ id: "settings", title: "Settings" })
    m.topbar.destinations = destinations
end sub

sub renderHeader()
    m.topbar.serverName = m.top.serverName
end sub

sub renderStatus()
    m.topbar.contextLabel = m.top.homeStatus
    if m.top.homeStatus <> "" then m.topbar.contextTone = "warning" else m.topbar.contextTone = "muted"
end sub

sub renderBranding()
    m.hero.accentColor = m.top.accentColor
end sub

sub renderHome()
    root = CreateObject("roSGNode", "ContentNode")
    if m.top.homeData = invalid then return
    homeRows = m.top.homeData.rows
    if homeRows = invalid then homeRows = []
    sizes = []
    heights = []
    for each rowData in homeRows
        rowItems = rowData.items
        if rowItems = invalid then rowItems = []
        if rowItems.Count() = 0 and rowData.error = invalid then continue for
        row = root.CreateChild("ContentNode")
        row.title = rowData.title
        row.id = rowData.id
        wide = rowData.id = "continue-watching"
        if wide
            sizes.Push([392, 300])
            heights.Push(364)
        else
            sizes.Push([196, 360])
            heights.Push(424)
        end if
        if rowData.error <> invalid
            item = row.CreateChild("ContentNode")
            item.id = "retry:" + rowData.id
            item.title = "Retry"
            item.description = rowData.error.message
            item.hdPosterUrl = "pkg:/images/placeholder-poster.png"
            item.addFields({ retryRowId: rowData.id, mediaType: "retry", progress: invalid, watched: false, unplayedCount: invalid, parentMediaId: invalid, backdropUrl: "pkg:/images/placeholder-backdrop.png", thumbnailUrl: "pkg:/images/placeholder-backdrop.png", subtitle: "Row unavailable", year: invalid, runtimeMinutes: invalid, contentRating: invalid, rating: invalid, genres: [], available: false })
        else
            for each media in rowItems
                row.AppendChild(FluxContentFromCard(media))
            end for
        end if
    end for
    if sizes.Count() > 0
        m.rows.rowItemSize = sizes
        m.rows.rowHeights = heights
    end if
    m.rows.content = root
    hasContent = false
    firstRow = invalid
    if root.GetChildCount() > 0
        firstRow = root.GetChild(0)
        if firstRow <> invalid and firstRow.GetChildCount() > 0 then hasContent = true
    end if
    m.empty.visible = not hasContent
    m.rows.visible = hasContent
    m.hero.visible = hasContent
    if hasContent
        if m.top.homeData.hero <> invalid and m.top.homeData.hero.Count() > 0
            showHeroData(m.top.homeData.hero[0])
        else
            showHero(firstRow.GetChild(0))
        end if
        configureHeroRotation()
        m.rows.SetFocus(true)
    else
        actions = CreateObject("roSGNode", "ContentNode")
        refresh = actions.CreateChild("ContentNode")
        refresh.title = "Refresh"
        refresh.addFields({ id: "home", icon: "", primary: true })
        m.emptyActions.content = actions
        m.emptyActions.SetFocus(true)
    end if
end sub

sub onEmptyAction()
    m.top.destinationSelected = "home"
end sub

sub onFocused()
    indices = m.rows.rowItemFocused
    if indices.Count() <> 2 or m.rows.content = invalid then return
    row = m.rows.content.GetChild(indices[0])
    if row = invalid then return
    item = row.GetChild(indices[1])
    if item <> invalid then showHero(item)
end sub

sub showHero(item as Object)
    m.hero.heroData = { id: item.id, title: item.title, overview: item.description, mediaType: item.mediaType, backdropUrl: item.backdropUrl, subtitle: item.subtitle, year: item.year, runtimeMinutes: item.runtimeMinutes, contentRating: item.contentRating, rating: item.rating, genres: item.genres, progress: item.progress, available: item.available, parentMediaId: item.parentMediaId }
end sub

sub showHeroData(item as Object)
    m.hero.heroData = { id: item.id, title: item.title, overview: item.overview, mediaType: item.mediaType, backdropUrl: FluxArtworkUrl(item, "backdrop", "pkg:/images/placeholder-backdrop.png"), subtitle: item.subtitle, year: item.year, runtimeMinutes: item.runtimeMinutes, contentRating: item.contentRating, rating: item.rating, genres: item.genres, progress: item.progress, available: item.available, parentMediaId: item.parentMediaId }
end sub

sub configureHeroRotation()
    if m.heroTimer = invalid then return
    m.heroTimer.control = "stop"
    if m.heroInteracted then return
    if m.top.heroRotationSeconds <= 0 then return
    if m.top.homeData = invalid or m.top.homeData.hero = invalid or m.top.homeData.hero.Count() < 2 then return
    m.heroTimer.duration = m.top.heroRotationSeconds
    m.heroTimer.control = "start"
end sub

sub onHeroTimer()
    if m.heroInteracted or m.top.homeData = invalid or m.top.homeData.hero = invalid then return
    m.heroIndex++
    if m.heroIndex >= m.top.homeData.hero.Count() then m.heroIndex = 0
    showHeroData(m.top.homeData.hero[m.heroIndex])
end sub

sub pauseHeroRotation()
    m.heroInteracted = true
    if m.heroTimer <> invalid then m.heroTimer.control = "stop"
end sub

sub onHeroActionSelected(event as Object)
    pauseHeroRotation()
    m.top.heroActionSelected = event.GetData()
end sub

sub restoreFocus()
    if m.top.focusIndex <> invalid and m.top.focusIndex.Count() = 2
        m.rows.jumpToRowItem = m.top.focusIndex
        m.rows.SetFocus(true)
    end if
end sub

sub onSelected()
    indices = m.rows.rowItemSelected
    if indices.Count() <> 2 then return
    if m.rows.content = invalid then return
    row = m.rows.content.GetChild(indices[0])
    if row = invalid then return
    item = row.GetChild(indices[1])
    if item = invalid then return
    if item.retryRowId <> invalid and item.retryRowId <> ""
        m.top.rowRetryRequested = item.retryRowId
        return
    end if
    m.top.mediaSelected = { id: item.id, mediaType: item.mediaType, parentMediaId: item.parentMediaId, focusIndex: indices }
end sub

sub onDestinationSelected(event as Object)
    destination = event.GetData()
    if destination = "home"
        ' Already here: drop focus back into the rows.
        if m.rows.visible then m.rows.SetFocus(true)
        return
    end if
    m.top.destinationSelected = destination
end sub

sub focusContinueWatching()
    if not m.top.focusContinueWatching or m.rows.content = invalid then return
    for rowIndex = 0 to m.rows.content.GetChildCount() - 1
        row = m.rows.content.GetChild(rowIndex)
        if row <> invalid and row.id = "continue-watching" and row.GetChildCount() > 0
            m.rows.jumpToRowItem = [rowIndex, 0]
            m.rows.SetFocus(true)
            return
        end if
    end for
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    pauseHeroRotation()
    tabs = m.topbar.findNode("tabs")
    if key = "up"
        if m.rows.HasFocus() and m.rows.rowItemFocused.Count() = 2 and m.rows.rowItemFocused[0] = 0
            if m.hero.hasActions then m.hero.SetFocus(true) else m.topbar.focusRequested = true
            return true
        else if m.hero.IsInFocusChain()
            m.topbar.focusRequested = true
            return true
        else if m.emptyActions.HasFocus()
            m.topbar.focusRequested = true
            return true
        end if
    else if key = "down"
        if tabs.HasFocus()
            if m.hero.visible and m.hero.hasActions
                m.hero.SetFocus(true)
            else if m.rows.visible
                m.rows.SetFocus(true)
            else
                m.emptyActions.SetFocus(true)
            end if
            return true
        else if m.hero.IsInFocusChain()
            m.rows.SetFocus(true)
            return true
        end if
    end if
    return false
end function
