' DetailScreen.brs
' Media item detail view with backdrop, metadata, play button, and episode list.

sub init()
    m.backdrop = m.top.FindNode("backdrop")
    m.titleLabel = m.top.FindNode("title")
    m.metaLabel = m.top.FindNode("meta")
    m.overviewLabel = m.top.FindNode("overview")
    m.playBtn = m.top.FindNode("playBtn")
    m.infoLabel = m.top.FindNode("info")
    m.episodesHeading = m.top.FindNode("episodesHeading")
    m.episodeList = m.top.FindNode("episodeList")
    m.spinner = m.top.FindNode("spinner")
    m.errorLabel = m.top.FindNode("errorText")

    m.episodeList.ObserveField("itemSelected", "onEpisodePicked")

    m.itemId = m.top.mediaItemId
    m.loadDetail()
end sub

sub loadDetail()
    m.spinner.visible = true
    m.errorLabel.visible = false

    api = m.top.api
    resp = api.getMediaItem(m.itemId)

    m.spinner.visible = false

    if resp.code <> 200 or resp.json = invalid
        m.errorLabel.text = "Failed to load details."
        m.errorLabel.visible = true
        return
    end if

    data = resp.json

    ' Backdrop
    bgUrl = api.backdropUrl(data.backdropPath)
    if bgUrl <> ""
        m.backdrop.uri = bgUrl
    end if

    ' Title
    m.titleLabel.text = data.title

    ' Metadata line
    metaParts = []
    if data.year <> invalid
        metaParts.Push(data.year.ToStr())
    end if
    if data.type = "MOVIE" and data.runtime <> invalid and data.runtime > 0
        metaParts.Push(formatRuntime(data.runtime))
    end if
    if data.genres <> invalid and data.genres.Count() > 0
        gs = ""
        for each g in data.genres
            if gs <> "" then gs = gs + ", "
            gs = gs + g
        end for
        metaParts.Push(gs)
    end if
    m.metaLabel.text = joinStrings(metaParts, "  |  ")

    ' Overview
    if data.overview <> invalid
        m.overviewLabel.text = data.overview
    end if

    ' Episodes for TV shows
    eps = data.episodes
    if eps <> invalid and eps.Count() > 0
        m.episodesHeading.visible = true
        m.episodeList.visible = true

        content = CreateObject("roSGNode", "ContentNode")
        for each ep in eps
            entry = content.CreateChild("ContentNode")
            label = "S" + padNum(ep.season) + " E" + padNum(ep.episode)
            if ep.title <> invalid and ep.title <> ""
                label = label + "  -  " + ep.title
            end if
            entry.title = label
            entry.id = ep.id
            entry.season = ep.season
            entry.episode = ep.episode
            entry.available = ep.available
            if ep.progress <> invalid and ep.progress.positionSeconds > 0 and NOT ep.progress.completed
                entry.description = "Resume " + Int(ep.progress.positionSeconds / 60).ToStr() + "m"
            end if
        end for
        m.episodeList.content = content
    end if

    m.playBtn.SetFocus(true)
end sub

sub onEpisodePicked(event as object)
    idx = event.GetData()
    content = m.episodeList.content
    ep = content.GetChild(idx)

    if ep <> invalid and ep.id <> invalid
        dispTitle = m.titleLabel.text + " - " + ep.title
        m.top.navigate = { action: "go_to_player", mediaItemId: m.itemId, episodeId: ep.id, title: dispTitle }
    end if
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if NOT press then return false

    if key = "back"
        m.top.close = true
        return true
    else if key = "OK"
        if m.playBtn.IsInFocusChain()
            m.top.navigate = { action: "go_to_player", mediaItemId: m.itemId, episodeId: "", title: m.titleLabel.text }
            return true
        end if
    else if key = "right" and m.playBtn.IsInFocusChain()
        if m.episodeList.visible
            m.episodeList.SetFocus(true)
        end if
        return true
    else if key = "left" and m.episodeList.IsInFocusChain()
        m.playBtn.SetFocus(true)
        return true
    end if

    return false
end function

' ---- helpers ----

function padNum(n as integer) as string
    if n < 10 then return "0" + n.ToStr()
    return n.ToStr()
end function

function formatRuntime(seconds as integer) as string
    h = Int(seconds / 3600)
    m = Int((seconds mod 3600) / 60)
    if h > 0 then return h.ToStr() + "h " + m.ToStr() + "m"
    return m.ToStr() + "m"
end function

function joinStrings(parts as object, sep as string) as string
    result = ""
    for each p in parts
        if result <> "" then result = result + sep
        result = result + p
    end for
    return result
end function
