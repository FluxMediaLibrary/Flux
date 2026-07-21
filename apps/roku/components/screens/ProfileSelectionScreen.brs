sub init()
    m.profileList = m.top.findNode("profileList")
    m.profileList.observeField("itemSelected", "onSelected")
end sub

sub renderProfiles()
    content = CreateObject("roSGNode", "ContentNode")
    profiles = m.top.profiles
    if profiles = invalid then profiles = []
    for each profile in profiles
        if not IsAssociativeArray(profile) then continue for
        if profile.id = invalid then continue for
        item = content.CreateChild("ContentNode")
        item.id = profile.id
        profileName = profile.name
        if profileName = invalid or profileName = "" then profileName = "Profile"
        item.title = profileName
        if profile.avatarUrl <> invalid then item.hdPosterUrl = profile.avatarUrl
    end for
    m.profileList.content = content
    if content.GetChildCount() > 0 then m.profileList.SetFocus(true)
end sub

sub onSelected()
    if m.profileList.content = invalid then return
    item = m.profileList.content.GetChild(m.profileList.itemSelected)
    if item = invalid then return
    m.top.profileSelected = item.id
end sub
