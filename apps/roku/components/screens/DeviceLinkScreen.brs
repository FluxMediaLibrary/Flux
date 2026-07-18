sub init()
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

