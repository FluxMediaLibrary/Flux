sub init()
    m.theme = FluxTheme()
    m.fill = m.top.findNode("fill")
    m.title = m.top.findNode("title")
    m.detail = m.top.findNode("detail")
    m.value = m.top.findNode("value")
    m.chevron = m.top.findNode("chevron")
    m.title.font = FluxFont(28, true)
    m.detail.font = FluxFont(22, false)
    m.value.font = FluxFont(26, false)
end sub

sub layout()
    w = m.top.width
    h = m.top.height
    if w <= 0 or h <= 0 then return
    m.fill.width = w
    m.fill.height = h
    if m.detail.visible
        m.title.translation = [28, 14]
        m.title.height = 36
        m.detail.translation = [28, 50]
        m.detail.height = 30
    else
        m.title.translation = [28, 0]
        m.title.height = h
    end if
    m.title.width = w * 0.6
    m.detail.width = w * 0.6
    m.value.translation = [w * 0.55, 0]
    m.value.width = w * 0.45 - 70
    m.value.height = h
    m.chevron.translation = [w - 52, (h - 24) / 2]
end sub

sub render()
    content = m.top.itemContent
    if content = invalid then return
    m.title.text = content.title
    hasDetail = content.HasField("detail") and content.detail <> invalid and content.detail <> ""
    m.detail.visible = hasDetail
    if hasDetail then m.detail.text = content.detail
    hasValue = content.HasField("value") and content.value <> invalid and content.value <> ""
    if hasValue then m.value.text = content.value else m.value.text = ""
    m.chevron.visible = not hasValue
    layout()
end sub

sub renderFocus()
    fraction = m.top.focusPercent
    if not m.top.listHasFocus then fraction = 0
    if fraction < 0 then fraction = 0
    if fraction > 1 then fraction = 1
    m.fill.opacity = fraction
    if fraction > 0.5
        m.value.color = m.theme.primaryText
        m.chevron.blendColor = m.theme.primaryText
    else
        m.value.color = m.theme.secondaryText
        m.chevron.blendColor = m.theme.mutedText
    end if
end sub
