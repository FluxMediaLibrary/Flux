' LoginScreen.brs
' Email/password login using roKeyboardScreen for text entry.

sub init()
    m.email = ""
    m.password = ""
    m.focusIndex = 0 ' 0=email, 1=password, 2=login button
    
    m.emailField = m.top.FindNode("emailField")
    m.emailFieldBg = m.top.FindNode("emailFieldBg")
    m.passwordField = m.top.FindNode("passwordField")
    m.passwordFieldBg = m.top.FindNode("passwordFieldBg")
    m.loginButton = m.top.FindNode("loginButton")
    m.spinner = m.top.FindNode("spinner")
    m.errorLabel = m.top.FindNode("errorLabel")
    
    ' Task for async API calls
    m.loginTask = invalid
    
    m.refreshVisuals()
end sub

sub refreshVisuals()
    ' Email field
    eColor = "#1a1a1a"
    eTextColor = "#555555"
    if m.focusIndex = 0
        eColor = "#0d3320"
        eTextColor = "#00cc66"
    end if
    if m.email <> ""
        eTextColor = "#ffffff"
    end if
    m.emailFieldBg.color = eColor
    m.emailField.color = eTextColor
    if m.email <> ""
        m.emailField.text = m.email
    else
        m.emailField.text = "Enter your email..."
    end if
    
    ' Password field
    pColor = "#1a1a1a"
    pTextColor = "#555555"
    if m.focusIndex = 1
        pColor = "#0d3320"
        pTextColor = "#00cc66"
    end if
    if m.password <> ""
        pTextColor = "#ffffff"
    end if
    m.passwordFieldBg.color = pColor
    m.passwordField.color = pTextColor
    if m.password <> ""
        m.passwordField.text = String(m.password.Len(), "*")
    else
        m.passwordField.text = "Enter your password..."
    end if
    
    ' Login button focus
    if m.focusIndex = 2
        m.loginButton.SetFocus(true)
    end if
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if NOT press then return false
    
    if key = "down"
        m.focusIndex = (m.focusIndex + 1) mod 3
        m.refreshVisuals()
        return true
    else if key = "up"
        m.focusIndex = (m.focusIndex + 2) mod 3
        m.refreshVisuals()
        return true
    else if key = "OK"
        if m.focusIndex = 0
            m.showTextInput("Enter your email address", m.email, "email")
            return true
        else if m.focusIndex = 1
            m.showTextInput("Enter your password", "", "password")
            return true
        else if m.focusIndex = 2
            m.doLogin()
            return true
        end if
    else if key = "back"
        m.top.close = true
        return true
    end if
    
    return false
end function

sub showTextInput(title as string, defaultText as string, fieldId as string)
    ' Use roKeyboardScreen for text input (works reliably on all Roku devices)
    keyboard = CreateObject("roKeyboardScreen")
    port = CreateObject("roMessagePort")
    keyboard.SetMessagePort(port)
    keyboard.SetTitle(title)
    keyboard.SetText(defaultText)
    keyboard.SetDisplayText(defaultText)
    if fieldId = "password"
        keyboard.SetSecureText(true)
    end if
    keyboard.Show()
    
    while true
        msg = wait(0, port)
        if type(msg) = "roKeyboardScreenEvent"
            if msg.IsScreenClosed()
                exit while
            else if msg.IsButtonPressed()
                text = keyboard.GetText()
                if fieldId = "email"
                    m.email = text
                else
                    m.password = text
                end if
                m.refreshVisuals()
                exit while
            end if
        end if
    end while
    
    m.top.SetFocus(true)
end sub

sub doLogin()
    if m.email = "" or m.password = ""
        m.errorLabel.text = "Enter your email and password."
        m.errorLabel.visible = true
        return
    end if
    
    m.spinner.visible = true
    m.errorLabel.visible = false
    
    api = m.top.api
    response = api.login(m.email, m.password)
    
    m.spinner.visible = false
    
    if response.code = 200 or response.code = 201
        json = response.json
        if json <> invalid and json.token <> invalid
            baseToken = json.token
            nav = { action: "login_success", token: json.token, baseToken: baseToken }
            m.top.navigate = nav
        else
            m.errorLabel.text = "Invalid response from server."
            m.errorLabel.visible = true
        end if
    else
        msg = "Login failed. Check your credentials."
        if response.json <> invalid and response.json.message <> invalid
            msg = response.json.message
        end if
        m.errorLabel.text = msg
        m.errorLabel.visible = true
    end if
end sub
