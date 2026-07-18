sub init()
    m.instructions = m.top.findNode("instructions")
    m.userCode = m.top.findNode("userCode")
    m.verificationUrl = m.top.findNode("verificationUrl")
    m.retryButton = m.top.findNode("retryButton")
    m.retryButton.observeField("buttonSelected", "onRetry")
    m.retryButton.SetFocus(true)
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
