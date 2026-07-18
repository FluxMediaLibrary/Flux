sub init()
    m.top.functionName = "executeRequest"
end sub

sub executeRequest()
    input = m.top.request
    if input = invalid or input.url = invalid
        m.top.failure = { code: "REQUEST_INVALID", message: "The request is incomplete.", retryable: false }
        return
    end if

    transfer = CreateObject("roUrlTransfer")
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
    transfer.SetConnectTimeout(10)
    transfer.SetMinimumTransferRate(1, 20)

    body = ""
    if input.body <> invalid
        transfer.AddHeader("Content-Type", "application/json")
        body = FormatJson(input.body)
    end if

    if body = "" then raw = transfer.GetToString() else raw = transfer.PostFromString(body)
    status = transfer.GetResponseCode()
    parsed = SafeJsonParse(raw)
    if status >= 200 and status < 300 and parsed <> invalid
        m.top.response = { status: status, data: parsed }
        return
    end if

    failure = MapApiFailure(status, parsed)
    LogEvent("error", "network", "request_failed", { status: status, code: failure.code })
    m.top.failure = failure
end sub
