sub loadHome()
    m.state = "LOADING_HOME"
    cached = m.cachedHome
    if cached = invalid then cached = SafeJsonParse(ReadAsciiFile("tmp:/flux-home.json"))
    if cached <> invalid
        showHome(cached, "Refreshing library…")
        m.state = "LOADING_HOME"
    end if
    runRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.home), method: "GET", token: m.registry.accessToken }, "onHomeLoaded", "onHomeFailed")
end sub

sub onHomeLoaded(event as Object)
    data = event.GetData().data
    m.cachedHome = data
    LogEvent("info", "network", "home_loaded", { rowCount: data.rows.Count() })
    WriteAsciiFile("tmp:/flux-home.json", FormatJson(data))
    showHome(data, "")
end sub

sub showHome(data as Object, status as String)
    m.state = "READY"
    m.currentDestination = "home"
    screen = showScreen("HomeScreen")
    screen.homeData = data
    screen.serverName = m.bootstrap.serverName
    displayStatus = status
    if displayStatus = "" and m.clientConfig <> invalid and m.clientConfig.announcement <> invalid then displayStatus = m.clientConfig.announcement
    if displayStatus = "" and m.versionDecision <> invalid and m.versionDecision.available then displayStatus = "Update available · Roku installs automatically"
    screen.homeStatus = displayStatus
    screen.requestsEnabled = m.bootstrap.features.requests
    if m.clientConfig <> invalid and m.clientConfig.ui <> invalid then screen.heroRotationSeconds = m.clientConfig.ui.heroRotationSeconds
    if m.accentColor <> invalid then screen.accentColor = m.accentColor
    if m.bootstrap.branding <> invalid and m.bootstrap.branding.logoUrl <> invalid then screen.logoUrl = m.bootstrap.branding.logoUrl
    if m.homeFocus <> invalid then screen.focusIndex = m.homeFocus
    screen.observeField("mediaSelected", "onMediaSelected")
    screen.observeField("heroActionSelected", "onHomeHeroAction")
    screen.observeField("destinationSelected", "onDestinationSelected")
    screen.observeField("rowRetryRequested", "onHomeRowRetry")
end sub

sub onHomeHeroAction(event as Object)
    choice = event.GetData()
    item = choice.item
    selection = { id: item.id, mediaType: item.mediaType, parentMediaId: item.parentMediaId }
    if choice.action = "play"
        resolvePlaybackSelection(selection)
    else
        id = item.id
        if item.mediaType = "episode" and item.parentMediaId <> invalid and item.parentMediaId <> "" then id = item.parentMediaId
        loadMediaDetail(id)
    end if
end sub

sub onHomeRowRetry(event as Object)
    rowId = event.GetData()
    if m.currentScreen <> invalid then m.homeFocus = m.currentScreen.findNode("rows").rowItemFocused
    url = JoinUrl(m.registry.serverUrl, m.routes.homeRows + "/" + UrlEncode(rowId))
    runRequest({ url: url, method: "GET", token: m.registry.accessToken }, "onHomeRowLoaded", "onHomeRowRetryFailed")
end sub

sub onHomeRowLoaded(event as Object)
    updated = event.GetData().data.row
    if m.cachedHome = invalid
        loadHome()
        return
    end if
    replaced = false
    for index = 0 to m.cachedHome.rows.Count() - 1
        if m.cachedHome.rows[index].id = updated.id
            m.cachedHome.rows[index] = updated
            replaced = true
        end if
    end for
    if not replaced then m.cachedHome.rows.Push(updated)
    WriteAsciiFile("tmp:/flux-home.json", FormatJson(m.cachedHome))
    if updated.error <> invalid then showHome(m.cachedHome, "That row is still unavailable. Select Retry to try again.") else showHome(m.cachedHome, updated.title + " refreshed")
end sub

sub onHomeRowRetryFailed(event as Object)
    failure = event.GetData()
    if failure.status = 401 or failure.status = 403
        onAuthorizedFailure(event)
    else
        showHome(m.cachedHome, "Could not refresh that row: " + failure.message)
    end if
end sub

sub onHomeFailed(event as Object)
    failure = event.GetData()
    if failure.status = 401 or failure.status = 403
        onAuthorizedFailure(event)
        return
    end if
    cached = m.cachedHome
    if cached = invalid then cached = SafeJsonParse(ReadAsciiFile("tmp:/flux-home.json"))
    if cached <> invalid
        showHome(cached, "Offline · showing cached rows")
    else
        showError("Flux could not load", failure.message, failure.retryable, "retryStartup")
    end if
end sub

sub onDestinationSelected(event as Object)
    destination = event.GetData()
    LogEvent("info", "navigation", "destination_selected", { destination: destination })
    if destination = "home"
        loadHome()
    else if destination = "movies" or destination = "shows"
        loadLibrary(destination, 1)
    else if destination = "search"
        showSearch()
    else if destination = "requests"
        loadRequests()
    else if destination = "profiles"
        loadProfiles()
    else if destination = "settings"
        showSettings()
    end if
