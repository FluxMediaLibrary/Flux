sub init()
    m.actions = m.top.findNode("actions")
    m.episodes = m.top.findNode("episodes")
    m.poster = m.top.findNode("poster")
    m.backdrop = m.top.findNode("backdrop")
    m.posterFallback = "pkg:/images/placeholder-poster.png"
    m.backdropFallback = "pkg:/images/placeholder-backdrop.png"
    m.poster.observeField("loadStatus", "onPosterLoadStatus")
    m.backdrop.observeField("loadStatus", "onBackdropLoadStatus")
    m.actions.observeField("itemSelected", "onAction")
    m.episodes.observeField("rowItemSelected", "onEpisode")
end sub

sub renderDetail()
    detail = m.top.detail
    if detail = invalid then return
    m.top.findNode("title").text = detail.title
    posterUrl = FluxArtworkUrl(detail, "poster", "pkg:/images/placeholder-poster.png")
    backdropUrl = FluxArtworkUrl(detail, "backdrop", "pkg:/images/placeholder-backdrop.png")
    m.poster.uri = posterUrl
    m.backdrop.uri = backdropUrl
    m.top.findNode("overview").text = detail.overview
    metadata = ""
    if detail.year <> invalid then metadata = detail.year.ToStr()
    if detail.contentRating <> invalid and detail.contentRating <> "" then metadata = appendMetadata(metadata, detail.contentRating)
    if detail.runtimeMinutes <> invalid then metadata = appendMetadata(metadata, detail.runtimeMinutes.ToStr() + " min")
    if detail.rating <> invalid then metadata = appendMetadata(metadata, FormatJson(detail.rating) + "/10")
    if detail.genres <> invalid and detail.genres.Count() > 0 then metadata = appendMetadata(metadata, detail.genres.Join(", "))
    m.top.findNode("metadata").text = metadata
    credits = ""
    if detail.directors <> invalid and detail.directors.Count() > 0 then credits = "Directed by " + detail.directors.Join(", ")
    if detail.cast <> invalid and detail.cast.Count() > 0
        castNames = []
        for each member in detail.cast
            if castNames.Count() >= 4 then exit for
            castNames.Push(member.name)
        end for
        if castNames.Count() > 0
            if credits <> "" then credits = credits + "  |  "
            credits = credits + "Cast: " + castNames.Join(", ")
        end if
    end if
    m.top.findNode("credits").text = credits

    actions = CreateObject("roSGNode", "ContentNode")
    if detail.available
        action = actions.CreateChild("ContentNode")
        if detail.progress <> invalid and detail.progress.positionSeconds > 0 and not detail.progress.completed
            action.title = "Resume"
        else
            action.title = "Play"
        end if
        action.id = "play"
        restart = actions.CreateChild("ContentNode")
        restart.title = "Restart from beginning"
        restart.id = "restart"
    else
        back = actions.CreateChild("ContentNode")
        back.title = "Back to Home"
        back.id = "back"
    end if
    if detail.trailer <> invalid and detail.trailer.webUrl <> invalid and detail.trailer.webUrl <> ""
        trailer = actions.CreateChild("ContentNode")
        trailer.title = "Watch trailer"
        trailer.id = "trailer"
        trailer.addFields({ trailerUrl: detail.trailer.webUrl })
    end if
    m.actions.content = actions
    m.top.findNode("availability").visible = not detail.available

    relatedItems = invalid
    relatedTitle = ""
    relatedKind = ""
    if detail.seasons <> invalid and detail.seasons.Count() > 0
        relatedItems = detail.seasons
        relatedTitle = "Seasons"
        relatedKind = "season"
    else if detail.similar <> invalid and detail.similar.Count() > 0
        relatedItems = detail.similar
        relatedTitle = "More Like This"
        relatedKind = "media"
    end if
    if relatedItems <> invalid
        root = CreateObject("roSGNode", "ContentNode")
        row = root.CreateChild("ContentNode")
        for each related in relatedItems
            item = row.CreateChild("ContentNode")
            if relatedKind = "season"
                item.id = related.season.ToStr()
                item.title = related.title
                item.description = related.availableCount.ToStr() + " available episodes"
                item.hdPosterUrl = FluxArtworkUrl(related, "backdrop", "pkg:/images/placeholder-backdrop.png")
                item.addFields({ contentKind: "season", mediaType: "show", parentMediaId: detail.id, seasonNumber: related.season, watched: related.unplayedCount = 0, unplayedCount: related.unplayedCount, progress: invalid })
            else
                item.id = related.id
                item.title = related.title
                item.description = related.overview
                item.hdPosterUrl = FluxArtworkUrl(related, "poster", "pkg:/images/placeholder-poster.png")
                item.addFields({ contentKind: "media", mediaType: related.mediaType, parentMediaId: related.parentMediaId, seasonNumber: -1, watched: related.watched, unplayedCount: related.unplayedCount, progress: related.progress })
            end if
        end for
        m.episodes.content = root
        m.episodes.visible = true
        m.top.findNode("episodeHeader").text = relatedTitle
        m.top.findNode("episodeHeader").visible = true
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

function appendMetadata(current as String, value as String) as String
    if current = "" then return value
    return current + "  |  " + value
end function

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
        m.actions.SetFocus(true)
        return true
    end if
    return false
end function
