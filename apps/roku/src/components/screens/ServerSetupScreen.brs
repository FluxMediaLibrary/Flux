sub init()
    m.theme = FluxTheme()
    m.actions = m.top.findNode("actions")
    m.errorLabel = m.top.findNode("errorLabel")
    m.top.findNode("heading").font = FluxFont(54, true)
    m.top.findNode("lead").font = FluxFont(26, false)
    m.top.findNode("tipHeader").font = FluxFont(22, true)
    m.top.findNode("tipBody").font = FluxFont(24, false)
    m.errorLabel.font = FluxFont(24, false)
    content = CreateObject("roSGNode", "ContentNode")
    enter = content.CreateChild("ContentNode")
    enter.title = "Enter server address"
    enter.addFields({ id: "enter", icon: "", primary: true })
    m.actions.content = content
    m.actions.observeField("itemSelected", "onActionSelected")
    m.actions.SetFocus(true)
end sub

sub onActionSelected()
    dialog = CreateObject("roSGNode", "KeyboardDialog")
    dialog.title = "Flux server address"
    dialog.text = "https://"
    dialog.buttons = ["Connect", "Cancel"]
    dialog.observeField("buttonSelected", "onKeyboardButton")
    m.top.GetScene().dialog = dialog
end sub

sub onKeyboardButton(event as Object)
    dialog = event.GetRoSGNode()
    if event.GetData() = 0
        normalized = NormalizeServerUrl(dialog.text)
        if normalized = ""
            m.errorLabel.text = "Enter a complete address starting with http:// or https://, without a path."
        else
            m.errorLabel.text = ""
            m.top.serverSubmitted = normalized
        end if
    end if
    dialog.close = true
    m.actions.SetFocus(true)
end sub
