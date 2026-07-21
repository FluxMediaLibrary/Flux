function NormalizeServerUrl(value as Dynamic) as String
    if value = invalid then return ""
    url = value.ToStr().Trim()
    while Right(url, 1) = "/"
        url = Left(url, Len(url) - 1)
    end while
    lower = LCase(url)
    if Left(lower, 7) <> "http://" and Left(lower, 8) <> "https://" then return ""
    pattern = CreateObject("roRegex", "^https?://[^/\s]+$", "i")
    if not pattern.IsMatch(url) then return ""
    return url
end function

function DefaultServerUrl() as String
    return NormalizeServerUrl(CreateObject("roAppInfo").GetValue("flux_server_url"))
end function

function CompareSemanticVersions(leftValue as String, rightValue as String) as Integer
    leftParts = leftValue.Tokenize(".")
    rightParts = rightValue.Tokenize(".")
    for index = 0 to 2
        leftNumber = 0
        rightNumber = 0
        if index < leftParts.Count() then leftNumber = Val(leftParts[index])
        if index < rightParts.Count() then rightNumber = Val(rightParts[index])
        if leftNumber < rightNumber then return -1
        if leftNumber > rightNumber then return 1
    end for
    return 0
end function

function JoinUrl(baseUrl as String, route as String) as String
    normalized = NormalizeServerUrl(baseUrl)
    if normalized = "" then return ""
    if Left(route, 1) <> "/" then route = "/" + route
    return normalized + route
end function

function UrlEncode(value as String) as String
    return value.EncodeUriComponent()
end function

function SafeJsonParse(value as String) as Dynamic
    normalized = value.Trim()
    if normalized = "" then return invalid
    firstCharacter = Left(normalized, 1)
    if firstCharacter <> "{" and firstCharacter <> "[" then return invalid
    return ParseJson(normalized)
end function

function CanonicalRequestKey(key as String) as String
    keyMap = {
        devicename: "deviceName"
        deviceid: "deviceId"
        appversion: "appVersion"
        devicecode: "deviceCode"
        profileid: "profileId"
        refreshtoken: "refreshToken"
        mediaitemid: "mediaItemId"
        episodeid: "episodeId"
        positionseconds: "positionSeconds"
        durationseconds: "durationSeconds"
        audiostreamindex: "audioStreamIndex"
        subtitlestreamindex: "subtitleStreamIndex"
        preferredaudiolanguage: "preferredAudioLanguage"
        preferredsubtitlelanguage: "preferredSubtitleLanguage"
        subtitlesenabled: "subtitlesEnabled"
        supports4k: "supports4k"
        supportshevc: "supportsHevc"
        supportshdr10: "supportsHdr10"
        maxbitrate: "maxBitrate"
        sessionid: "sessionId"
    }
    normalized = LCase(key)
    if keyMap[normalized] <> invalid then return keyMap[normalized]
    return key
end function

function CanonicalizeRequestJson(value as Dynamic) as Dynamic
    if IsAssociativeArray(value)
        result = CreateObject("roAssociativeArray")
        result.SetModeCaseSensitive()
        for each key in value
            result.AddReplace(CanonicalRequestKey(key), CanonicalizeRequestJson(value[key]))
        end for
        return result
    end if
    if GetInterface(value, "ifArray") <> invalid
        result = []
        for each item in value
            result.Push(CanonicalizeRequestJson(item))
        end for
        return result
    end if
    return value
end function

function PerformJsonRequest(input as Object, timeoutMs as Integer) as Object
    transfer = CreateObject("roUrlTransfer")
    port = CreateObject("roMessagePort")
    transfer.SetMessagePort(port)
    transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    transfer.InitClientCertificates()
    transfer.SetUrl(input.url)
    transfer.SetRequest("GET")
    transfer.SetHeaders({ "Accept": "application/json", "User-Agent": "FluxRoku/" + AppVersion() })
    if input.method <> invalid then transfer.SetRequest(input.method)
    if input.token <> invalid and input.token <> "" then transfer.AddHeader("Authorization", "Bearer " + input.token)
    if input.headers <> invalid
        for each name in input.headers
            transfer.AddHeader(name, input.headers[name])
        end for
    end if
    transfer.EnableEncodings(true)
    transfer.RetainBodyOnError(true)
    transfer.SetMinimumTransferRate(1, 10)

    body = ""
    if input.bodyJson <> invalid and input.bodyJson <> ""
        transfer.AddHeader("Content-Type", "application/json")
        body = input.bodyJson
    else if input.body <> invalid
        transfer.AddHeader("Content-Type", "application/json")
        body = FormatJson(CanonicalizeRequestJson(input.body))
    end if

    if body = ""
        started = transfer.AsyncGetToString()
    else
        started = transfer.AsyncPostFromString(body)
    end if
    if not started then return { status: 0, data: invalid, failureReason: "Request could not be started", timedOut: false }

    responseEvent = Wait(timeoutMs, port)
    if responseEvent = invalid
        transfer.AsyncCancel()
        return { status: 0, data: invalid, failureReason: "Request timed out", timedOut: true }
    end if
    if Type(responseEvent) <> "roUrlEvent"
        transfer.AsyncCancel()
        return { status: 0, data: invalid, failureReason: "Unexpected network event", timedOut: false }
    end if

    return {
        status: responseEvent.GetResponseCode()
        data: SafeJsonParse(responseEvent.GetString())
        failureReason: responseEvent.GetFailureReason()
        timedOut: false
    }
end function

function IsAssociativeArray(value as Dynamic) as Boolean
    return GetInterface(value, "ifAssociativeArray") <> invalid
end function

function IsArray(value as Dynamic) as Boolean
    return GetInterface(value, "ifArray") <> invalid
end function

function Clamp(value as Float, minimum as Float, maximum as Float) as Float
    if value < minimum then return minimum
    if value > maximum then return maximum
    return value
end function

function ProgressPercent(positionSeconds as Float, durationSeconds as Dynamic) as Float
    if durationSeconds = invalid or durationSeconds <= 0 then return 0
    return Clamp(positionSeconds / durationSeconds, 0, 1)
end function

function MapApiFailure(status as Integer, parsed as Dynamic) as Object
    code = "NETWORK_ERROR"
    message = "Flux could not reach the server."
    retryable = status <= 0 or status = 408 or status = 429 or status >= 500
    if IsAssociativeArray(parsed)
        if parsed.code <> invalid then code = parsed.code else if parsed.error <> invalid then code = parsed.error
        if parsed.message <> invalid then message = parsed.message
    else if status > 0
        code = "HTTP_" + status.ToStr()
        message = "The server returned HTTP " + status.ToStr() + "."
    end if
    return { status: status, code: code, message: message, retryable: retryable }
end function

function AppVersion() as String
    info = CreateObject("roAppInfo")
    return info.GetValue("major_version") + "." + info.GetValue("minor_version") + "." + info.GetValue("build_version")
end function
