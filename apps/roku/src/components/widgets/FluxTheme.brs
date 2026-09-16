' Flux for Roku — design tokens.
'
' Mirrors the web app's palette (globals.css :root) so the TV and the browser
' read as one product. Every screen positions content inside the 1920x1080
' title-safe area: 96px side margins, 60px top, 60px bottom.
function FluxTheme() as Object
    return {
        canvas: "#0D0F12"
        surface: "#171A1F"
        raised: "#21262D"
        raisedHover: "#2A3038"
        line: "#2A2F37"
        primaryText: "#F4F4F5"
        secondaryText: "#B4B6BC"
        mutedText: "#7D8189"
        accent: "#3B82F6"
        accentSoft: "#60A5FA"
        focus: "#60A5FA"
        success: "#22C55E"
        warning: "#F59E0B"
        danger: "#EF4444"
        onAccent: "#FFFFFF"
        safeLeft: 96
        safeTop: 60
        safeRight: 1824
        safeBottom: 1020
        contentWidth: 1728
        ' Poster card geometry shared by every rail and grid.
        posterWidth: 196
        posterHeight: 294
        posterGap: 24
        ' Landscape (episode) card geometry.
        wideWidth: 392
        wideHeight: 221
        wideGap: 24
    }
end function

' Roku ships one system typeface; sizes are what give the UI its hierarchy.
' Sizes are the actual pixel heights at 1080p.
function FluxFont(size as Integer, bold = false as Boolean) as Object
    if m.fluxFontCache = invalid then m.fluxFontCache = {}
    key = size.ToStr()
    if bold then key = key + "b"
    cached = m.fluxFontCache[key]
    if cached <> invalid then return cached
    font = CreateObject("roSGNode", "Font")
    if bold then font.uri = "font:BoldSystemFontFile" else font.uri = "font:SystemFontFile"
    font.size = size
    m.fluxFontCache[key] = font
    return font
end function

function FluxArtworkUrl(item as Object, artworkKey as String, fallback as String) as String
    if item = invalid then return fallback
    artwork = item.artwork
    if artwork = invalid then return fallback
    url = artwork[artworkKey]
    if url = invalid or url = "" then return fallback
    return url
end function

' "2h 50m" / "48m" from minutes.
function FluxRuntime(minutes as Dynamic) as String
    if minutes = invalid or minutes <= 0 then return ""
    total = Int(minutes)
    hours = Int(total / 60)
    mins = total mod 60
    if hours <= 0 then return mins.ToStr() + "m"
    if mins = 0 then return hours.ToStr() + "h"
    return hours.ToStr() + "h " + mins.ToStr() + "m"
end function

' Metadata line pieces joined with a middle dot, skipping blanks.
function FluxJoinMeta(parts as Object) as String
    result = ""
    for each part in parts
        if part <> invalid and part <> ""
            if result <> "" then result = result + "   ·   "
            result = result + part
        end if
    end for
    return result
end function

function FluxProgressPercent(progress as Dynamic) as Float
    if progress = invalid then return 0
    if progress.percent <> invalid then return progress.percent
    if progress.durationSeconds = invalid or progress.durationSeconds <= 0 then return 0
    value = progress.positionSeconds / progress.durationSeconds
    if value < 0 then return 0
    if value > 1 then return 1
    return value
end function

' Build a ContentNode with the fields every card/rail expects from a server card.
function FluxContentFromCard(media as Object, posterKey = "poster" as String) as Object
    item = CreateObject("roSGNode", "ContentNode")
    item.id = media.id
    item.title = media.title
    item.description = media.overview
    item.hdPosterUrl = FluxArtworkUrl(media, posterKey, "pkg:/images/placeholder-poster.png")
    item.addFields({
        retryRowId: ""
        mediaType: media.mediaType
        progress: media.progress
        watched: media.watched = true
        unplayedCount: media.unplayedCount
        parentMediaId: media.parentMediaId
        backdropUrl: FluxArtworkUrl(media, "backdrop", "pkg:/images/placeholder-backdrop.png")
        thumbnailUrl: FluxArtworkUrl(media, "thumbnail", FluxArtworkUrl(media, "backdrop", "pkg:/images/placeholder-backdrop.png"))
        subtitle: media.subtitle
        year: media.year
        runtimeMinutes: media.runtimeMinutes
        contentRating: media.contentRating
        rating: media.rating
        genres: media.genres
        available: media.available <> false
    })
    return item
end function
