function NormalizeFeatureFlags(value as Dynamic) as Object
    flags = {
        profiles: false
        requests: false
        skipIntro: false
        subtitles: false
        audioTracks: false
    }
    if not IsAssociativeArray(value) then return flags
    for each key in flags
        if value[key] <> invalid then flags[key] = value[key] = true
    end for
    return flags
end function

