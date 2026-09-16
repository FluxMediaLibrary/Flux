sub init()
    m.theme = FluxTheme()
    m.retryActions = m.top.findNode("retryActions")
    for each id in ["stepOne", "stepTwo", "stepThree"]
        m.top.findNode(id).font = FluxFont(26, true)
    end for
    m.top.findNode("brand").font = FluxFont(30, true)
    m.top.findNode("heading").font = FluxFont(56, true)
    m.top.findNode("instructions").font = FluxFont(26, false)
    m.top.findNode("urlLead").font = FluxFont(24, false)
    m.top.findNode("verificationUrl").font = FluxFont(30, true)
    m.top.findNode("codeLead").font = FluxFont(24, false)
    m.top.findNode("codeHeader").font = FluxFont(22, true)
    m.top.findNode("userCode").font = FluxFont(140, true)
    m.top.findNode("expiry").font = FluxFont(22, false)
    m.top.findNode("waiting").font = FluxFont(24, false)
    actions = CreateObject("roSGNode", "ContentNode")
    retry = actions.CreateChild("ContentNode")
    retry.title = "Get a new code"
    retry.addFields({ id: "retry", icon: "", primary: false })
    m.retryActions.content = actions
    m.retryActions.observeField("itemSelected", "onRetry")
    m.retryActions.SetFocus(true)
end sub

sub render()
    name = m.top.serverName
    if name = invalid or name = "" then name = "Flux"
    m.top.findNode("brand").text = name
    if m.top.linkData = invalid then return
    m.top.findNode("instructions").text = "Sign in to " + name + " from any browser to approve this TV. It signs in on its own as soon as you do."
    m.top.findNode("userCode").text = m.top.linkData.userCode
    m.top.findNode("verificationUrl").text = m.top.linkData.verificationUrl
    minutes = 10
    if m.top.linkData.expiresIn <> invalid then minutes = Int(m.top.linkData.expiresIn / 60)
    m.top.findNode("expiry").text = "Code expires in " + minutes.ToStr() + " minutes"
end sub

sub onRetry()
    m.top.retryRequested = true
end sub
