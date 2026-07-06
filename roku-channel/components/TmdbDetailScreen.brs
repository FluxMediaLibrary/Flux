' TmdbDetailScreen.brs
' TMDb detail view for items not yet in the Flux library. Has a Request button.

sub init()
    m.backdrop = m.top.FindNode("backdrop")
    m.titleLabel = m.top.FindNode("titleLabel")
    m.metaLabel = m.top.FindNode("metaLabel")
    m.overviewLabel = m.top.FindNode("overviewLabel")
    m.requestButton = m.top.FindNode("requestButton")
    m.statusLabel = m.top.FindNode("statusLabel")
    m.spinner = m.top.FindNode("spinner")
    m.errorLabel = m.top.FindNode("errorLabel")
    
    m.mediaType = m.top.mediaType
    m.tmdbId = m.top.tmdbId
    
    m.loadDetail()
end sub

sub loadDetail()
    m.spinner.visible = true
    
    api = m.top.api
    response = api.getTmdbDetail(m.mediaType, m.tmdbId)
    
    m.spinner.visible = false
    
    if response.code <> 200 or response.json = invalid
        m.errorLabel.text = "Failed to load details."
        m.errorLabel.visible = true
        return
    end if
    
    item = response.json
    
    ' Backdrop
    if item.backdropPath <> invalid and item.backdropPath <> ""
        m.backdrop.uri = api.backdropUrl(item.backdropPath)
    else if item.posterPath <> invalid
        m.backdrop.uri = api.posterUrl(item.posterPath)
    end if
    
    m.titleLabel.text = item.title
    
    ' Metadata
    meta = ""
    if item.year <> invalid then meta = item.year.ToStr()
    if item.runtime <> invalid and item.runtime > 0
        if meta <> "" then meta = meta + "   |   "
        hours = Int(item.runtime / 60)
        mins = item.runtime mod 60
        meta = meta + hours.ToStr() + "h " + mins.ToStr() + "m"
    end if
    if item.genres <> invalid and item.genres.Count() > 0
        if meta <> "" then meta = meta + "   |   "
        genreStr = ""
        for each g in item.genres
            if genreStr <> "" then genreStr = genreStr + ", "
            genreStr = genreStr + g
        end for
        meta = meta + genreStr
    end if
    if item.voteAverage <> invalid
        if meta <> "" then meta = meta + "   |   "
        meta = meta + item.voteAverage.ToStr() + "/10"
    end if
    m.metaLabel.text = meta
    
    ' Overview
    if item.overview <> invalid
        m.overviewLabel.text = item.overview
    end if
    
    m.requestButton.SetFocus(true)
end sub

sub doRequest()
    m.spinner.visible = true
    m.statusLabel.visible = false
    
    api = m.top.api
    body = {
        tmdbId: m.tmdbId,
        mediaType: m.mediaType,
        title: m.titleLabel.text
    }
    
    response = api.createRequest(body)
    
    m.spinner.visible = false
    
    if response.code = 200 or response.code = 201
        m.statusLabel.text = "Request sent."
        m.statusLabel.visible = true
        m.requestButton.SetFocus(false)
    else
        msg = "Request failed."
        if response.json <> invalid and response.json.message <> invalid
            msg = response.json.message
        end if
        m.statusLabel.text = msg
        m.statusLabel.color = "#cc4444"
        m.statusLabel.visible = true
    end if
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if NOT press then return false
    
    if key = "back"
        m.top.close = true
        return true
    else if key = "OK"
        if m.requestButton.IsInFocusChain()
            m.doRequest()
            return true
        end if
    end if
    
    return false
end function
