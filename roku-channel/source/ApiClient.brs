' FluxApiClient.brs
' HTTP client for the Flux media library API.
' Uses roUrlTransfer for all requests. JWT is stored in Registry.

function FluxApiClient() as object
    this = {}
    
    ' Base URL for the Flux API backend
    this.BASE_URL = "https://flux.personal.deadstudios.xyz/api"
    ' TMDb image base URL (w500 for posters, w1280 for backdrops)
    this.IMAGE_BASE = "https://image.tmdb.org/t/p"
    this.POSTER_SIZE = "w500"
    this.BACKDROP_SIZE = "w1280"
    
    ' Token persistence via Registry
    this.registry = CreateObject("roRegistrySection", "FluxAuth")
    
    ' --- Token management ---
    
    this.getToken = function() as string
        return m.registry.Read("token")
    end function
    
    this.getBaseToken = function() as string
        return m.registry.Read("baseToken")
    end function
    
    this.saveTokens = function(token as string, baseToken = "" as string) as void
        m.registry.Write("token", token)
        if baseToken <> "" then m.registry.Write("baseToken", baseToken)
        m.registry.Flush()
    end function
    
    this.clearTokens = function() as void
        m.registry.Delete("token")
        m.registry.Delete("baseToken")
        m.registry.Flush()
    end function
    
    ' --- Core request wrapper ---
    
    ' Sends an HTTP request to the Flux API.
    ' @param path - API path relative to BASE_URL (e.g. "/auth/login")
    ' @param method - HTTP method: "GET", "POST", "DELETE"
    ' @param body - Optional associative array to JSON-encode as request body
    ' @param anonymous - If true, skip Authorization header
    ' @param tokenOverride - Use this token instead of the stored one
    ' @return { code: integer, body: string, json: object } — json is parsed when possible
    
    this.request = function(path as string, method = "GET" as string, body = invalid as dynamic, anonymous = false as boolean, tokenOverride = "" as string) as object
        url = m.BASE_URL + path
        
        ut = CreateObject("roUrlTransfer")
        ut.SetUrl(url)
        ut.SetCertificatesFile("common:/certs/ca-bundle.crt")
        
        ' Headers
        headers = { "Accept": "application/json" }
        
        if NOT anonymous then
            token = tokenOverride
            if token = "" then token = m.getToken()
            if token <> "" then headers["Authorization"] = "Bearer " + token
        end if
        
        if body <> invalid then
            headers["Content-Type"] = "application/json"
            jsonBody = FormatJson(body)
            ut.SetRequest("POST")
        else if method = "POST" then
            ut.SetRequest("POST")
        else if method = "DELETE" then
            ut.SetRequest("DELETE")
        end if
        
        ' Set headers on the transfer object
        for each key in headers
            ut.AddHeader(key, headers[key])
        end for
        
        ' Attach body for POST
        if body <> invalid then
            result = ut.PostFromString(jsonBody)
        else
            result = ut.GetToString()
        end if
        
        responseCode = ut.GetResponseCode()
        responseBody = result
        
        ' Try parsing JSON
        json = invalid
        if responseBody <> "" then
            json = ParseJson(responseBody)
        end if
        
        return { code: responseCode, body: responseBody, json: json }
    end function
    
    ' --- Endpoint wrappers ---
    
    ' Auth
    this.login = function(email as string, password as string) as object
        body = { email: email, password: password }
        return m.request("/auth/login", "POST", body, true)
    end function
    
    ' Profiles
    this.activateProfile = function(profileId as string) as object
        baseToken = m.getBaseToken()
        return m.request("/profiles/" + m.urlEncode(profileId) + "/activate", "POST", invalid, false, baseToken)
    end function
    
    ' Library
    this.getHomepage = function() as object
        return m.request("/library/home")
    end function
    
    this.listLibrary = function(mediaType = "all" as string) as object
        return m.request("/library/items?type=" + mediaType)
    end function
    
    this.getMediaItem = function(id as string) as object
        return m.request("/library/items/" + m.urlEncode(id))
    end function
    
    ' TMDb
    this.searchTmdb = function(query as string, mediaType = "movie" as string) as object
        encoded = m.urlEncode(query)
        return m.request("/tmdb/search?q=" + encoded + "&type=" + mediaType)
    end function
    
    this.getTrending = function(mediaType = "movie" as string, windowStr = "week" as string) as object
        return m.request("/tmdb/trending?type=" + mediaType + "&window=" + windowStr)
    end function
    
    this.getPopular = function(mediaType = "movie" as string) as object
        return m.request("/tmdb/popular?type=" + mediaType)
    end function
    
    this.getTmdbDetail = function(mediaType as string, tmdbId as integer) as object
        segment = mediaType
        if segment = "SHOW" then segment = "tv"
        return m.request("/tmdb/" + segment + "/" + tmdbId.ToStr())
    end function
    
    this.getGenres = function(mediaType = "movie" as string) as object
        return m.request("/tmdb/genres?type=" + mediaType)
    end function
    
    this.discover = function(mediaType = "movie" as string, genreId = 0 as integer) as object
        url = "/tmdb/discover?type=" + mediaType
        if genreId > 0 then url = url + "&genre=" + genreId.ToStr()
        return m.request(url)
    end function
    
    this.getSeasonEpisodes = function(tmdbId as integer, season as integer) as object
        return m.request("/tmdb/tv/" + tmdbId.ToStr() + "/season/" + season.ToStr())
    end function
    
    ' Streaming — constructs direct URLs (not proxied through request())
    this.getStreamUrl = function(mediaItemId as string, episodeId = "" as string) as string
        token = m.getToken()
        params = "?token=" + m.urlEncode(token)
        if episodeId <> "" then params = params + "&episodeId=" + m.urlEncode(episodeId)
        return m.BASE_URL + "/stream/" + m.urlEncode(mediaItemId) + params
    end function
    
    this.getHlsUrl = function(mediaItemId as string, episodeId = "" as string) as string
        token = m.getToken()
        params = "?token=" + m.urlEncode(token)
        if episodeId <> "" then params = params + "&episodeId=" + m.urlEncode(episodeId)
        return m.BASE_URL + "/stream/" + m.urlEncode(mediaItemId) + "/hls/index.m3u8" + params
    end function
    
    this.getPlaybackInfo = function(mediaItemId as string, episodeId = "" as string) as object
        path = "/stream/" + m.urlEncode(mediaItemId) + "/info"
        if episodeId <> "" then path = path + "?episodeId=" + m.urlEncode(episodeId)
        return m.request(path)
    end function
    
    ' Watch progress
    this.saveProgress = function(body as object) as object
        return m.request("/library/progress", "POST", body)
    end function
    
    ' Requests
    this.createRequest = function(body as object) as object
        return m.request("/requests", "POST", body)
    end function
    
    ' --- Helpers ---
    
    ' Simple URL encoding for path segments
    this.urlEncode = function(s as string) as string
        return CreateObject("roUrlTransfer").Escape(s)
    end function
    
    ' Build a full poster URL from a TMDb posterPath.
    ' Returns a placeholder image URL if posterPath is empty/invalid.
    this.posterUrl = function(posterPath as dynamic) as string
        if posterPath = invalid or posterPath = "" then return ""
        return m.IMAGE_BASE + "/" + m.POSTER_SIZE + posterPath
    end function
    
    ' Build a full backdrop URL from a TMDb backdropPath.
    this.backdropUrl = function(backdropPath as dynamic) as string
        if backdropPath = invalid or backdropPath = "" then return ""
        return m.IMAGE_BASE + "/" + m.BACKDROP_SIZE + backdropPath
    end function
    
    return this
end function
