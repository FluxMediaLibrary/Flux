sub init()
    m.theme = FluxTheme()
    m.actions = m.top.findNode("actions")
    m.episodes = m.top.findNode("episodes")
    m.poster = m.top.findNode("poster")
    m.backdrop = m.top.findNode("backdrop")
    m.topbar = m.top.findNode("topbar")
    m.posterFallback = "pkg:/images/placeholder-poster.png"
    m.backdropFallback = "pkg:/images/placeholder-backdrop.png"
    m.poster.observeField("loadStatus", "onPosterLoadStatus")
    m.backdrop.observeField("loadStatus", "onBackdropLoadStatus")
    m.actions.observeField("itemSelected", "onAction")
    m.episodes.observeField("rowItemSelected", "onEpisode")
    m.top.findNode("title").font = FluxFont(60, true)
    m.top.findNode("metadata").font = FluxFont(24, false)
    m.top.findNode("overview").font = FluxFont(26, false)
    m.top.findNode("credits").font = FluxFont(22, false)
    m.top.findNode("availability").font = FluxFont(26, true)
    m.top.findNode("episodeHeader").font = FluxFont(30, true)
    m.topbar.contextLabel = "Back returns to the previous screen"
end sub

sub renderDetail()
    detail = m.top.detail
    if detail = invalid then return
    m.top.findNode("title").text = detail.title
    m.poster.uri = FluxArtworkUrl(detail, "poster", m.posterFallback)
    m.backdrop.uri = FluxArtworkUrl(detail, "backdrop", m.backdropFallback)
    overview = detail.overview
    if overview = invalid or overview = "" then overview = "No description is available for this title."
    m.top.findNode("overview").text = overview

    parts = []
    if detail.year <> invalid then parts.Push(detail.year.ToStr())
    if detail.contentRating <> invalid and detail.contentRating <> "" then parts.Push(detail.contentRating)
    parts.Push(FluxRuntime(detail.runtimeMinutes))
    if detail.rating <> invalid and detail.rating > 0 then parts.Push(Left(FormatJson(detail.rating), 3) + " / 10")
    if detail.genres <> invalid and detail.genres.Count() > 0
        genres = []
        for each genre in detail.genres
            if genres.Count() >= 3 then exit for
            genres.Push(genre)
        end for
        parts.Push(genres.Join(", "))
    end if
    if detail.mediaType = "show" then parts.Push("Series") else parts.Push("Movie")
    m.top.findNode("metadata").text = FluxJoinMeta(parts)

    credits = ""
    if detail.directors <> invalid and detail.directors.Count() > 0 then credits = "Directed by " + detail.directors.Join(", ")
    if detail.cast <> invalid and detail.cast.Count() > 0
        castNames = []
        for each member in detail.cast
            if castNames.Count() >= 4 then exit for
            castNames.Push(member.name)
        end for
        if castNames.Count() > 0
            if credits <> "" then credits = credits + "   ·   "
            credits = credits + "Starring " + castNames.Join(", ")
        end if
    end if
    m.top.findNode("credits").text = credits

    actions = CreateObject("roSGNode", "ContentNode")
    resumable = detail.progress <> invalid and detail.progress.positionSeconds > 0 and not detail.progress.completed
    if detail.available
        play = actions.CreateChild("ContentNode")
        if resumable then play.title = "Resume" else play.title = "Play"
        play.addFields({ id: "play", icon: "pkg:/images/icon-play.png", primary: true })
        if resumable
            restart = actions.CreateChild("ContentNode")
            restart.title = "Start over"
            restart.addFields({ id: "restart", icon: "", primary: false })
        end if
    end if
    if detail.trailer <> invalid and detail.trailer.webUrl <> invalid and detail.trailer.webUrl <> ""
        trailer = actions.CreateChild("ContentNode")
        trailer.title = "Trailer"
        trailer.addFields({ id: "trailer", icon: "", primary: false, trailerUrl: detail.trailer.webUrl })
    end if
    if not detail.available
        back = actions.CreateChild("ContentNode")
        back.title = "Back"
        back.addFields({ id: "back", icon: "", primary: false })
    end if
    m.actions.content = actions
    m.actions.numColumns = actions.GetChildCount()
    m.top.findNode("availability").visible = not detail.available
    if not detail.available then m.top.findNode("availability").translation = [400 + 16 + 260, 510]

    relatedItems = invalid
    relatedTitle = ""
    relatedKind = ""
    if detail.seasons <> invalid and detail.seasons.Count() > 0
        relatedItems = detail.seasons
        relatedTitle = "Seasons"
        relatedKind = "season"
    else if detail.similar <> invalid and detail.similar.Count() > 0
        relatedItems = detail.similar
        relatedTitle = "More like this"
        relatedKind = "media"
    end if
    header = m.top.findNode("episodeHeader")
    if relatedItems <> invalid
        root = CreateObject("roSGNode", "ContentNode")
        row = root.CreateChild("ContentNode")
        if relatedKind = "season"
            m.episodes.rowItemSize = [[392, 300]]
            for each related in relatedItems
                item = row.CreateChild("ContentNode")
                item.id = related.season.ToStr()
                item.title = related.title
                item.hdPosterUrl = FluxArtworkUrl(related, "backdrop", m.backdropFallback)
                label = related.availableCount.ToStr() + " episode"
                if related.availableCount <> 1 then label = label + "s"
                if related.unplayedCount <> invalid and related.unplayedCount > 0 then label = label + "   ·   " + related.unplayedCount.ToStr() + " unplayed"
                item.addFields({ contentKind: "season", mediaType: "show", parentMediaId: detail.id, seasonNumber: related.season, watched: related.unplayedCount = 0, unplayedCount: related.unplayedCount, progress: invalid, subtitle: label, thumbnailUrl: FluxArtworkUrl(related, "backdrop", m.backdropFallback), available: related.availableCount > 0, episodeNumber: invalid })
            end for
        else
            m.episodes.rowItemSize = [[196, 360]]
            for each related in relatedItems
                item = FluxContentFromCard(related)
                item.addFields({ contentKind: "media", seasonNumber: -1 })
                row.AppendChild(item)
            end for
        end if
        m.episodes.content = root
        m.episodes.visible = true
        header.text = relatedTitle
        header.visible = true
    else
        m.episodes.visible = false
        header.visible = false
    end if
    if actions.GetChildCount() > 0
        m.actions.SetFocus(true)
    else if m.episodes.visible
        m.episodes.SetFocus(true)
    end if
