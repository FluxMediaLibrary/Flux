sub init()
    m.poster = m.top.findNode("poster")
    m.wide = m.top.findNode("wide")
    m.isWide = false
end sub

sub layout()
    if m.top.width <= 0 or m.top.height <= 0 then return
    wide = m.top.width > m.top.height
    if wide = m.isWide then return
    m.isWide = wide
    m.poster.visible = not wide
    m.wide.visible = wide
    render()
    renderFocus()
end sub

sub render()
    content = m.top.itemContent
    if content = invalid then return
    if m.isWide then m.wide.itemContent = content else m.poster.itemContent = content
end sub

sub renderFocus()
    if m.isWide then m.wide.focusPercent = m.top.focusPercent else m.poster.focusPercent = m.top.focusPercent
end sub
