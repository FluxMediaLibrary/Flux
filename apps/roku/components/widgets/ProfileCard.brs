sub init()
    m.theme = FluxTheme()
    m.name = m.top.findNode("name")
    m.avatar = m.top.findNode("avatar")
    m.avatarFallback = "pkg:/images/logo.png"
    m.avatar.observeField("loadStatus", "onAvatarLoadStatus")
    m.focusBorder = m.top.findNode("focusBorder")
    m.focusBorder.color = m.theme.focus
end sub

sub render()
    if m.top.itemContent = invalid then return
    m.name.text = m.top.itemContent.title
    avatarUrl = m.top.itemContent.hdPosterUrl
    if avatarUrl = invalid or avatarUrl = "" then avatarUrl = m.avatarFallback
    m.avatar.uri = avatarUrl
end sub

sub onAvatarLoadStatus()
    if m.avatar.loadStatus = "failed" and m.avatar.uri <> m.avatarFallback then m.avatar.uri = m.avatarFallback
end sub

sub renderFocus()
    m.focusBorder.visible = m.top.focusPercent > 0.5
    if m.top.focusPercent > 0.5 then m.top.scale = [1.04, 1.04] else m.top.scale = [1.0, 1.0]
end sub

