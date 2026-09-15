sub init()
    m.requests = m.top.findNode("requests")
    m.requests.observeField("itemSelected", "onSelected")
end sub

sub renderRequests()
    data = m.top.requestData
    if data = invalid then return
    content = CreateObject("roSGNode", "ContentNode")
    for each request in data.requests
        if not IsAssociativeArray(request) then continue for
        if request.id = invalid then continue for
        if request.title = invalid or request.title = "" then request.title = "Untitled request"
        if request.status = invalid or request.status = "" then request.status = "Unknown status"
        item = content.CreateChild("ContentNode")
        scope = ""
        if request.season <> invalid then scope = " · Season " + request.season.ToStr()
        if request.episode <> invalid then scope = scope + " Episode " + request.episode.ToStr()
        item.title = request.title + scope + "  —  " + request.status
        item.id = request.id
    end for
    empty = content.GetChildCount() = 0
    m.top.findNode("empty").visible = empty
    if empty
        item = content.CreateChild("ContentNode")
        item.id = "back"
        item.title = "Back to Home"
        m.requests.translation = [100, 330]
    else
        m.requests.translation = [100, 220]
    end if
    m.requests.content = content
    m.requests.visible = true
    m.requests.SetFocus(true)
end sub

sub onSelected()
    if m.requests.content = invalid then return
    item = m.requests.content.GetChild(m.requests.itemSelected)
    if item <> invalid and item.id = "back" then m.top.backRequested = true
end sub
