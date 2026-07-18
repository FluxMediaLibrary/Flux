sub init()
    m.contentHost = m.top.findNode("contentHost")
    m.spinner = m.top.findNode("spinner")
    m.watchdog = m.top.findNode("startupWatchdog")
    m.state = "INITIALIZING"
    m.registry = ReadRegistryState()
    m.navigation = CreateNavigationState()
    m.routes = ApiRoutes()
    m.bootstrap = invalid
    m.currentScreen = invalid
    m.requestTask = invalid
    m.requestGeneration = 0
    m.activeRequestId = 0
    m.detailStack = []
    m.libraryFocus = {}
    m.librarySort = "title"
    m.libraryWatched = "all"
    m.libraryGenre = ""
    m.recentSearches = ReadRecentSearches()
    m.top.backgroundColor = "#0d0f12"
    LogEvent("info", "startup", "application_started", { version: AppVersion() })
    showScreen("SplashScreen")
    m.watchdog.observeField("fire", "onStartupTimeout")
    beginStartup()
end sub

sub onStartupTimeout(event as Object)
    if m.state = "READY" or m.state = "ERROR" then return
    LogEvent("warn", "startup", "watchdog_triggered", { state: m.state })
    if m.requestTask <> invalid and m.requestTask.state = "run" then m.requestTask.control = "STOP"
    m.spinner.visible = false
    m.state = "ERROR"
    if m.registry.serverUrl = ""
        showServerSetup()
    else
        showError("Server did not respond", "The Flux server at " + m.registry.serverUrl + " did not respond within the time limit. Check that the server is running and reachable from this network.", true, "retryStartup")
    end if
end sub

sub retryStartup()
    showScreen("SplashScreen")
    beginStartup()
end sub

sub showCompatibility(message as String)
    m.state = "ERROR"
    screen = showScreen("MessageScreen")
    screen.title = "Unsupported server"
    screen.message = message
    screen.actions = ["Retry", "Remove server"]
    screen.observeField("actionSelected", "onUnsupportedAction")
end sub

sub onUnsupportedAction(event as Object)
    if event.GetData() = 0 then retryStartup() else removeServer()
end sub

sub onRequiredUpdateAction(event as Object)
    if event.GetData() = 0 then retryStartup() else removeServer()
end sub

sub removeServer()
    ClearServer()
    m.registry = ReadRegistryState()
    retryStartup()
end sub

sub showError(title as String, message as String, retryable as Boolean, callbackName as String)
    m.state = "ERROR"
    screen = showScreen("MessageScreen")
    screen.title = title
    screen.message = message
    if retryable then screen.actions = ["Retry"] else screen.actions = ["Back"]
    screen.observeField("actionSelected", callbackName)
end sub

function showScreen(componentName as String) as Object
    if m.watchdog <> invalid then m.watchdog.control = "stop"
    if m.devicePollingTask <> invalid and componentName <> "DeviceLinkScreen"
        m.devicePollingTask.control = "STOP"
        m.devicePollingTask = invalid
    end if
    if m.currentScreen <> invalid
        m.contentHost.RemoveChild(m.currentScreen)
    end if
    screen = CreateObject("roSGNode", componentName)
    m.contentHost.AppendChild(screen)
    m.currentScreen = screen
    screen.SetFocus(true)
    return screen
end function

sub runRequest(request as Object, successCallback as String, failureCallback as String)
    if m.requestTask <> invalid and m.requestTask.state = "run" then m.requestTask.control = "STOP"
    m.spinner.visible = true
    m.requestGeneration++
    task = CreateObject("roSGNode", "ApiRequestTask")
    task.requestId = m.requestGeneration
    task.request = request
    task.observeField("response", successCallback)
    task.observeField("failure", failureCallback)
    task.observeField("state", "onRequestState")
    m.requestTask = task
    m.activeRequestId = task.requestId
    task.control = "RUN"
end sub

sub runBackgroundRequest(request as Object)
    task = CreateObject("roSGNode", "ApiRequestTask")
    task.request = request
    if m.backgroundTasks = invalid then m.backgroundTasks = []
    m.backgroundTasks.Push(task)
    if m.backgroundTasks.Count() > 8 then m.backgroundTasks.Shift()
    task.control = "RUN"
end sub

sub onRequestState(event as Object)
    requestNode = event.GetRoSGNode()
    if requestNode.requestId <> m.activeRequestId then return
    state = event.GetData()
    if state = "done" or state = "stop"
        m.spinner.visible = false
        ' Detect silent task death: completed without setting response or failure
        if m.requestTask.response = invalid and m.requestTask.failure = invalid
            LogEvent("error", "network", "task_died_silently", {})
            m.requestTask.failure = { code: "TASK_FAILED", message: "The network request could not be completed.", status: 0, retryable: true }
        end if
    end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "back" and m.state <> "READY"
        return true
    else if key = "back" and m.state = "READY" and m.currentDestination = "episode"
        showSeasonFromCache()
        return true
    else if key = "back" and m.state = "READY" and m.currentDestination = "season"
        showDetailFromCache()
        return true
    else if key = "back" and m.state = "READY" and m.currentDestination = "detail"
        if m.detailStack.Count() > 0
            m.currentDetailData = m.detailStack.Pop()
            showDetailFromCache()
        else
            returnToContentOrigin()
        end if
        return true
    else if key = "back" and m.state = "READY" and m.currentDestination <> "home"
        showCachedHome()
        return true
    end if
    return false
end function

sub returnToContentOrigin()
    if m.returnDestination = "movies" or m.returnDestination = "shows"
        loadLibrary(m.returnDestination, m.libraryPage)
    else if m.returnDestination = "search"
        showSearch()
    else if m.returnDestination = "requests"
        loadRequests()
    else
        showCachedHome()
    end if
end sub

sub showCachedHome()
    if m.cachedHome <> invalid then showHome(m.cachedHome, "") else loadHome()
end sub
