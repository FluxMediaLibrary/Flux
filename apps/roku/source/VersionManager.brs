function EvaluateVersion(versionResponse as Dynamic) as Object
    result = { required: false, available: false, message: "", releaseNotes: [] }
    if not IsAssociativeArray(versionResponse) then return result
    current = AppVersion()
    minimum = versionResponse.minimumVersion
    latest = versionResponse.latestVersion
    if minimum <> invalid and CompareSemanticVersions(current, minimum) < 0
        result.required = true
    end if
    if latest <> invalid and CompareSemanticVersions(current, latest) < 0
        result.available = true
    end if
    if versionResponse.message <> invalid then result.message = versionResponse.message
    if versionResponse.releaseNotes <> invalid then result.releaseNotes = versionResponse.releaseNotes
    return result
end function

