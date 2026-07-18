sub init()
    m.profileList = m.top.findNode("profileList")
    m.profileList.observeField("itemSelected", "onSelected")
end sub

sub renderProfiles()
    content = CreateObject("roSGNode", "ContentNode")
    for each profile in m.top.profiles
        item = content.CreateChild("ContentNode")
        item.id = profile.id
        item.title = profile.name
        if profile.avatarUrl <> invalid then item.hdPosterUrl = profile.avatarUrl
    end for
    m.profileList.content = content
    m.profileList.SetFocus(true)
end sub

sub onSelected()
    item = m.profileList.content.GetChild(m.profileList.itemSelected)
    m.top.profileSelected = item.id
end sub