end sub

sub onPosterLoadStatus()
    if m.poster.loadStatus = "failed" and m.poster.uri <> m.posterFallback then m.poster.uri = m.posterFallback
end sub

sub onBackdropLoadStatus()
    if m.backdrop.loadStatus = "failed" and m.backdrop.uri <> m.backdropFallback then m.backdrop.uri = m.backdropFallback
end sub

sub onAction()
    if m.actions.content = invalid then return
    action = m.actions.content.GetChild(m.actions.itemSelected)
    if action = invalid then return
    if action.id = "back"
        m.top.backRequested = true
    else if action.id = "trailer"
        m.top.trailerRequested = { title: m.top.detail.title, url: action.trailerUrl }
    else if action.id = "play" or action.id = "restart"
        m.top.playSelected = { id: m.top.detail.id, mediaType: m.top.detail.mediaType, parentMediaId: m.top.detail.parentMediaId, restart: action.id = "restart" }
    end if
end sub

sub onEpisode()
    indices = m.episodes.rowItemSelected
    if indices.Count() <> 2 then return
    if m.episodes.content = invalid then return
    row = m.episodes.content.GetChild(indices[0])
    if row = invalid then return
    item = row.GetChild(indices[1])
    if item = invalid then return
    if item.contentKind = "season"
        m.top.seasonSelected = { mediaId: item.parentMediaId, season: item.seasonNumber, title: m.top.detail.title }
    else
        m.top.mediaSelected = { id: item.id, mediaType: item.mediaType, parentMediaId: item.parentMediaId }
    end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "down" and m.actions.HasFocus() and m.episodes.visible
        m.episodes.SetFocus(true)
        return true
    else if key = "up" and m.episodes.HasFocus()
        if m.actions.content <> invalid and m.actions.content.GetChildCount() > 0 then m.actions.SetFocus(true)
        return true
    end if
    return false
end function
