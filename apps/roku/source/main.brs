sub Main(args as Dynamic)
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)

    scene = screen.CreateScene("AppScene")
    scene.launchArgs = args
    screen.Show()
    scene.SetFocus(true)

    while true
        message = Wait(0, port)
        if Type(message) = "roSGScreenEvent" and message.IsScreenClosed() then exit while
    end while
end sub

