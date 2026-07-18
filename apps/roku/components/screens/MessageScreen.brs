sub init()
    m.actionsList.observeField("itemSelected", "onSelected")
end sub

sub render()
    m.titleLabel.text = m.top.title
    m.messageLabel.text = m.top.message
end sub

sub renderActions()
    content = CreateObject("roSGNode", "ContentNode")
    for each label in m.top.actions
        child = content.CreateChild("ContentNode")
        child.title = label
    end for
    m.actionsList.content = content
    m.actionsList.SetFocus(true)
end sub

sub onSelected()
    m.top.actionSelected = m.actionsList.itemSelected
end sub

