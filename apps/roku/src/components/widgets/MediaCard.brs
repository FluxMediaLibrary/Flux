sub init()
    m.theme = FluxTheme()
    m.art = m.top.findNode("art")
    m.poster = m.top.findNode("poster")
    m.dim = m.top.findNode("dim")
    m.posterFallback = "pkg:/images/placeholder-poster.png"
    m.poster.observeField("loadStatus", "onPosterLoadStatus")
    m.focus = m.top.findNode("focus")
    m.title = m.top.findNode("title")
    m.subtitle = m.top.findNode("subtitle")
    m.title.font = FluxFont(24, true)
    m.subtitle.font = FluxFont(21, false)
    m.top.findNode("countBadgeText").font = FluxFont(19, true)
    m.art.scaleRotateCenter = [98, 147]
end sub

sub render()
    item = m.top.itemContent
    if item = invalid then return
    posterUrl = item.hdPosterUrl
    if posterUrl = invalid or posterUrl = "" then posterUrl = m.posterFallback
    m.poster.uri = posterUrl
    m.title.text = item.title
    subtitle = ""
    if item.HasField("mediaType") and item.mediaType = "retry"
        subtitle = "Tap to retry"
    else if item.HasField("subtitle") and item.subtitle <> invalid and item.subtitle <> "" and item.HasField("mediaType") and item.mediaType = "episode"
        subtitle = item.subtitle
    else if item.HasField("year") and item.year <> invalid
        subtitle = item.year.ToStr()
    end if
    m.subtitle.text = subtitle

    progress = 0.0
    if item.HasField("progress") then progress = FluxProgressPercent(item.progress)
    showProgress = progress > 0.01 and progress < 0.98
    m.top.findNode("progressTrack").visible = showProgress
    m.top.findNode("progressFill").visible = showProgress
    m.top.findNode("progressFill").width = 176 * progress

    watched = item.HasField("watched") and item.watched = true
    m.top.findNode("watchedBadge").visible = watched
    count = invalid
    if item.HasField("unplayedCount") then count = item.unplayedCount
    badgeVisible = count <> invalid and count > 0 and not watched
    m.top.findNode("countBadge").visible = badgeVisible
    if badgeVisible
        text = count.ToStr()
        m.top.findNode("countBadgeText").text = text
        width = 30 + 10 * Len(text)
        m.top.findNode("countPill").width = width
        m.top.findNode("countBadgeText").width = width
    end if
    available = true
    if item.HasField("available") then available = item.available <> false
    if available then m.dim.opacity = 0 else m.dim.opacity = 0.55
end sub

sub onPosterLoadStatus()
    if m.poster.loadStatus = "failed" and m.poster.uri <> m.posterFallback then m.poster.uri = m.posterFallback
end sub

sub renderFocus()
    focused = m.top.focusPercent > 0.5
    m.focus.visible = focused
    if focused
        m.art.scale = [1.06, 1.06]
        m.title.color = m.theme.primaryText
    else
        m.art.scale = [1.0, 1.0]
        m.title.color = m.theme.secondaryText
    end if
end sub
