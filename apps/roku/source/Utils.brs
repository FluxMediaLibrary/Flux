function NormalizeServerUrl(value as Dynamic) as String
    if value = invalid then return ""
    url = value.ToStr().Trim()
    while Right(url, 1) = "/"
        url = Left(url, Len(url) - 1)
    end while
    lower = LCase(url)
    if Left(lower, 7) <> "http://" and Left(lower, 8) <> "https://" then return ""
    pattern = CreateObject("roRegex", "^https?://[^/\\s]+$", "i")
    if not pattern.IsMatch(url) then return ""
    return url
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
    transfer = CreateObject("roUrlTransfer")
    return transfer.Escape(value)
end function

function SafeJsonParse(value as String) as Dynamic
    if value = "" then return invalid
    return ParseJson(value)
end function

function IsAssociativeArray(value as Dynamic) as Boolean
    return GetInterface(value, "ifAssociativeArray") <> invalid
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
    retryable = status = 0 or status = 408 or status = 429 or status >= 500
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