end sub

sub loadRequests()
    m.state = "LOADING_REQUESTS"
    m.currentDestination = "requests"
    runRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.requests), method: "GET", token: m.registry.accessToken }, "onRequestsLoaded", "onAuthorizedFailure")
end sub

sub onRequestsLoaded(event as Object)
    m.state = "READY"
    screen = showScreen("RequestsScreen")
    screen.requestData = event.GetData().data
    screen.observeField("backRequested", "showCachedHome")
end sub

sub loadLibrary(destination as String, page as Integer)
    m.state = "LOADING_LIBRARY"
    m.currentDestination = destination
    m.libraryPage = page
    route = m.routes.movies
    if destination = "shows" then route = m.routes.shows
    url = JoinUrl(m.registry.serverUrl, route) + "?page=" + page.ToStr() + "&limit=30&sort=" + m.librarySort
    if m.libraryWatched <> "all" then url = url + "&watched=" + m.libraryWatched
    if m.libraryGenre <> "" then url = url + "&genre=" + UrlEncode(m.libraryGenre)
    runRequest({ url: url, method: "GET", token: m.registry.accessToken }, "onLibraryLoaded", "onAuthorizedFailure")
end sub

sub onLibraryLoaded(event as Object)
    m.state = "READY"
    screen = showScreen("LibraryScreen")
    if m.currentDestination = "movies" then screen.title = "Movies" else screen.title = "Shows"
    screen.pageData = event.GetData().data
    m.libraryGenres = screen.pageData.availableGenres
    if m.librarySort = "recent" then screen.sortLabel = "Recently added" else if m.librarySort = "year" then screen.sortLabel = "Newest year" else screen.sortLabel = "Title A-Z"
    if m.libraryWatched = "all" then screen.watchedLabel = "All" else if m.libraryWatched = "true" then screen.watchedLabel = "Watched" else screen.watchedLabel = "Unwatched"
    if m.libraryGenre = "" then screen.genreLabel = "All genres" else screen.genreLabel = m.libraryGenre
    focusKey = m.currentDestination + ":" + m.libraryPage.ToStr()
    if m.libraryFocus[focusKey] <> invalid then screen.focusIndex = m.libraryFocus[focusKey]
    screen.observeField("mediaSelected", "onMediaSelected")
    screen.observeField("pageChangeRequested", "onLibraryPageChange")
    screen.observeField("sortRequested", "onLibrarySortRequested")
    screen.observeField("watchedRequested", "onLibraryWatchedRequested")
    screen.observeField("genreRequested", "onLibraryGenreRequested")
    screen.observeField("backRequested", "showCachedHome")
end sub

sub onLibraryPageChange(event as Object)
    nextPage = m.libraryPage + event.GetData()
    if nextPage < 1 then nextPage = 1
    loadLibrary(m.currentDestination, nextPage)
end sub

sub onLibrarySortRequested()
    if m.librarySort = "title"
        m.librarySort = "recent"
    else if m.librarySort = "recent"
        m.librarySort = "year"
    else
        m.librarySort = "title"
    end if
    m.libraryFocus = {}
    loadLibrary(m.currentDestination, 1)
end sub

sub onLibraryWatchedRequested()
    if m.libraryWatched = "all"
        m.libraryWatched = "false"
    else if m.libraryWatched = "false"
        m.libraryWatched = "true"
    else
        m.libraryWatched = "all"
    end if
    m.libraryFocus = {}
    loadLibrary(m.currentDestination, 1)
end sub

sub onLibraryGenreRequested()
    if m.libraryGenres = invalid or m.libraryGenres.Count() = 0 then return
    if m.libraryGenre = ""
        m.libraryGenre = m.libraryGenres[0]
    else
        nextIndex = 0
        for index = 0 to m.libraryGenres.Count() - 1
            if m.libraryGenres[index] = m.libraryGenre then nextIndex = index + 1
        end for
        if nextIndex >= m.libraryGenres.Count() then m.libraryGenre = "" else m.libraryGenre = m.libraryGenres[nextIndex]
    end if
    m.libraryFocus = {}
    loadLibrary(m.currentDestination, 1)
end sub

sub showSearch()
    m.state = "READY"
    m.currentDestination = "search"
    screen = showScreen("SearchScreen")
    if m.searchQuery <> invalid then screen.initialQuery = m.searchQuery
    screen.recentSearches = m.recentSearches
    if m.searchResults <> invalid then screen.results = m.searchResults
    screen.observeField("queryChanged", "onSearchQuery")
    screen.observeField("recentSelected", "onRecentSearchSelected")
    screen.observeField("mediaSelected", "onMediaSelected")
end sub

sub onSearchQuery(event as Object)
    query = event.GetData()
    m.searchQuery = query
    if Len(query) < 2 then return
    url = JoinUrl(m.registry.serverUrl, m.routes.search) + "?q=" + UrlEncode(query)
    if m.currentScreen <> invalid then m.currentScreen.loading = true
    runRequest({ url: url, method: "GET", token: m.registry.accessToken }, "onSearchLoaded", "onSearchFailed")
