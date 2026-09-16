sub init()
    m.theme = FluxTheme()
    m.brand = m.top.findNode("brand")
    m.tabs = m.top.findNode("tabs")
    m.context = m.top.findNode("context")
    m.brand.font = FluxFont(30, true)
    m.context.font = FluxFont(22, false)
    m.tabs.observeField("itemSelected", "onTabSelected")
    render()
end sub

sub render()
    name = m.top.serverName
    if name = invalid or name = "" then name = "Flux"
    m.brand.text = name
    m.context.text = m.top.contextLabel
    if m.top.contextTone = "warning"
        m.context.color = m.theme.warning
    else if m.top.contextTone = "accent"
        m.context.color = m.theme.accentSoft
    else
        m.context.color = m.theme.mutedText
    end if
end sub

sub renderTabs()
    content = CreateObject("roSGNode", "ContentNode")
    list = m.top.destinations
    if list = invalid then list = []
    for each destination in list
        item = content.CreateChild("ContentNode")
        item.id = destination.id
        item.title = destination.title
    end for
    m.tabs.content = content
    ' Keep the tab strip centred between brand and context label.
    count = content.GetChildCount()
    m.tabs.visible = count > 0
    if count = 0 then return
    width = count * 150 + (count - 1) * 8
    m.tabs.translation = [(1920 - width) / 2, 52]
    m.tabs.numColumns = count
end sub

sub onTabSelected()
    if m.tabs.content = invalid then return
    selected = m.tabs.content.GetChild(m.tabs.itemSelected)
    if selected <> invalid then m.top.destinationSelected = selected.id
end sub

' Called by screens to move focus into the tab strip on the active tab.
sub focusTabs()
    if m.tabs.content = invalid or m.tabs.content.GetChildCount() = 0 then return
    for index = 0 to m.tabs.content.GetChildCount() - 1
        if m.tabs.content.GetChild(index).id = m.top.activeDestination then m.tabs.jumpToItem = index
    end for
    m.tabs.SetFocus(true)
end sub
