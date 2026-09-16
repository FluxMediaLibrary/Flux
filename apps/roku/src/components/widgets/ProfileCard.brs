sub init()
    m.theme = FluxTheme()
    m.tile = m.top.findNode("tile")
    m.tileFill = m.top.findNode("tileFill")
    m.initial = m.top.findNode("initial")
    m.avatar = m.top.findNode("avatar")
    m.focus = m.top.findNode("focus")
    m.name = m.top.findNode("name")
    m.initial.font = FluxFont(96, true)
    m.name.font = FluxFont(28, true)
    m.avatar.observeField("loadStatus", "onAvatarLoadStatus")
    m.tile.scaleRotateCenter = [110, 110]
end sub

' Deterministic tile colour per profile so the picker stays recognisable.
function tileColorFor(name as String) as String
    palette = ["#3B82F6", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#06B6D4"]
    total = 0
    for i = 1 to Len(name)
        total = total + Asc(Mid(name, i, 1))
    end for
    return palette[total mod palette.Count()]
end function

sub render()
    item = m.top.itemContent
    if item = invalid then return
    label = item.title
    if label = invalid or label = "" then label = "Profile"
    m.name.text = label
    m.initial.text = UCase(Left(label, 1))
    m.tileFill.blendColor = tileColorFor(label)
    avatarUrl = item.hdPosterUrl
    if avatarUrl <> invalid and avatarUrl <> "" and Left(avatarUrl, 4) = "http"
        m.avatar.uri = avatarUrl
        m.avatar.visible = true
    else
        m.avatar.visible = false
    end if
end sub

sub onAvatarLoadStatus()
    if m.avatar.loadStatus = "failed" then m.avatar.visible = false
end sub

sub renderFocus()
    focused = m.top.focusPercent > 0.5
    m.focus.visible = focused
    if focused
        m.tile.scale = [1.08, 1.08]
        m.name.color = m.theme.primaryText
    else
        m.tile.scale = [1.0, 1.0]
        m.name.color = m.theme.secondaryText
    end if
end sub
