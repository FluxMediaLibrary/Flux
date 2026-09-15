sub init()
    m.rows = m.top.findNode("rows")
    m.navigation = m.top.findNode("navigation")
    m.header = m.top.findNode("header")
    m.hero = m.top.findNode("hero")
    m.heroTimer = m.top.findNode("heroTimer")
    m.heroIndex = 0
    m.heroInteracted = false
    m.rows.observeField("rowItemSelected", "onSelected")
    m.rows.observeField("rowItemFocused", "onFocused")
    m.navigation.observeField("itemSelected", "onDestinationSelected")
    m.hero.observeField("actionSelected", "onHeroActionSelected")
    m.heroTimer.observeField("fire", "onHeroTimer")
    renderNavigation()
end sub

sub renderNavigation()
    navigation = CreateObject("roSGNode", "ContentNode")
    destinations = ["Home", "Movies", "Shows", "Continue Watching"]
    if m.top.requestsEnabled then destinations.Push("Requests")
    destinations.Append(["Search", "Profiles", "Server", "Settings"])
    for each destination in destinations
        item = navigation.CreateChild("ContentNode")
        item.title = destination
        item.id = LCase(destination)
    end for
    m.navigation.content = navigation
end sub

sub renderHeader()
    m.header.text = m.top.serverName
end sub

sub renderStatus()
    m.top.findNode("status").text = m.top.homeStatus
end sub

sub renderBranding()
    m.hero.accentColor = m.top.accentColor
    if m.top.logoUrl <> invalid and m.top.logoUrl <> "" then m.top.findNode("logo").uri = m.top.logoUrl
end sub

sub renderHome()
    root = CreateObject("roSGNode", "ContentNode")
    if m.top.homeData = invalid then return
    homeRows = m.top.homeData.rows
    if homeRows = invalid then homeRows = []
    for each rowData in homeRows
        rowItems = rowData.items
        if rowItems = invalid then rowItems = []
        if rowItems.Count() = 0 and rowData.error = invalid then continue for
        row = root.CreateChild("ContentNode")
        row.title = rowData.title
        row.id = rowData.id
        if rowData.error <> invalid
            item = row.CreateChild("ContentNode")
            item.id = "retry:" + rowData.id
            item.title = "Retry"
            item.description = rowData.error.message
            item.hdPosterUrl = "pkg:/images/placeholder-poster.png"
            item.addFields({ retryRowId: rowData.id, mediaType: "retry", progress: invalid, watched: false, unplayedCount: invalid, parentMediaId: invalid, backdropUrl: "pkg:/images/placeholder-backdrop.png", subtitle: "Row unavailable", year: invalid, runtimeMinutes: invalid, contentRating: invalid, rating: invalid, genres: [], available: false })
        else
            for each media in rowItems
                item = row.CreateChild("ContentNode")
                item.id = media.id
                item.title = media.title
                item.description = media.overview
                item.hdPosterUrl = FluxArtworkUrl(media, "poster", "pkg:/images/placeholder-poster.png")
                item.addFields({ retryRowId: "", mediaType: media.mediaType, progress: media.progress, watched: media.watched, unplayedCount: media.unplayedCount, parentMediaId: media.parentMediaId, backdropUrl: FluxArtworkUrl(media, "backdrop", "pkg:/images/placeholder-backdrop.png"), subtitle: media.subtitle, year: media.year, runtimeMinutes: media.runtimeMinutes, contentRating: media.contentRating, rating: media.rating, genres: media.genres, available: media.available })
            end for
        end if
    end for
    m.rows.content = root
    hasContent = false
    firstRow = invalid
    if root.GetChildCount() > 0
        firstRow = root.GetChild(0)
        if firstRow <> invalid and firstRow.GetChildCount() > 0 then hasContent = true
    end if
    m.top.findNode("empty").visible = not hasContent
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
        m.navigation.SetFocus(true)
    end if
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

sub onDestinationSelected()
    if m.navigation.content = invalid then return
    selected = m.navigation.content.GetChild(m.navigation.itemSelected)
    if selected <> invalid then m.top.destinationSelected = selected.id
end sub

sub focusContinueWatching()
    if not m.top.focusContinueWatching or m.rows.content = invalid then return
    for rowIndex = 0 to m.rows.content.GetChildCount() - 1
        row = m.rows.content.GetChild(rowIndex)
        if row <> invalid and LCase(row.title) = "continue watching" and row.GetChildCount() > 0
            m.rows.jumpToRowItem = [rowIndex, 0]
            m.rows.SetFocus(true)
            return
        end if
    end for
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    pauseHeroRotation()
    if key = "up" and m.rows.HasFocus() and m.hero.hasActions
        m.hero.SetFocus(true)
        return true
    else if key = "up" and m.hero.IsInFocusChain()
        m.navigation.SetFocus(true)
        return true
    else if key = "down" and m.navigation.IsInFocusChain() and m.hero.hasActions
        m.hero.SetFocus(true)
        return true
    else if key = "down" and m.hero.IsInFocusChain()
        m.rows.SetFocus(true)
        return true
    end if
    return false
end function
