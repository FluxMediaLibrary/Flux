sub init()
    m.actions = m.top.findNode("actions")
    m.actions.observeField("itemSelected", "onSelected")
end sub

sub renderActions()
    preferences = m.top.preferences
    if preferences = invalid then return
    content = CreateObject("roSGNode", "ContentNode")
    autoplay = "Off"
    if preferences.autoplayNext then autoplay = "On"
    captions = "Automatic"
    if preferences.subtitleMode = "off" then captions = "Off"
    bitrate = Int(preferences.maxBitrate / 1000000).ToStr() + " Mbps"
    diagnostics = "Off"
    if preferences.diagnostics then diagnostics = "On"
    for each action in [{ id: "autoplay", title: "Autoplay next episode: " + autoplay }, { id: "subtitles", title: "Captions: " + captions }, { id: "subtitle_language", title: "Preferred subtitle language: " + preferences.subtitleLanguage }, { id: "audio_language", title: "Preferred audio language: " + preferences.audioLanguage }, { id: "resume", title: "Resume behavior: " + preferences.resumeBehavior }, { id: "quality", title: "Maximum bitrate: " + bitrate }, { id: "profiles", title: "Switch profile" }, { id: "compatibility", title: "Check server compatibility" }, { id: "release_notes", title: "View release notes" }, { id: "reset_cache", title: "Reset cached data" }, { id: "diagnostics_toggle", title: "Local diagnostics: " + diagnostics }, { id: "diagnostics", title: "View diagnostics" }, { id: "logout", title: "Sign out this Roku" }, { id: "server", title: "Change server" }, { id: "remove_server", title: "Remove server" }]
        item = content.CreateChild("ContentNode")
        item.id = action.id
        item.title = action.title
    end for
    m.actions.content = content
    m.actions.SetFocus(true)
end sub

sub render()
    m.top.findNode("server").text = m.top.serverName + " · Server " + m.top.serverVersion + Chr(10) + m.top.serverUrl + " · Connected"
    m.top.findNode("identity").text = m.top.accountLabel + " · Profile: " + m.top.profileLabel
    m.top.findNode("version").text = "Flux for Roku " + m.top.appVersion + " · Build " + CreateObject("roAppInfo").GetValue("build_version")
end sub

sub onSelected()
    item = m.actions.content.GetChild(m.actions.itemSelected)
    if item <> invalid then m.top.actionSelected = item.id
end sub
