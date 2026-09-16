sub init()
    m.theme = FluxTheme()
    m.requests = m.top.findNode("requests")
    m.emptyState = m.top.findNode("emptyState")
    m.emptyActions = m.top.findNode("emptyActions")
    m.requests.observeField("itemSelected", "onSelected")
    m.emptyActions.observeField("itemSelected", "onEmptyAction")
    m.top.findNode("titleLabel").font = FluxFont(52, true)
    m.top.findNode("summary").font = FluxFont(24, false)
    m.top.findNode("emptyTitle").font = FluxFont(36, true)
    m.top.findNode("emptyBody").font = FluxFont(26, false)
    m.top.findNode("topbar").contextLabel = "Back returns home"
end sub

sub renderRequests()
    data = m.top.requestData
    if data = invalid then return
    content = CreateObject("roSGNode", "ContentNode")
    active = 0
    for each request in data.requests
        if not IsAssociativeArray(request) then continue for
        if request.id = invalid then continue for
        title = request.title
        if title = invalid or title = "" then title = "Untitled request"
        status = request.status
        if status = invalid or status = "" then status = "Unknown"
        item = content.CreateChild("ContentNode")
        item.id = request.id
        item.title = title
        scope = ""
        if request.mediaType = "show" then scope = "Series" else scope = "Movie"
        if request.season <> invalid then scope = scope + "   ·   Season " + request.season.ToStr()
        if request.episode <> invalid then scope = scope + ", Episode " + request.episode.ToStr()
        item.addFields({ detail: scope, value: status })
        if request.stage <> "AVAILABLE" and request.stage <> "REJECTED" then active = active + 1
    end for
    empty = content.GetChildCount() = 0
    m.emptyState.visible = empty
    m.requests.visible = not empty
    if empty
        m.top.findNode("summary").text = ""
        actions = CreateObject("roSGNode", "ContentNode")
        item = actions.CreateChild("ContentNode")
        item.title = "Back to Home"
        item.addFields({ id: "back", icon: "", primary: true })
        m.emptyActions.content = actions
        m.emptyActions.SetFocus(true)
    else
        summary = content.GetChildCount().ToStr() + " request"
        if content.GetChildCount() <> 1 then summary = summary + "s"
        summary = summary + "   ·   " + active.ToStr() + " in progress"
        m.top.findNode("summary").text = summary
        m.requests.content = content
        m.requests.SetFocus(true)
    end if
end sub

sub onEmptyAction()
    m.top.backRequested = true
end sub

sub onSelected()
    ' Requests are read-only on the TV; selecting one does nothing yet.
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "up" and (m.requests.HasFocus() and m.requests.itemFocused = 0 or m.emptyActions.HasFocus())
        m.top.findNode("topbar").focusRequested = true
        return true
    else if key = "down" and m.top.findNode("topbar").findNode("tabs").HasFocus()
        if m.requests.visible then m.requests.SetFocus(true) else m.emptyActions.SetFocus(true)
        return true
    end if
    return false
end function
