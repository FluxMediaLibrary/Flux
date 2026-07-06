' ProfileSelectScreen.brs
' Displays profile list and handles profile activation.

sub init()
    m.profileList = m.top.FindNode("profileList")
    m.loadingLabel = m.top.FindNode("loadingLabel")
    m.profileList.visible = false
    
    m.profiles = []
    
    m.profileList.ObserveField("itemSelected", "onProfileSelected")
    
    m.loadProfiles()
end sub

sub loadProfiles()
    api = m.top.api
    ' Use base token (account token, no activeProfileId)
    baseToken = api.getBaseToken()
    response = api.request("/profiles", "GET", invalid, false, baseToken)
    
    m.loadingLabel.visible = false
    
    if response.code = 200 and response.json <> invalid
        m.profiles = response.json
        content = CreateObject("roSGNode", "ContentNode")
        for each p in m.profiles
            item = content.CreateChild("ContentNode")
            item.title = p.name
        end for
        m.profileList.content = content
        m.profileList.visible = true
        m.profileList.SetFocus(true)
    else
        m.loadingLabel.text = "Failed to load profiles. Press Back."
    end if
end sub

sub onProfileSelected(event as object)
    index = event.GetData()
    if index < 0 or index >= m.profiles.Count() then return
    
    profile = m.profiles[index]
    api = m.top.api
    baseToken = api.getBaseToken()
    
    response = api.request("/profiles/" + api.urlEncode(profile.id) + "/activate", "POST", invalid, false, baseToken)
    
    if response.code = 200 and response.json <> invalid and response.json.token <> invalid
        nav = { action: "profile_activated", token: response.json.token }
        m.top.navigate = nav
    end if
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if NOT press then return false
    if key = "back"
        m.top.close = true
        return true
    end if
    return false
end function
