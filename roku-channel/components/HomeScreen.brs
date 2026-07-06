' HomeScreen.brs
' Main browsing screen — RowList with continue watching, recently added, and genre sections.

sub init()
    m.homeRows = m.top.FindNode("homeRows")
    m.spinner = m.top.FindNode("spinner")
    m.errorLabel = m.top.FindNode("errorLabel")
    
    m.homeRows.ObserveField("rowItemSelected", "onItemSelected")
    
    m.loadHomepage()
end sub

sub loadHomepage()
    m.spinner.visible = true
    m.homeRows.visible = false
    m.errorLabel.visible = false
    
    api = m.top.api
    response = api.getHomepage()
    
    m.spinner.visible = false
    
    if response.code <> 200 or response.json = invalid
        m.errorLabel.text = "Failed to load. Check your connection."
        m.errorLabel.visible = true
        return
    end if
    
    data = response.json
    root = CreateObject("roSGNode", "ContentNode")
    
    ' Row 1: Continue Watching
    cw = data.continueWatching
    if cw <> invalid and cw.Count() > 0
        row = root.CreateChild("ContentNode")
        row.title = "Continue Watching"
        for each item in cw
            entry = row.CreateChild("ContentNode")
            media = item.mediaItem
            entry.title = media.title
            entry.HDPosterUrl = api.posterUrl(media.posterPath)
            entry.id = media.id
            entry.mediaType = media.type
            ' Store episode info for TV resume
            if item.episode <> invalid
                entry.episodeId = item.episode.id
                entry.episodeTitle = item.episode.title
            end if
        end for
    end if
    
    ' Row 2: Recently Added
    recent = data.recentlyAdded
    if recent <> invalid and recent.Count() > 0
        row = root.CreateChild("ContentNode")
        row.title = "Recently Added"
        for each item in recent
            entry = row.CreateChild("ContentNode")
            entry.title = item.title
            entry.HDPosterUrl = api.posterUrl(item.posterPath)
            entry.id = item.id
            entry.mediaType = item.type
        end for
    end if
    
    ' Rows 3+: By Genre
    genres = data.byGenre
    if genres <> invalid
        for each genreRow in genres
            if genreRow.items <> invalid and genreRow.items.Count() > 0
                row = root.CreateChild("ContentNode")
                row.title = genreRow.genre
                for each item in genreRow.items
                    entry = row.CreateChild("ContentNode")
                    entry.title = item.title
                    entry.HDPosterUrl = api.posterUrl(item.posterPath)
                    entry.id = item.id
                    entry.mediaType = item.type
                end for
            end if
        end for
    end if
    
    m.homeRows.content = root
    m.homeRows.visible = true
    m.homeRows.SetFocus(true)
end sub

sub onItemSelected(event as object)
    rowIndex = event.GetData()[0]
    colIndex = event.GetData()[1]
    
    content = m.homeRows.content.GetChild(rowIndex)
    item = content.GetChild(colIndex)
    
    if item <> invalid and item.id <> invalid
        nav = { action: "go_to_detail", mediaItemId: item.id, title: item.title }
        m.top.navigate = nav
    end if
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if NOT press then return false
    
    if key = "back"
        m.top.close = true
        return true
    end if
    
    return false
end function
