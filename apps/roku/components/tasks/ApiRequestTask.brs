sub init()
    m.top.functionName = "executeRequest"
end sub

sub executeRequest()
    input = m.top.request
    if input = invalid or input.url = invalid
        m.top.failure = { code: "REQUEST_INVALID", message: "The request is incomplete.", retryable: false }
        return
    end if
    if m.top.bodyJson <> "" then input.bodyJson = m.top.bodyJson

    result = PerformJsonRequest(input, 12000)
    status = result.status
    parsed = result.data
    if status >= 200 and status < 300
        if IsAssociativeArray(parsed)
            m.top.response = { status: status, data: parsed }
            return
        end if
        failure = { status: status, code: "RESPONSE_INVALID", message: "Flux returned an invalid response. Try again.", retryable: true }
        LogEvent("error", "network", "response_invalid", { status: status })
        m.top.failure = failure
        return
    end if

    failure = MapApiFailure(status, parsed)
    LogEvent("error", "network", "request_failed", { status: status, code: failure.code, reason: result.failureReason })
    m.top.failure = failure
end sub
