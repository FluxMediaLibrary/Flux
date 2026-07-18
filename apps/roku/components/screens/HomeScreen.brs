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
    destinations = ["Home", "Movies", "Shows"]
    if m.top.requestsEnabled then destinations.Push("Requests")
    destinations.Append(["Search", "Profiles", "Settings"])
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
    for each rowData in m.top.homeData.rows
        if rowData.items.Count() = 0 and rowData.error = invalid then continue for
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
            for each media in rowData.items
                item = row.CreateChild("ContentNode")
                item.id = media.id
                item.title = media.title
                item.description = media.overview
                item.hdPosterUrl = media.artwork.poster
                item.addFields({ retryRowId: "", mediaType: media.mediaType, progress: media.progress, watched: media.watched, unplayedCount: media.unplayedCount, parentMediaId: media.parentMediaId, backdropUrl: media.artwork.backdrop, subtitle: media.subtitle, year: media.year, runtimeMinutes: media.runtimeMinutes, contentRating: media.contentRating, rating: media.rating, genres: media.genres, available: media.available })
            end for
        end if
    end for
    m.rows.content = root
    hasContent = root.GetChildCount() > 0 and root.GetChild(0).GetChildCount() > 0
    m.top.findNode("empty").visible = not hasContent
    m.rows.visible = hasContent
    m.hero.visible = hasContent
    if hasContent
        if m.top.homeData.hero <> invalid and m.top.homeData.hero.Count() > 0
            showHeroData(m.top.homeData.hero[0])
        else
            showHero(root.GetChild(0).GetChild(0))
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
    item = m.rows.content.GetChild(indices[0]).GetChild(indices[1])
    if item <> invalid then showHero(item)
end sub

sub showHero(item as Object)
    m.hero.heroData = { id: item.id, title: item.title, overview: item.description, mediaType: item.mediaType, backdropUrl: item.backdropUrl, subtitle: item.subtitle, year: item.year, runtimeMinutes: item.runtimeMinutes, contentRating: item.contentRating, rating: item.rating, genres: item.genres, progress: item.progress, available: item.available, parentMediaId: item.parentMediaId }
end sub

sub showHeroData(item as Object)
    m.hero.heroData = { id: item.id, title: item.title, overview: item.overview, mediaType: item.mediaType, backdropUrl: item.artwork.backdrop, subtitle: item.subtitle, year: item.year, runtimeMinutes: item.runtimeMinutes, contentRating: item.contentRating, rating: item.rating, genres: item.genres, progress: item.progress, available: item.available, parentMediaId: item.parentMediaId }
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
    item = m.rows.content.GetChild(indices[0]).GetChild(indices[1])
    if item.retryRowId <> invalid and item.retryRowId <> ""
        m.top.rowRetryRequested = item.retryRowId
        return
    end if
    m.top.mediaSelected = { id: item.id, mediaType: item.mediaType, parentMediaId: item.parentMediaId, focusIndex: indices }
end sub

sub onDestinationSelected()
    selected = m.navigation.content.GetChild(m.navigation.itemSelected)
    if selected <> invalid then m.top.destinationSelected = selected.id
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    pauseHeroRotation()
    if key = "up" and m.rows.HasFocus()
        m.hero.SetFocus(true)
        return true
    else if key = "down" and m.hero.IsInFocusChain()
        m.rows.SetFocus(true)
        return true
    else if key = "left" and m.rows.HasFocus()
        m.navigation.SetFocus(true)
        return true
    else if key = "right" and m.navigation.HasFocus()
        m.rows.SetFocus(true)
        return true
    end if
    return false
end function
