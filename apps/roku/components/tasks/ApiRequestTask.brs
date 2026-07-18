sub init()
    m.top.functionName = "executeRequest"
end sub

sub executeRequest()
    input = m.top.request
    if input = invalid or input.url = invalid
        m.top.failure = { code: "REQUEST_INVALID", message: "The request is incomplete.", retryable: false }
        return
    end if

    result = PerformJsonRequest(input, 12000)
    status = result.status
    parsed = result.data
    if status >= 200 and status < 300 and parsed <> invalid
        m.top.response = { status: status, data: parsed }
        return
    end if

    failure = MapApiFailure(status, parsed)
    LogEvent("error", "network", "request_failed", { status: status, code: failure.code, reason: result.failureReason })
    m.top.failure = failure
end sub
