sub init()
    m.instructions = m.top.findNode("instructions")
    m.userCode = m.top.findNode("userCode")
    m.verificationUrl = m.top.findNode("verificationUrl")
    m.retryActions = m.top.findNode("retryActions")
    actions = CreateObject("roSGNode", "ContentNode")
    retry = actions.CreateChild("ContentNode")
    retry.title = "Get a new code"
    retry.addFields({ id: "retry" })
    m.retryActions.content = actions
    m.retryActions.observeField("itemSelected", "onRetry")
    m.retryActions.SetFocus(true)
end sub

sub render()
    if m.top.linkData = invalid then return
    m.instructions.text = "On a phone or computer, open the address below and enter this code to link " + m.top.serverName + "."
    m.userCode.text = m.top.linkData.userCode
    m.verificationUrl.text = m.top.linkData.verificationUrl
end sub

sub onRetry()
    m.top.retryRequested = true
end sub
