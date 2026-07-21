function RokuDeviceCapabilities() as Object
    info = CreateObject("roDeviceInfo")
    resolution = ResolutionName(info.GetVideoMode())
    return {
        model: info.GetModel()
        firmware: RokuOsVersion(info)
        supports4k: resolution = "2160p"
        supportsHevc: resolution = "2160p"
        supportsHdr10: false
        maxBitrate: 20000000
    }
end function

function RokuOsVersion(info as Object) as String
    version = info.GetOsVersion()
    if version = invalid then return "unknown"
    result = version.major + "." + version.minor
    if version.revision <> invalid and version.revision <> "" then result = result + "." + version.revision
    if version.build <> invalid and version.build <> "" then result = result + " (" + version.build + ")"
    return result
end function

function ResolutionName(videoMode as String) as String
    lower = LCase(videoMode)
    if lower.InStr("2160") >= 0 then return "2160p"
    if lower.InStr("1080") >= 0 then return "1080p"
    return "720p"
end function

function BuildPlaybackRequest(selection as Object, preferences as Object) as Object
    return BuildPlaybackRequestForCapabilities(selection, preferences, RokuDeviceCapabilities())
end function

function BuildPlaybackRequestForCapabilities(selection as Object, preferences as Object, capabilities as Object) as Object
    mediaItemId = selection.id
    episodeId = invalid
    if selection.mediaType = "episode"
        mediaItemId = selection.parentMediaId
        episodeId = selection.id
    end if
    capabilities.maxBitrate = preferences.maxBitrate
    request = {
        mediaItemId: mediaItemId
        capabilities: capabilities
        preferredAudioLanguage: preferences.audioLanguage
        preferredSubtitleLanguage: preferences.subtitleLanguage
        subtitlesEnabled: preferences.subtitleMode <> "off"
    }
    if episodeId <> invalid then request.episodeId = episodeId
    if preferences.resumeBehavior = "restart" or selection.restart = true then request.positionSeconds = 0
    return request
end function
