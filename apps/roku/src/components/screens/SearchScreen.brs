sub init()
    m.theme = FluxTheme()
    m.keyboard = m.top.findNode("keyboard")
    m.resultRows = m.top.findNode("resultRows")
    m.recent = m.top.findNode("recent")
    m.recentHeader = m.top.findNode("recentHeader")
    m.hint = m.top.findNode("hint")
    m.debounce = m.top.findNode("debounce")
    m.keyboard.observeField("text", "onTextChanged")
    m.resultRows.observeField("rowItemSelected", "onSelected")
    m.recent.observeField("itemSelected", "onRecentSelected")
    m.debounce.observeField("fire", "onDebounce")
    m.hint.font = FluxFont(24, false)
    m.recentHeader.font = FluxFont(20, true)
    m.resultRows.rowLabelFont = FluxFont(28, true)
    m.top.findNode("topbar").contextLabel = "Search your library"
    m.hint.text = "Type at least two characters"
end sub

sub onTextChanged()
    m.debounce.control = "stop"
    if Len(m.keyboard.text.Trim()) >= 2
        m.hint.text = "Searching as you type…"
        m.debounce.control = "start"
    else
        m.hint.text = "Type at least two characters"
    end if
end sub

sub renderRecent()
    content = CreateObject("roSGNode", "ContentNode")
    for each query in m.top.recentSearches
        item = content.CreateChild("ContentNode")
        item.title = query
        item.addFields({ value: "", detail: "" })
    end for
    m.recent.content = content
    hasRecent = content.GetChildCount() > 0
    m.recent.visible = hasRecent
    m.recentHeader.visible = hasRecent
end sub

sub renderState()
    if m.top.loading
        m.hint.text = "Searching Flux…"
    else if m.top.errorMessage <> ""
        m.hint.text = m.top.errorMessage
    end if
end sub

sub restoreQuery()
    m.keyboard.text = m.top.initialQuery
end sub

sub applyVoiceQuery()
    query = m.top.voiceQuery.Trim()
    if query = "" then return
    ' Keep voice input on the same validated keyboard/debounce path as remote input.
    m.keyboard.text = query
end sub

sub onDebounce()
    m.top.queryChanged = m.keyboard.text.Trim()
end sub

sub renderResults()
    data = m.top.results
    if data = invalid then return
    root = CreateObject("roSGNode", "ContentNode")
    addResultRow(root, "Movies", data.movies)
    addResultRow(root, "Shows", data.shows)
    addResultRow(root, "Episodes", data.episodes)
    m.resultRows.content = root
    hasResults = root.GetChildCount() > 0
    m.resultRows.visible = hasResults
    if not hasResults and m.resultRows.HasFocus() then m.keyboard.SetFocus(true)
    if hasResults
        count = 0
        for index = 0 to root.GetChildCount() - 1
            count = count + root.GetChild(index).GetChildCount()
        end for
        m.hint.text = count.ToStr() + " result"
        if count <> 1 then m.hint.text = m.hint.text + "s"
        m.hint.text = m.hint.text + " for “" + data.query + "”   ·   press Right to browse"
    else
        m.hint.text = "Nothing in your library matches “" + data.query + "”"
    end if
end sub

sub onRecentSelected()
    if m.recent.content = invalid then return
    item = m.recent.content.GetChild(m.recent.itemSelected)
    if item <> invalid then m.top.recentSelected = item.title
end sub

sub addResultRow(root as Object, title as String, items as Object)
    if items = invalid or items.Count() = 0 then return
    row = root.CreateChild("ContentNode")
    row.title = title
    for each media in items
        row.AppendChild(FluxContentFromCard(media))
    end for
end sub

sub onSelected()
    indices = m.resultRows.rowItemSelected
    if indices.Count() <> 2 then return
    if m.resultRows.content = invalid then return
    row = m.resultRows.content.GetChild(indices[0])
    if row = invalid then return
    item = row.GetChild(indices[1])
    if item = invalid then return
    m.top.mediaSelected = { id: item.id, mediaType: item.mediaType, parentMediaId: item.parentMediaId }
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "right" and (m.keyboard.HasFocus() or m.recent.HasFocus()) and m.resultRows.visible and m.resultRows.content <> invalid and m.resultRows.content.GetChildCount() > 0
        m.resultRows.SetFocus(true)
        return true
    else if key = "left" and m.resultRows.HasFocus()
        m.keyboard.SetFocus(true)
        return true
    else if key = "down" and m.keyboard.HasFocus() and m.recent.visible
        m.recent.SetFocus(true)
        return true
    else if key = "up" and m.recent.HasFocus()
        m.keyboard.SetFocus(true)
        return true
    end if
    return false
end function
