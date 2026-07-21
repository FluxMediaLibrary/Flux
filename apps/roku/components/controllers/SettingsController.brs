sub showSettings()
    m.state = "READY"
    m.currentDestination = "settings"
    screen = showScreen("SettingsScreen")
    screen.serverName = m.bootstrap.serverName
    screen.serverUrl = m.registry.serverUrl
    screen.appVersion = AppVersion()
    screen.serverVersion = m.bootstrap.serverVersion
    if m.account <> invalid then screen.accountLabel = m.account.email else screen.accountLabel = "Linked account"
    if m.currentProfile <> invalid then screen.profileLabel = m.currentProfile.name else screen.profileLabel = "Selected profile"
    if m.settingsCategory <> invalid and m.settingsCategory <> ""
        screen.initialCategory = m.settingsCategory
        m.settingsCategory = invalid
    end if
    screen.preferences = m.registry.preferences
    screen.observeField("actionSelected", "onSettingsAction")
end sub

sub onSettingsAction(event as Object)
    action = event.GetData()
    if action = "autoplay"
        m.registry.preferences.autoplayNext = not m.registry.preferences.autoplayNext
        WritePreferences(m.registry.preferences)
        showSettings()
    else if action = "subtitles"
        if m.registry.preferences.subtitleMode = "off" then m.registry.preferences.subtitleMode = "auto" else m.registry.preferences.subtitleMode = "off"
        WritePreferences(m.registry.preferences)
        showSettings()
    else if action = "subtitle_language"
        m.registry.preferences.subtitleLanguage = NextLanguage(m.registry.preferences.subtitleLanguage)
        WritePreferences(m.registry.preferences)
        showSettings()
    else if action = "audio_language"
        m.registry.preferences.audioLanguage = NextLanguage(m.registry.preferences.audioLanguage)
        WritePreferences(m.registry.preferences)
        showSettings()
    else if action = "resume"
        if m.registry.preferences.resumeBehavior = "auto" then m.registry.preferences.resumeBehavior = "restart" else m.registry.preferences.resumeBehavior = "auto"
        WritePreferences(m.registry.preferences)
        showSettings()
    else if action = "quality"
        if m.registry.preferences.maxBitrate <= 8000000
            m.registry.preferences.maxBitrate = 20000000
        else if m.registry.preferences.maxBitrate <= 20000000
            m.registry.preferences.maxBitrate = 40000000
        else
            m.registry.preferences.maxBitrate = 8000000
        end if
        WritePreferences(m.registry.preferences)
        showSettings()
    else if action = "compatibility"
        beginStartup()
    else if action = "release_notes"
        notes = "No release notes were provided by this server."
        if m.versionData <> invalid and m.versionData.releaseNotes <> invalid and m.versionData.releaseNotes.Count() > 0
            notes = ""
            for each note in m.versionData.releaseNotes
                if notes <> "" then notes = notes + Chr(10)
                notes = notes + "• " + note
            end for
        end if
        showInfoMessage("Release notes", notes, "showSettings")
    else if action = "reset_cache"
        m.cachedHome = invalid
        m.searchResults = invalid
        m.searchQuery = ""
        m.detailStack = []
        m.recentSearches = []
        ClearRecentSearches()
        ClearLocalLogs()
        DeleteFile("tmp:/flux-home.json")
        showInfoMessage("Cache cleared", "Flux will fetch fresh home, search, and artwork data on the next request.", "showSettings")
    else if action = "diagnostics_toggle"
        m.registry.preferences.diagnostics = not m.registry.preferences.diagnostics
        WritePreferences(m.registry.preferences)
        showSettings()
    else if action = "diagnostics"
        screen = showScreen("MessageScreen")
        screen.title = "Diagnostics"
        screen.message = "Server: " + m.bootstrap.serverVersion + "  ·  Roku app: " + AppVersion() + "  ·  Device: " + CreateObject("roDeviceInfo").GetModel() + Chr(10) + Chr(10) + ReadLocalLogText(6)
        screen.actions = ["Back"]
        screen.observeField("actionSelected", "showSettings")
    else if action = "clear_diagnostics"
        ClearLocalLogs()
        showInfoMessage("Diagnostics cleared", "The local Roku diagnostic log has been cleared.", "showSettings")
    else if action = "profiles"
        loadProfiles()
    else if action = "retry"
        loadHome()
    else if action = "logout" or action = "server" or action = "remove_server"
        m.pendingSettingsAction = action
        runRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.logout), method: "POST", token: m.registry.accessToken, body: { refreshToken: m.registry.refreshToken } }, "onLogoutComplete", "onLogoutComplete")
    end if
end sub

function NextLanguage(current as String) as String
    languages = ["en", "es", "fr", "de", "ja"]
    for index = 0 to languages.Count() - 1
        if languages[index] = current then return languages[(index + 1) mod languages.Count()]
    end for
    return "en"
end function

sub showInfoMessage(title as String, message as String, callbackName as String)
    screen = showScreen("MessageScreen")
    screen.title = title
    screen.message = message
    screen.actions = ["Back"]
    screen.observeField("actionSelected", callbackName)
end sub