end sub

sub onRecentSearchSelected(event as Object)
    m.searchQuery = event.GetData()
    if m.currentScreen <> invalid then m.currentScreen.initialQuery = m.searchQuery
end sub

sub onSearchLoaded(event as Object)
    if m.currentDestination = "search" and m.currentScreen <> invalid
        m.searchResults = event.GetData().data
        m.recentSearches = AddRecentSearch(m.searchResults.query)
        m.currentScreen.recentSearches = m.recentSearches
        m.currentScreen.loading = false
        m.currentScreen.results = m.searchResults
    end if
end sub

sub onSearchFailed(event as Object)
    failure = event.GetData()
    if failure.status = 401 or failure.status = 403
        onAuthorizedFailure(event)
        return
    end if
    if m.currentDestination = "search" and m.currentScreen <> invalid
        m.currentScreen.loading = false
        m.currentScreen.errorMessage = failure.message
    end if
end sub

sub onMediaSelected(event as Object)
    selection = event.GetData()
    if m.currentDestination = "home" and selection.focusIndex <> invalid then m.homeFocus = selection.focusIndex
    if (m.currentDestination = "movies" or m.currentDestination = "shows") and selection.focusIndex <> invalid
        m.libraryFocus[m.currentDestination + ":" + m.libraryPage.ToStr()] = selection.focusIndex
    end if
    if m.currentDestination = "detail" and m.currentDetailData <> invalid then m.detailStack.Push(m.currentDetailData)
    id = selection.id
    if selection.mediaType = "episode" and selection.parentMediaId <> invalid and selection.parentMediaId <> "" then id = selection.parentMediaId
    loadMediaDetail(id)
end sub

sub loadMediaDetail(id as String)
    m.state = "LOADING_DETAIL"
    if m.currentDestination <> "detail" and m.currentDestination <> "season" then m.returnDestination = m.currentDestination
    url = JoinUrl(m.registry.serverUrl, m.routes.media + "/" + UrlEncode(id))
    runRequest({ url: url, method: "GET", token: m.registry.accessToken }, "onMediaDetailLoaded", "onAuthorizedFailure")
end sub

sub onMediaDetailLoaded(event as Object)
    m.currentDetailData = event.GetData().data
    showDetailFromCache()
end sub

sub showDetailFromCache()
    m.state = "READY"
    m.currentDestination = "detail"
    screen = showScreen("DetailsScreen")
    screen.detail = m.currentDetailData
    screen.observeField("playSelected", "onPlaySelected")
    screen.observeField("mediaSelected", "onMediaSelected")
    screen.observeField("seasonSelected", "onSeasonSelected")
end sub

sub onSeasonSelected(event as Object)
    selection = event.GetData()
    m.selectedSeason = selection
    m.seasonFocus = invalid
    m.state = "LOADING_SEASON"
    url = JoinUrl(m.registry.serverUrl, m.routes.shows + "/" + UrlEncode(selection.mediaId) + "/seasons/" + selection.season.ToStr() + "/episodes")
    runRequest({ url: url, method: "GET", token: m.registry.accessToken }, "onSeasonLoaded", "onAuthorizedFailure")
end sub

sub onSeasonLoaded(event as Object)
    m.currentSeasonEpisodes = event.GetData().data
    showSeasonFromCache()
end sub

sub showSeasonFromCache()
    m.state = "READY"
    m.currentDestination = "season"
    screen = showScreen("SeasonScreen")
    screen.mediaId = m.selectedSeason.mediaId
    screen.showTitle = m.selectedSeason.title
    screen.season = m.selectedSeason.season
    screen.episodesData = m.currentSeasonEpisodes
    if m.seasonFocus <> invalid then screen.focusIndex = m.seasonFocus
    screen.observeField("episodeSelected", "onEpisodeSelected")
    screen.observeField("backRequested", "showDetailFromCache")
end sub

sub onEpisodeSelected(event as Object)
    selection = event.GetData()
    m.seasonFocus = selection.focusIndex
    m.state = "LOADING_EPISODE"
    url = JoinUrl(m.registry.serverUrl, m.routes.episodes + "/" + UrlEncode(selection.id))
    runRequest({ url: url, method: "GET", token: m.registry.accessToken }, "onEpisodeLoaded", "onAuthorizedFailure")
end sub

sub onEpisodeLoaded(event as Object)
    m.currentEpisodeData = event.GetData().data
    showEpisodeFromCache()
end sub

sub showEpisodeFromCache()
    m.state = "READY"
    m.currentDestination = "episode"
    screen = showScreen("EpisodeScreen")
    screen.episode = m.currentEpisodeData
    screen.observeField("playSelected", "onPlaySelected")
    screen.observeField("backRequested", "showSeasonFromCache")
end sub

sub onPlaySelected(event as Object)
    selection = event.GetData()
    resolvePlaybackSelection(selection)
end sub
