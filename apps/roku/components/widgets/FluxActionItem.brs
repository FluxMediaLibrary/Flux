sub init()
    m.theme = FluxTheme()
    m.surface = m.top.findNode("surface")
    m.accent = m.top.findNode("accent")
    m.title = m.top.findNode("title")
    m.surface.color = m.theme.surface
    m.accent.color = m.theme.accent
    renderFocus()
end sub

sub layout()
    if m.top.width <= 0 or m.top.height <= 0 then return
    m.surface.width = m.top.width
    m.surface.height = m.top.height
    m.accent.height = m.top.height
    m.title.width = m.top.width - 42
    m.title.height = m.top.height
end sub

sub render()
    if m.top.itemContent = invalid then return
    m.title.text = m.top.itemContent.title
end sub

sub renderFocus()
    fraction = m.top.focusPercent
    if not m.top.listHasFocus then fraction = 0
    if fraction < 0 then fraction = 0
    if fraction > 1 then fraction = 1
    m.surface.opacity = 0.78 * fraction
    m.accent.opacity = fraction
    if fraction > 0.15 then m.title.color = m.theme.primaryText else m.title.color = m.theme.secondaryText
end sub
