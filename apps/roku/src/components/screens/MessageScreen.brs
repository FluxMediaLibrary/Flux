sub init()
    m.theme = FluxTheme()
    m.titleLabel = m.top.findNode("titleLabel")
    m.messageLabel = m.top.findNode("messageLabel")
    m.actionsList = m.top.findNode("actionsList")
    m.titleLabel.font = FluxFont(46, true)
    m.messageLabel.font = FluxFont(26, false)
    m.actionsList.observeField("itemSelected", "onSelected")
end sub

sub render()
    m.titleLabel.text = m.top.title
    m.messageLabel.text = m.top.message
end sub

sub renderActions()
    content = CreateObject("roSGNode", "ContentNode")
    index = 0
    for each label in m.top.actions
        child = content.CreateChild("ContentNode")
        child.title = label
        child.addFields({ id: index.ToStr(), icon: "", primary: index = 0 })
        index = index + 1
    end for
    ' Lay the buttons out as a row when they fit, so a two-button dialog
    ' reads like a dialog rather than a menu.
    count = content.GetChildCount()
    if count < 1 then count = 1
    if count <= 3
        width = Int((880 - (count - 1) * 12) / count)
        m.actionsList.itemSize = [width, 64]
        m.actionsList.numColumns = count
        m.actionsList.numRows = 1
    else
        m.actionsList.itemSize = [880, 64]
        m.actionsList.numColumns = 1
        m.actionsList.numRows = count
    end if
    m.actionsList.content = content
    m.actionsList.SetFocus(true)
end sub

sub onSelected()
    m.top.actionSelected = m.actionsList.itemSelected
end sub
