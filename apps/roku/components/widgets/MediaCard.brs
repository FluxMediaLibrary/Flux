sub init()
end sub

sub render()
    item = m.top.itemContent
    if item = invalid then return
    posterUrl = item.hdPosterUrl
    if posterUrl = invalid or posterUrl = "" then posterUrl = "pkg:/images/placeholder-poster.png"
    m.top.findNode("poster").uri = posterUrl
    m.top.findNode("title").text = item.title
    progress = 0.0
    if item.progress <> invalid
        if item.progress.percent <> invalid then progress = item.progress.percent else progress = ProgressPercent(item.progress.positionSeconds, item.progress.durationSeconds)
    end if
    if progress < 0 then progress = 0
    if progress > 1 then progress = 1
    m.top.findNode("progressTrack").visible = progress > 0 and progress < 1
    m.top.findNode("progressFill").visible = progress > 0 and progress < 1
    m.top.findNode("progressFill").width = 216 * progress
    watched = item.watched = true
    m.top.findNode("watchedBadge").visible = watched
    m.top.findNode("watchedBadgeText").visible = watched
    count = item.unplayedCount
    badgeVisible = count <> invalid and count > 0
    m.top.findNode("countBadge").visible = badgeVisible
    countText = m.top.findNode("countBadgeText")
    countText.visible = badgeVisible
    if badgeVisible then countText.text = count.ToStr() + " unplayed"
end sub

sub renderFocus()
    m.top.findNode("focus").visible = m.top.focusPercent > 0.5
    if m.top.focusPercent > 0.5 then m.top.scale = [1.04, 1.04] else m.top.scale = [1.0, 1.0]
end sub
