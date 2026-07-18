function ReadRegistryState() as Object
    section = CreateObject("roRegistrySection", "flux")
    state = {
        serverUrl: section.Read("server_url")
        serverId: section.Read("server_id")
        serverName: section.Read("server_name")
        accessToken: section.Read("access_token")
        refreshToken: section.Read("refresh_token")
        profileId: section.Read("profile_id")
        deviceId: section.Read("device_id")
        preferences: DeserializePreferences(section.Read("preferences"))
    }
    if state.serverUrl = "" then state.serverUrl = DefaultServerUrl()
    if state.deviceId = ""
        state.deviceId = CreateObject("roDeviceInfo").GetRandomUUID()
        section.Write("device_id", state.deviceId)
        section.Flush()
    end if
    return state
end function

sub WriteServerState(server as Object)
    section = CreateObject("roRegistrySection", "flux")
    section.Write("server_url", server.url)
    section.Write("server_id", server.id)
    section.Write("server_name", server.name)
    section.Write("last_connection", CreateObject("roDateTime").ToISOString())
    section.Flush()
end sub

sub WriteAuthState(accessToken as String, refreshToken as String)
    section = CreateObject("roRegistrySection", "flux")
    section.Write("access_token", accessToken)
    section.Write("refresh_token", refreshToken)
    section.Flush()
end sub

sub WriteProfileId(profileId as String)
    section = CreateObject("roRegistrySection", "flux")
    section.Write("profile_id", profileId)
    section.Flush()
end sub

sub WritePreferences(preferences as Object)
    section = CreateObject("roRegistrySection", "flux")
    section.Write("preferences", SerializePreferences(preferences))
    section.Flush()
end sub

sub ClearAuthentication()
    section = CreateObject("roRegistrySection", "flux")
    section.Delete("access_token")
    section.Delete("refresh_token")
    section.Delete("profile_id")
    section.Flush()
end sub

sub ClearServer()
    section = CreateObject("roRegistrySection", "flux")
    deviceId = section.Read("device_id")
    preferences = section.Read("preferences")
    section.Delete("server_url")
    section.Delete("server_id")
    section.Delete("server_name")
    section.Delete("access_token")
    section.Delete("refresh_token")
    section.Delete("profile_id")
    section.Delete("last_connection")
    if deviceId <> "" then section.Write("device_id", deviceId)
    if preferences <> "" then section.Write("preferences", preferences)
    section.Flush()
end sub

function DefaultPreferences() as Object
    return {
        maxBitrate: 20000000
        maxResolution: "1080p"
        subtitleMode: "auto"
        subtitleLanguage: "en"
        audioLanguage: "en"
        autoplayNext: true
        resumeBehavior: "auto"
        diagnostics: false
    }
end function

function NormalizePreferences(value as Dynamic) as Object
    normalized = DefaultPreferences()
    if not IsAssociativeArray(value) then return normalized
    for each key in normalized
        if value[key] <> invalid then normalized[key] = value[key]
    end for
    return normalized
end function

function SerializePreferences(value as Dynamic) as String
    return FormatJson(NormalizePreferences(value))
end function

function DeserializePreferences(value as String) as Object
    return NormalizePreferences(SafeJsonParse(value))
end function

function ReadRecentSearches() as Object
    section = CreateObject("roRegistrySection", "flux")
    searches = SafeJsonParse(section.Read("recent_searches"))
    if searches = invalid then return []
    return searches
end function

function AddRecentSearch(query as String) as Object
    normalized = query.Trim()
    searches = ReadRecentSearches()
    updated = [normalized]
    for each existing in searches
        if LCase(existing) <> LCase(normalized) and updated.Count() < 8 then updated.Push(existing)
    end for
    section = CreateObject("roRegistrySection", "flux")
    section.Write("recent_searches", FormatJson(updated))
    section.Flush()
    return updated
end function

sub ClearRecentSearches()
    section = CreateObject("roRegistrySection", "flux")
    section.Delete("recent_searches")
    section.Flush()
end sub
