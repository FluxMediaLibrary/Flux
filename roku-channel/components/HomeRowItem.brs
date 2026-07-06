' HomeRowItem.brs
' Row item component — updates Poster and Label when content changes.

sub init()
    m.poster = m.top.FindNode("poster")
    m.itemTitle = m.top.FindNode("itemTitle")
    m.top.ObserveField("content", "onContentChange")
end sub

sub onContentChange()
    content = m.top.content
    if content = invalid then return
    
    if content.title <> invalid
        m.itemTitle.text = content.title
    end if
    
    if content.HDPosterUrl <> invalid and content.HDPosterUrl <> ""
        m.poster.uri = content.HDPosterUrl
    end if
end sub
