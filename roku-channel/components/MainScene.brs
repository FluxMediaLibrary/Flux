' MainScene.brs
' Root scene — manages screen stack navigation and global state.

sub init()
    m.api = FluxApiClient()
    m.screenStack = []
    
    ' Check for saved token — if we have one, skip login
    token = m.api.getToken()
    if token <> ""
        ' Try going straight to profile select / home
        m.showHomeScreen()
    else
        m.showLoginScreen()
    end if
end sub

' --- Navigation ---

sub pushScreen(screenName as string)
    screen = CreateObject("roSGNode", screenName)
    screen.observeField("close", "onScreenClose")
    screen.observeField("navigate", "onNavigate")
    screen.SetField("api", m.api)
    m.top.AppendChild(screen)
    screen.SetFocus(true)
    m.screenStack.Push(screen)
end sub

sub popScreen()
    if m.screenStack.Count() > 0 then
        screen = m.screenStack.Pop()
        m.top.RemoveChild(screen)
    end if
    ' Focus the top screen
    if m.screenStack.Count() > 0 then
        topScreen = m.screenStack.Peek()
        topScreen.SetFocus(true)
    end if
end sub

sub showLoginScreen()
    m.pushScreen("LoginScreen")
end sub

sub showProfileSelectScreen(baseToken as string)
    m.api.saveTokens("", baseToken)
    m.pushScreen("ProfileSelectScreen")
end sub

sub showHomeScreen()
    m.pushScreen("HomeScreen")
end sub

sub showLibraryScreen(filterType = "all" as string)
    screen = CreateObject("roSGNode", "LibraryScreen")
    screen.observeField("close", "onScreenClose")
    screen.observeField("navigate", "onNavigate")
    screen.SetField("api", m.api)
    screen.SetField("filterType", filterType)
    m.top.AppendChild(screen)
    screen.SetFocus(true)
    m.screenStack.Push(screen)
end sub

sub showDetailScreen(mediaItemId as string, title as string)
    screen = CreateObject("roSGNode", "DetailScreen")
    screen.observeField("close", "onScreenClose")
    screen.observeField("navigate", "onNavigate")
    screen.SetField("api", m.api)
    screen.SetField("mediaItemId", mediaItemId)
    m.top.AppendChild(screen)
    screen.SetFocus(true)
    m.screenStack.Push(screen)
end sub

sub showPlayerScreen(mediaItemId as string, episodeId = "" as string, title = "" as string)
    screen = CreateObject("roSGNode", "PlayerScreen")
    screen.observeField("close", "onScreenClose")
    screen.observeField("navigate", "onNavigate")
    screen.SetField("api", m.api)
    screen.SetField("mediaItemId", mediaItemId)
    screen.SetField("episodeId", episodeId)
    screen.SetField("contentTitle", title)
    m.top.AppendChild(screen)
    screen.SetFocus(true)
    m.screenStack.Push(screen)
end sub

sub showSearchScreen()
    screen = CreateObject("roSGNode", "SearchScreen")
    screen.observeField("close", "onScreenClose")
    screen.observeField("navigate", "onNavigate")
    screen.SetField("api", m.api)
    m.top.AppendChild(screen)
    screen.SetFocus(true)
    m.screenStack.Push(screen)
end sub

sub showTmdbDetailScreen(mediaType as string, tmdbId as integer, title as string)
    screen = CreateObject("roSGNode", "TmdbDetailScreen")
    screen.observeField("close", "onScreenClose")
    screen.observeField("navigate", "onNavigate")
    screen.SetField("api", m.api)
    screen.SetField("mediaType", mediaType)
    screen.SetField("tmdbId", tmdbId)
    screen.SetField("contentTitle", title)
    m.top.AppendChild(screen)
    screen.SetFocus(true)
    m.screenStack.Push(screen)
end sub

' --- Event handlers ---

sub onScreenClose(event as object)
    m.popScreen()
end sub

sub onNavigate(event as object)
    data = event.GetData()
    action = data.action
    
    if action = "login_success"
        token = data.token
        baseToken = data.baseToken
        m.api.saveTokens(token, baseToken)
        m.showHomeScreen()
    else if action = "profile_activated"
        token = data.token
        m.api.saveTokens(token, m.api.getBaseToken())
        m.showHomeScreen()
    else if action = "go_to_login"
        m.api.clearTokens()
        m.showLoginScreen()
    else if action = "go_to_library"
        m.showLibraryScreen(data.filterType)
    else if action = "go_to_detail"
        m.showDetailScreen(data.mediaItemId, data.title)
    else if action = "go_to_tmdb_detail"
        m.showTmdbDetailScreen(data.mediaType, data.tmdbId, data.title)
    else if action = "go_to_player"
        m.showPlayerScreen(data.mediaItemId, data.episodeId, data.title)
    else if action = "go_to_search"
        m.showSearchScreen()
    else if action = "go_to_home"
        m.showHomeScreen()
    end if
end sub
