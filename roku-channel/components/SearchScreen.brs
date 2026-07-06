' SearchScreen.brs
' TMDb search with All/Movies/TV Shows tabs.

sub init()
    m.searchBarBg = m.top.FindNode("searchBarBg")
    m.searchBarText = m.top.FindNode("searchBarText")
    m.resultGrid = m.top.FindNode("resultGrid")
    m.spinner = m.top.FindNode("spinner")
    m.emptyLabel = m.top.FindNode("emptyLabel")
    m.errorLabel = m.top.FindNode("errorLabel")
    
    m.tabAll = m.top.FindNode("tabAll")
    m.tabMovies = m.top.FindNode("tabMovies")
    m.tabShows = m.top.FindNode("tabShows")
    
    m.currentTab = 0 ' 0=all (movies), 1=movies, 2=shows
    m.searchQuery = ""
    m.focusMode = "search" ' "search" or "results"
    
    m.resultGrid.ObserveField("itemSelected", "onResultSelected")
    
    m.updateTabs()
end sub

sub updateTabs()
    m.tabAll.color = "#666666"
    m.tabMovies.color = "#666666"
    m.tabShows.color = "#666666"
    m.tabAll.font = "font:MediumSystemFont"
    m.tabMovies.font = "font:MediumSystemFont"
    m.tabShows.font = "font:MediumSystemFont"
    
    if m.currentTab = 0
        m.tabAll.color = "#00cc66"
        m.tabAll.font = "font:MediumBoldSystemFont"
    else if m.currentTab = 1
        m.tabMovies.color = "#00cc66"
        m.tabMovies.font = "font:MediumBoldSystemFont"
    else if m.currentTab = 2
        m.tabShows.color = "#00cc66"
        m.tabShows.font = "font:MediumBoldSystemFont"
    end if
end sub

sub doSearch()
    if m.searchQuery = "" then return
    
    m.spinner.visible = true
    m.resultGrid.visible = false
    m.emptyLabel.visible = false
    m.errorLabel.visible = false
    
    api = m.top.api
    
    ' Determine type for the query
    ' "All" searches both — we'll search movies first, then shows
    typeParam = "movie"
    if m.currentTab = 2 then typeParam = "tv"
    
    response = api.searchTmdb(m.searchQuery, typeParam)
    m.spinner.visible = false
    
    if response.code <> 200 or response.json = invalid
        m.errorLabel.text = "Search failed."
        m.errorLabel.visible = true
        return
    end if
    
    results = response.json
    
    ' If searching "All", also fetch TV results and merge
    if m.currentTab = 0
        tvResponse = api.searchTmdb(m.searchQuery, "tv")
        if tvResponse.code = 200 and tvResponse.json <> invalid
            ' Merge TV results after movie results
            for each tvItem in tvResponse.json
                results.Push(tvItem)
            end for
        end if
    end if
    
    if results.Count() = 0
        m.emptyLabel.visible = true
        return
    end if
    
    content = CreateObject("roSGNode", "ContentNode")
    for each item in results
        entry = content.CreateChild("ContentNode")
        entry.title = item.title
        if item.year <> invalid then entry.title = entry.title + " (" + item.year.ToStr() + ")"
        entry.HDPosterUrl = api.posterUrl(item.posterPath)
        entry.tmdbId = item.tmdbId
        entry.mediaType = item.mediaType
        entry.inLibrary = item.inLibrary
        entry.mediaItemId = item.mediaItemId
        entry.description = item.mediaType
        if item.inLibrary = true
            entry.description = "In Library"
        end if
    end for
    
    m.resultGrid.content = content
    m.resultGrid.visible = true
    m.resultGrid.SetFocus(true)
    m.focusMode = "results"
end sub

sub onResultSelected(event as object)
    index = event.GetData()
    content = m.resultGrid.content
    item = content.GetChild(index)
    
    if item = invalid then return
    
    if item.inLibrary = true and item.mediaItemId <> invalid
        nav = { action: "go_to_detail", mediaItemId: item.mediaItemId, title: item.title }
        m.top.navigate = nav
    else
        nav = { action: "go_to_tmdb_detail", mediaType: item.mediaType, tmdbId: item.tmdbId, title: item.title }
        m.top.navigate = nav
    end if
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if NOT press then return false
    
    if key = "back"
        if m.focusMode = "results"
            m.focusMode = "search"
            m.searchBarBg.color = "#0d3320"
            return true
        end if
        m.top.close = true
        return true
    else if key = "OK"
        if m.focusMode = "search"
            m.showSearchKeyboard()
            return true
        end if
    else if key = "left"
        if m.focusMode = "search" and m.currentTab > 0
            m.currentTab = m.currentTab - 1
            m.updateTabs()
            if m.searchQuery <> "" then m.doSearch()
        end if
        return true
    else if key = "right"
        if m.focusMode = "search" and m.currentTab < 2
            m.currentTab = m.currentTab + 1
            m.updateTabs()
            if m.searchQuery <> "" then m.doSearch()
        end if
        return true
    else if key = "down"
        if m.focusMode = "search" and m.resultGrid.visible
            m.resultGrid.SetFocus(true)
            m.focusMode = "results"
        end if
        return true
    end if
    
    return false
end function

sub showSearchKeyboard()
    keyboard = CreateObject("roKeyboardScreen")
    port = CreateObject("roMessagePort")
    keyboard.SetMessagePort(port)
    keyboard.SetTitle("Search movies and TV shows")
    keyboard.SetText(m.searchQuery)
    keyboard.SetDisplayText(m.searchQuery)
    keyboard.Show()
    
    while true
        msg = wait(0, port)
        if type(msg) = "roKeyboardScreenEvent"
            if msg.IsScreenClosed()
                exit while
            else if msg.IsButtonPressed()
                m.searchQuery = keyboard.GetText()
                m.searchBarText.text = m.searchQuery
                if m.searchQuery <> ""
                    m.searchBarText.color = "#ffffff"
                    m.doSearch()
                end if
                exit while
            end if
        end if
    end while
end sub
