sub init()
    m.top.functionName = "poll"
end sub

sub poll()
    interval = m.top.pollInterval
    if interval < 3 then interval = 5
    while true
        Sleep(interval * 1000)
        transfer = CreateObject("roUrlTransfer")
        transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
        transfer.InitClientCertificates()
        transfer.SetUrl(m.top.url)
        transfer.SetRequest("POST")
        transfer.AddHeader("Accept", "application/json")
        transfer.AddHeader("Content-Type", "application/json")
        transfer.SetConnectTimeout(10)
        transfer.SetMinimumTransferRate(1, 20)
        raw = transfer.PostFromString(FormatJson({ deviceCode: m.top.deviceCode }))
        status = transfer.GetResponseCode()
        data = SafeJsonParse(raw)
        if status = 0 or status >= 500
            m.top.failure = { code: "DEVICE_POLL_NETWORK", message: "The server connection was interrupted while linking.", retryable: true }
            return
        end if
        if status < 200 or status >= 300 or data = invalid
            m.top.failure = { code: "DEVICE_POLL_INVALID", message: "The server returned an invalid device-link response.", retryable: true }
            return
        end if
        if data.state = "slow_down"
            if data.pollInterval <> invalid then interval = data.pollInterval else interval = interval + 2
        else if data.state = "pending"
            if data.pollInterval <> invalid then interval = data.pollInterval
        else
            m.top.result = data
            return
        end if
    end while
end sub

