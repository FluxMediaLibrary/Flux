sub init()
    m.theme = FluxTheme()
    m.title = m.top.findNode("title")
    m.underline = m.top.findNode("underline")
    m.title.font = FluxFont(28, true)
    renderFocus()
end sub

sub layout()
    w = m.top.width
    h = m.top.height
    if w <= 0 or h <= 0 then return
    m.title.width = w
    m.title.height = h
    m.underline.width = w - 24
    m.underline.translation = [12, h - 6]
end sub

sub render()
    if m.top.itemContent = invalid then return
    m.title.text = m.top.itemContent.title
    layout()
end sub

sub renderFocus()
    fraction = m.top.focusPercent
    if not m.top.listHasFocus then fraction = 0
    if fraction < 0 then fraction = 0
    if fraction > 1 then fraction = 1
    m.underline.opacity = fraction
    if fraction > 0.5 then m.title.color = m.theme.primaryText else m.title.color = m.theme.secondaryText
end sub
