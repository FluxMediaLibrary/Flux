' LibraryScreen.brs
' Grid view of the library with All/Movies/TV Shows filter tabs.

sub init()
    m.posterGrid = m.top.FindNode("posterGrid")
    m.spinner = m.top.FindNode("spinner")
    m.emptyLabel = m.top.FindNode("emptyLabel")
    m.errorLabel = m.top.FindNode("errorLabel")
    m.tabAll = m.top.FindNode("tabAll")
    m.tabMovies = m.top.FindNode("tabMovies")
    m.tabShows = m.top.FindNode("tabShows")
    
    m.currentTab = 0 ' 0=all, 1=movies, 2=shows
    m.filterType = m.top.filterType
    if m.filterType = "movie" then m.currentTab = 1
    if m.filterType = "tv" or m.filterType = "show" then m.currentTab = 2
    
    m.posterGrid.ObserveField("itemSelected", "onItemSelected")
    
    m.updateTabs()
    m.loadLibrary()
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

sub loadLibrary()
    m.spinner.visible = true
    m.posterGrid.visible = false
    m.emptyLabel.visible = false
    m.errorLabel.visible = false
    
    api = m.top.api
    typeParam = "all"
    if m.currentTab = 1 then typeParam = "movie"
    if m.currentTab = 2 then typeParam = "tv"
    
    response = api.listLibrary(typeParam)
    m.spinner.visible = false
    
    if response.code <> 200 or response.json = invalid
        m.errorLabel.text = "Failed to load library."
        m.errorLabel.visible = true
        return
    end if
    
    items = response.json
    if items.Count() = 0
        m.emptyLabel.visible = true
        return
    end if
    
    content = CreateObject("roSGNode", "ContentNode")
    for each item in items
        entry = content.CreateChild("ContentNode")
        entry.title = item.title
        entry.HDPosterUrl = api.posterUrl(item.posterPath)
        entry.id = item.id
        entry.mediaType = item.type
        ' Badge info
        if item.watched <> invalid and item.watched = true
            entry.description = "Watched"
        else if item.unplayedCount <> invalid and item.unplayedCount > 0
            entry.description = item.unplayedCount.ToStr() + " episodes"
        end if
    end for
    
    m.posterGrid.content = content
    m.posterGrid.visible = true
    m.posterGrid.SetFocus(true)
end sub

sub onItemSelected(event as object)
    index = event.GetData()
    content = m.posterGrid.content
    item = content.GetChild(index)
    
    if item <> invalid and item.id <> invalid
        nav = { action: "go_to_detail", mediaItemId: item.id, title: item.title }
        m.top.navigate = nav
    end if
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if NOT press then return false
    
    if key = "back"
        m.top.close = true
        return true
    else if key = "left" and NOT m.posterGrid.IsInFocusChain()
        ' When focus is on tabs
        if m.currentTab > 0
            m.currentTab = m.currentTab - 1
            m.updateTabs()
            m.loadLibrary()
        end if
        return true
    else if key = "right" and NOT m.posterGrid.IsInFocusChain()
        if m.currentTab < 2
            m.currentTab = m.currentTab + 1
            m.updateTabs()
            m.loadLibrary()
        end if
        return true
    else if key = "down"
        ' Move focus from tabs to grid
        if m.posterGrid.visible then m.posterGrid.SetFocus(true)
        return true
    else if key = "up"
        ' Move focus from grid to tabs if at top
        return true
    end if
    
    return false
end function
