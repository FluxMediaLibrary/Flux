sub init()
    m.categories = m.top.findNode("categories")
    m.actions = m.top.findNode("actions")
    m.sectionTitle = m.top.findNode("sectionTitle")
    m.currentCategory = "account"
    m.categories.observeField("itemSelected", "onCategorySelected")
    m.actions.observeField("itemSelected", "onSelected")
    renderCategories()
end sub

sub renderCategories()
    content = CreateObject("roSGNode", "ContentNode")
    for each category in settingsCategories()
        item = content.CreateChild("ContentNode")
        item.id = category.id
        item.title = category.title
    end for
    m.categories.content = content
    renderSectionTitle()
end sub

function settingsCategories() as Object
    return [
        { id: "account", title: "Account" },
        { id: "server", title: "Server" },
        { id: "playback", title: "Playback" },
        { id: "appearance", title: "Appearance" },
        { id: "developer", title: "Developer" },
        { id: "debug", title: "Debug" },
        { id: "about", title: "About" },
        { id: "advanced", title: "Advanced" }
    ]
end function

sub renderSectionTitle()
    for each category in settingsCategories()
        if category.id = m.currentCategory
            m.sectionTitle.text = UCase(category.title)
            return
        end if
    end for
    m.sectionTitle.text = "SETTINGS"
end sub

sub applyInitialCategory()
    if m.top.initialCategory = "" then return
    categories = settingsCategories()
    found = false
    for index = 0 to categories.Count() - 1
        if categories[index].id = m.top.initialCategory
            m.currentCategory = categories[index].id
            m.categories.jumpToItem = index
            found = true
            exit for
        end if
    end for
    if not found then return
    renderSectionTitle()
    renderActions()
end sub

sub onCategorySelected()
    if m.categories.content = invalid then return
    category = m.categories.content.GetChild(m.categories.itemSelected)
    if category = invalid then return
    m.currentCategory = category.id
    renderSectionTitle()
    renderActions()
    if m.actions.content <> invalid and m.actions.content.GetChildCount() > 0 then m.actions.SetFocus(true)
end sub

sub renderActions()
    preferences = m.top.preferences
    if preferences = invalid then return
    autoplay = "Off"
    if preferences.autoplayNext then autoplay = "On"
    captions = "Automatic"
    if preferences.subtitleMode = "off" then captions = "Off"
    bitrate = Int(preferences.maxBitrate / 1000000).ToStr() + " Mbps"
    diagnostics = "Off"
    if preferences.diagnostics then diagnostics = "On"

    allActions = [
        { category: "account", id: "profiles", title: "Switch profile" },
        { category: "account", id: "logout", title: "Sign out this Roku" },
        { category: "server", id: "compatibility", title: "Check server compatibility" },
        { category: "server", id: "server", title: "Reconnect to Flux server" },
        { category: "server", id: "remove_server", title: "Reset server connection" },
        { category: "playback", id: "autoplay", title: "Autoplay next episode: " + autoplay },
        { category: "playback", id: "resume", title: "Resume behavior: " + preferences.resumeBehavior },
        { category: "playback", id: "quality", title: "Maximum bitrate: " + bitrate },
        { category: "appearance", id: "subtitles", title: "Captions: " + captions },
        { category: "appearance", id: "subtitle_language", title: "Preferred subtitle language: " + preferences.subtitleLanguage },
        { category: "appearance", id: "audio_language", title: "Preferred audio language: " + preferences.audioLanguage },
        { category: "developer", id: "diagnostics_toggle", title: "Local diagnostics: " + diagnostics },
        { category: "debug", id: "diagnostics", title: "View local diagnostics" },
        { category: "debug", id: "clear_diagnostics", title: "Clear local diagnostic log" },
        { category: "about", id: "release_notes", title: "View release notes" },
        { category: "advanced", id: "reset_cache", title: "Reset cached data" }
    ]
    content = CreateObject("roSGNode", "ContentNode")
    for each action in allActions
        if action.category = m.currentCategory
            item = content.CreateChild("ContentNode")
            item.id = action.id
            item.title = action.title
        end if
    end for
    m.actions.content = content
end sub

sub render()
    m.top.findNode("server").text = m.top.serverName + " | Server " + m.top.serverVersion + Chr(10) + m.top.serverUrl + " | Connected"
    m.top.findNode("identity").text = m.top.accountLabel + " | Profile: " + m.top.profileLabel
    m.top.findNode("version").text = "Flux for Roku " + m.top.appVersion + " | Build " + CreateObject("roAppInfo").GetValue("build_version")
end sub

sub onSelected()
    if m.actions.content = invalid then return
    item = m.actions.content.GetChild(m.actions.itemSelected)
    if item <> invalid then m.top.actionSelected = item.id
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "right" and m.categories.HasFocus() and m.actions.content <> invalid and m.actions.content.GetChildCount() > 0
        m.actions.SetFocus(true)
        return true
    else if key = "left" and m.actions.HasFocus()
        m.categories.SetFocus(true)
        return true
    end if
    return false
end function
