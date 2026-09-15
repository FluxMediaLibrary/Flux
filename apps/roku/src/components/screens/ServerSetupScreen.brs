sub init()
    m.actions = m.top.findNode("actions")
    m.errorLabel = m.top.findNode("errorLabel")
    content = CreateObject("roSGNode", "ContentNode")
    for each label in ["Enter server address", "How to find my server"]
        item = content.CreateChild("ContentNode")
        item.title = label
    end for
    m.actions.content = content
    m.actions.observeField("itemSelected", "onActionSelected")
    m.actions.SetFocus(true)
end sub

sub onActionSelected()
    if m.actions.itemSelected = 0
        dialog = CreateObject("roSGNode", "KeyboardDialog")
        dialog.title = "Flux server address"
        dialog.text = "https://"
        dialog.buttons = ["Connect", "Cancel"]
        dialog.observeField("buttonSelected", "onKeyboardButton")
        m.top.GetScene().dialog = dialog
    else
        m.errorLabel.text = "Use the public address configured by your Flux administrator, or an HTTP LAN address such as http://192.168.1.20:6948."
    end if
end sub

sub onKeyboardButton(event as Object)
    dialog = event.GetRoSGNode()
    if event.GetData() = 0
        normalized = NormalizeServerUrl(dialog.text)
        if normalized = ""
            m.errorLabel.text = "Enter a complete HTTP or HTTPS server address."
        else
            m.top.serverSubmitted = normalized
        end if
    end if
    dialog.close = true
    m.actions.SetFocus(true)
end sub
