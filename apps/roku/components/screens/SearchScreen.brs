sub init()
    m.keyboard = m.top.findNode("keyboard")
    m.resultRows = m.top.findNode("resultRows")
    m.recent = m.top.findNode("recent")
    m.debounce = m.top.findNode("debounce")
    m.keyboard.observeField("text", "onTextChanged")
    m.resultRows.observeField("rowItemSelected", "onSelected")
    m.recent.observeField("itemSelected", "onRecentSelected")
    m.debounce.observeField("fire", "onDebounce")
end sub

sub onTextChanged()
    m.debounce.control = "stop"
    if Len(m.keyboard.text.Trim()) >= 2
        m.top.findNode("hint").text = "Waiting to search…"
        m.debounce.control = "start"
    else
        m.top.findNode("hint").text = "Enter at least two characters"
    end if
end sub

sub renderRecent()
    content = CreateObject("roSGNode", "ContentNode")
    for each query in m.top.recentSearches
        item = content.CreateChild("ContentNode")
        item.title = query
    end for
    m.recent.content = content
    m.recent.visible = content.GetChildCount() > 0
end sub

sub renderState()
    if m.top.loading
        m.top.findNode("hint").text = "Searching Flux…"
    else if m.top.errorMessage <> ""
        m.top.findNode("hint").text = m.top.errorMessage
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
    if root.GetChildCount() = 0 then m.top.findNode("hint").text = "No results for “" + data.query + "”" else m.top.findNode("hint").text = "Results for “" + data.query + "”"
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
        item = row.CreateChild("ContentNode")
        item.id = media.id
        item.title = media.title
        item.description = media.overview
        item.hdPosterUrl = FluxArtworkUrl(media, "poster", "pkg:/images/placeholder-poster.png")
        item.addFields({ mediaType: media.mediaType, parentMediaId: media.parentMediaId, progress: media.progress, watched: media.watched, unplayedCount: media.unplayedCount })
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
    if key = "right" and m.keyboard.HasFocus() and m.resultRows.content <> invalid and m.resultRows.content.GetChildCount() > 0
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
