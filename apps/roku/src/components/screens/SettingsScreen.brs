sub init()
    m.theme = FluxTheme()
    m.categories = m.top.findNode("categories")
    m.actions = m.top.findNode("actions")
    m.sectionTitle = m.top.findNode("sectionTitle")
    m.sectionHint = m.top.findNode("sectionHint")
    m.currentCategory = "playback"
    m.categories.observeField("itemSelected", "onCategorySelected")
    m.categories.observeField("itemFocused", "onCategoryFocused")
    m.actions.observeField("itemSelected", "onSelected")
    m.top.findNode("titleLabel").font = FluxFont(52, true)
    m.top.findNode("identity").font = FluxFont(24, false)
    m.sectionTitle.font = FluxFont(32, true)
    m.sectionHint.font = FluxFont(22, false)
    m.top.findNode("topbar").contextLabel = "Back returns home"
    renderCategories()
end sub

function settingsCategories() as Object
    return [
        { id: "playback", title: "Playback", hint: "Autoplay, resume and stream quality" },
        { id: "appearance", title: "Audio & captions", hint: "Default languages and caption behaviour" },
        { id: "account", title: "Account", hint: "Profile and sign-out" },
        { id: "server", title: "Server", hint: "Connection to your Flux server" },
        { id: "about", title: "About", hint: "Versions and release notes" },
        { id: "advanced", title: "Advanced", hint: "Diagnostics and cached data" }
    ]
end function

sub renderCategories()
    content = CreateObject("roSGNode", "ContentNode")
    for each category in settingsCategories()
        item = content.CreateChild("ContentNode")
        item.id = category.id
        item.title = category.title
        item.addFields({ value: "", detail: "" })
    end for
    m.categories.content = content
    renderSectionTitle()
end sub

sub renderSectionTitle()
    for each category in settingsCategories()
        if category.id = m.currentCategory
            m.sectionTitle.text = category.title
            m.sectionHint.text = category.hint
            return
        end if
    end for
    m.sectionTitle.text = "Settings"
    m.sectionHint.text = ""
end sub

sub applyInitialCategory()
    if m.top.initialCategory = "" then return
    categories = settingsCategories()
    for index = 0 to categories.Count() - 1
        if categories[index].id = m.top.initialCategory
            m.currentCategory = categories[index].id
            m.categories.jumpToItem = index
            renderSectionTitle()
            renderActions()
            return
        end if
    end for
end sub

sub onCategoryFocused()
    if m.categories.content = invalid then return
    category = m.categories.content.GetChild(m.categories.itemFocused)
    if category = invalid or category.id = m.currentCategory then return
    m.currentCategory = category.id
    renderSectionTitle()
    renderActions()
end sub

sub onCategorySelected()
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
    resume = "Ask to resume"
    if preferences.resumeBehavior = "restart" then resume = "Always start over" else if preferences.resumeBehavior = "auto" then resume = "Resume automatically"
    diagnostics = "Off"
    if preferences.diagnostics then diagnostics = "On"

    serverVersion = m.top.serverVersion
    if serverVersion = invalid or serverVersion = "" then serverVersion = "unknown"

    allActions = [
        { category: "playback", id: "autoplay", title: "Autoplay next episode", value: autoplay },
        { category: "playback", id: "resume", title: "When a title has progress", value: resume },
        { category: "playback", id: "quality", title: "Maximum stream quality", value: bitrate },
        { category: "appearance", id: "subtitles", title: "Captions", value: captions },
        { category: "appearance", id: "subtitle_language", title: "Preferred caption language", value: UCase(preferences.subtitleLanguage) },
        { category: "appearance", id: "audio_language", title: "Preferred audio language", value: UCase(preferences.audioLanguage) },
        { category: "account", id: "profiles", title: "Switch profile", detail: "Current: " + m.top.profileLabel, value: "" },
        { category: "account", id: "logout", title: "Sign out of this TV", detail: m.top.accountLabel, value: "" },
        { category: "server", id: "compatibility", title: "Check server compatibility", detail: m.top.serverUrl, value: "" },
        { category: "server", id: "server", title: "Reconnect to Flux", detail: "Sign out and enter the server address again", value: "" },
        { category: "server", id: "remove_server", title: "Forget this server", detail: "Removes the saved address and account from this TV", value: "" },
        { category: "about", id: "release_notes", title: "Release notes", detail: "Flux for Roku " + m.top.appVersion + "   ·   Server " + serverVersion, value: "" },
        { category: "advanced", id: "diagnostics_toggle", title: "Keep a local diagnostics log", value: diagnostics },
        { category: "advanced", id: "diagnostics", title: "View diagnostics", value: "" },
        { category: "advanced", id: "clear_diagnostics", title: "Clear diagnostics log", value: "" },
        { category: "advanced", id: "reset_cache", title: "Reset cached data", detail: "Clears cached rows, searches and artwork hints", value: "" }
    ]
    content = CreateObject("roSGNode", "ContentNode")
    for each action in allActions
        if action.category = m.currentCategory
            item = content.CreateChild("ContentNode")
            item.id = action.id
            item.title = action.title
            detail = ""
            if action.detail <> invalid then detail = action.detail
            item.addFields({ value: action.value, detail: detail })
        end if
    end for
    m.actions.content = content
end sub

sub render()
    m.top.findNode("identity").text = m.top.accountLabel + "   ·   " + m.top.profileLabel + "   ·   " + m.top.serverName
    renderActions()
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
