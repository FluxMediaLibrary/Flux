' main.brs
' Application entry point — creates the SceneGraph scene and runs the event loop.

sub Main()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    
    scene = screen.CreateScene("MainScene")
    screen.Show()
    
    while true
        msg = wait(0, port)
        msgType = type(msg)
        
        if msgType = "roSGScreenEvent"
            if msg.IsScreenClosed() then exit while
        end if
    end while
end sub
