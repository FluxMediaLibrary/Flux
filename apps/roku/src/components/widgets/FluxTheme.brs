' Flux Roku visual tokens. XML declares safe fallbacks; screens use these values at runtime.
function FluxTheme() as Object
    return {
        canvas: "#0D0F12"
        surface: "#171A1F"
        raisedSurface: "#21262D"
        primaryText: "#F4F4F5"
        secondaryText: "#AAA9AA"
        mutedText: "#6B6B6C"
        accent: "#3B82F6"
        focus: "#60A5FA"
        success: "#22C55E"
        warning: "#F59E0B"
        danger: "#EF4444"
        edge: "#2A3447"
        safeLeft: 72
        safeTop: 48
        spacingSmall: 16
        spacingMedium: 28
        spacingLarge: 48
        spacingXLarge: 72
    }
end function

sub ApplyFluxFocus(list as Object)
    if list = invalid then return
    list.focusBitmapUri = "pkg:/images/focus.9.png"
end sub

function FluxArtworkUrl(item as Object, artworkKey as String, fallback as String) as String
    if item = invalid then return fallback
    artwork = item.artwork
    if artwork = invalid then return fallback
    url = artwork[artworkKey]
    if url = invalid or url = "" then return fallback
    return url
end function
