sub init()
    m.name = m.top.findNode("name")
    m.avatar = m.top.findNode("avatar")
    m.focusBorder = m.top.findNode("focusBorder")
end sub

sub render()
    if m.top.itemContent = invalid then return
    m.name.text = m.top.itemContent.title
    if m.top.itemContent.hdPosterUrl <> "" then m.avatar.uri = m.top.itemContent.hdPosterUrl else m.avatar.uri = "pkg:/images/logo.png"
end sub

sub renderFocus()
    m.focusBorder.visible = m.top.focusPercent > 0.5
end sub

