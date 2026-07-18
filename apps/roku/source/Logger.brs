sub LogEvent(severity as String, category as String, eventName as String, details = invalid as Dynamic)
    clock = CreateObject("roDateTime")
    safeDetails = SanitizeLogValue(details)
    line = FormatJson({
        timestamp: clock.ToISOString()
        severity: severity
        category: category
        event: eventName
        details: safeDetails
    })
    print line
    if ShouldPersistLog(severity) then AppendLocalLog(line)
end sub

function ShouldPersistLog(severity as String) as Boolean
    if severity = "error" or severity = "warn" then return true
    section = CreateObject("roRegistrySection", "flux")
    preferences = SafeJsonParse(section.Read("preferences"))
    return preferences <> invalid and preferences.diagnostics = true
end function

sub AppendLocalLog(line as String)
    section = CreateObject("roRegistrySection", "flux_logs")
    entries = SafeJsonParse(section.Read("events"))
    if entries = invalid then entries = []
    entries.Push(line)
    while entries.Count() > 50
        entries.Shift()
    end while
    section.Write("events", FormatJson(entries))
    section.Flush()
end sub

function ReadLocalLogText(limit as Integer) as String
    section = CreateObject("roRegistrySection", "flux_logs")
    entries = SafeJsonParse(section.Read("events"))
    if entries = invalid or entries.Count() = 0 then return "No diagnostic events have been retained."
    first = entries.Count() - limit
    if first < 0 then first = 0
    output = ""
    for index = first to entries.Count() - 1
        if output <> "" then output = output + Chr(10)
        output = output + entries[index]
    end for
    return output
end function

sub ClearLocalLogs()
    section = CreateObject("roRegistrySection", "flux_logs")
    section.Delete("events")
    section.Flush()
end sub

function SanitizeLogValue(value as Dynamic) as Dynamic
    if value = invalid then return invalid
    if IsAssociativeArray(value)
        safe = {}
        for each key in value
            lowerKey = LCase(key)
            if lowerKey.InStr("token") < 0 and lowerKey.InStr("password") < 0 and lowerKey.InStr("code") < 0 and lowerKey.InStr("authorization") < 0 and lowerKey.InStr("url") < 0
                safe[key] = SanitizeLogValue(value[key])
            end if
        end for
        return safe
    end if
    if GetInterface(value, "ifArray") <> invalid
        safeItems = []
        for each item in value
            safeItems.Push(SanitizeLogValue(item))
        end for
        return safeItems
    end if
    return value
end function
