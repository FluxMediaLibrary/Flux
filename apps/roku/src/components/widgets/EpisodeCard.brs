sub init()
    m.theme = FluxTheme()
    m.art = m.top.findNode("art")
    m.still = m.top.findNode("still")
    m.dim = m.top.findNode("dim")
    m.fallback = "pkg:/images/placeholder-backdrop.png"
    m.still.observeField("loadStatus", "onStillLoadStatus")
    m.focus = m.top.findNode("focus")
    m.title = m.top.findNode("title")
    m.subtitle = m.top.findNode("subtitle")
    m.title.font = FluxFont(24, true)
    m.subtitle.font = FluxFont(21, false)
    m.top.findNode("numberText").font = FluxFont(19, true)
    m.art.scaleRotateCenter = [196, 110]
end sub

sub render()
    item = m.top.itemContent
    if item = invalid then return
    url = ""
    if item.HasField("thumbnailUrl") then url = item.thumbnailUrl
    if url = invalid or url = "" then url = item.hdPosterUrl
    if url = invalid or url = "" then url = m.fallback
    m.still.uri = url
    m.title.text = item.title
    if item.HasField("subtitle") and item.subtitle <> invalid then m.subtitle.text = item.subtitle else m.subtitle.text = ""

    ' Episode number badge when the content carries one (S1 · E4 style subtitle
    ' comes from the server; the badge shows the bare number).
    number = ""
    if item.HasField("episodeNumber") and item.episodeNumber <> invalid and item.episodeNumber > 0 then number = item.episodeNumber.ToStr()
    badge = m.top.findNode("numberBadge")
    badge.visible = number <> ""
    if number <> ""
        m.top.findNode("numberText").text = number
        width = 24 + 12 * Len(number)
        if width < 44 then width = 44
        m.top.findNode("numberPill").width = width
        m.top.findNode("numberText").width = width
    end if

    progress = 0.0
    if item.HasField("progress") then progress = FluxProgressPercent(item.progress)
    showProgress = progress > 0.01 and progress < 0.98
    m.top.findNode("progressTrack").visible = showProgress
    m.top.findNode("progressFill").visible = showProgress
    m.top.findNode("progressFill").width = 368 * progress
    m.top.findNode("watchedBadge").visible = item.HasField("watched") and item.watched = true
    available = true
    if item.HasField("available") then available = item.available <> false
    if available then m.dim.opacity = 0 else m.dim.opacity = 0.55
    m.available = available
end sub

sub onStillLoadStatus()
    if m.still.loadStatus = "failed" and m.still.uri <> m.fallback then m.still.uri = m.fallback
end sub

sub renderFocus()
    focused = m.top.focusPercent > 0.5
    m.focus.visible = focused
    m.top.findNode("playHint").visible = focused and m.available = true
    if focused
        m.art.scale = [1.04, 1.04]
        m.title.color = m.theme.primaryText
    else
        m.art.scale = [1.0, 1.0]
        m.title.color = m.theme.secondaryText
    end if
end sub
