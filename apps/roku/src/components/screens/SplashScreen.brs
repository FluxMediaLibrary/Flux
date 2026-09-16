sub init()
    m.top.findNode("wordmark").font = FluxFont(48, true)
    m.top.findNode("tagline").font = FluxFont(24, false)
    m.top.findNode("barAnimation").control = "start"
    m.timer = CreateObject("roSGNode", "Timer")
    m.timer.repeat = false
    m.timer.duration = 10
    m.timer.observeField("fire", "onSplashTimeout")
    m.timer.control = "start"
end sub

sub onSplashTimeout(event as Object)
    m.timer.control = "stop"
    m.top.findNode("tagline").text = "Still connecting… check that the server is reachable from this network"
end sub
