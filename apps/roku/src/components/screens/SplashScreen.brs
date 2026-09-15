sub init()
    m.top.observeField("focusedChild", "onFocus")
    m.timer = CreateObject("roSGNode", "Timer")
    m.timer.repeat = false
    m.timer.duration = 10
    m.timer.observeField("fire", "onSplashTimeout")
    m.timer.control = "start"
end sub

sub onFocus()
    ' If focus lands here, the scene is alive
end sub

sub onSplashTimeout(event as Object)
    m.timer.control = "stop"
    ' Signal parent that splash timed out
    m.top.findNode("tagline").text = "Taking too long? Check your server connection."
end sub
