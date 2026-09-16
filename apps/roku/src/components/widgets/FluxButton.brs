sub init()
    m.theme = FluxTheme()
    m.fill = m.top.findNode("fill")
    m.icon = m.top.findNode("icon")
    m.title = m.top.findNode("title")
    m.title.font = FluxFont(26, true)
    m.primary = false
    renderFocus()
end sub

sub layout()
    w = m.top.width
    h = m.top.height
    if w <= 0 or h <= 0 then return
    m.fill.width = w
    m.fill.height = h
    m.title.height = h
    m.icon.translation = [28, (h - 28) / 2]
    if m.icon.visible
        m.title.translation = [44, 0]
        m.title.width = w - 60
    else
        m.title.translation = [0, 0]
        m.title.width = w
    end if
    m.top.scaleRotateCenter = [w / 2, h / 2]
end sub

sub render()
    content = m.top.itemContent
    if content = invalid then return
    m.title.text = content.title
    m.primary = content.HasField("primary") and content.primary = true
    hasIcon = content.HasField("icon") and content.icon <> invalid and content.icon <> ""
    m.icon.visible = hasIcon
    if hasIcon then m.icon.uri = content.icon
    layout()
    renderFocus()
end sub

sub renderFocus()
    fraction = m.top.focusPercent
    if not m.top.listHasFocus then fraction = 0
    if fraction < 0 then fraction = 0
    if fraction > 1 then fraction = 1
    if fraction > 0.5
        m.fill.blendColor = m.theme.accent
        m.fill.opacity = 1
        m.title.color = m.theme.onAccent
        m.icon.blendColor = m.theme.onAccent
        m.top.scale = [1.04, 1.04]
    else if m.primary
        m.fill.blendColor = m.theme.primaryText
        m.fill.opacity = 0.92
        m.title.color = m.theme.canvas
        m.icon.blendColor = m.theme.canvas
        m.top.scale = [1.0, 1.0]
    else
        m.fill.blendColor = m.theme.raised
        m.fill.opacity = 1
        m.title.color = m.theme.primaryText
        m.icon.blendColor = m.theme.primaryText
        m.top.scale = [1.0, 1.0]
    end if
end sub
