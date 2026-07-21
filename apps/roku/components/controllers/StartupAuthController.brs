sub onLaunchArgs()
    if m.top.launchArgs <> invalid and m.top.launchArgs.contentId <> invalid
        m.pendingDeepLink = m.top.launchArgs
        if m.state = "READY" and m.registry.accessToken <> "" then openPendingDeepLink()
    end if
end sub

sub openPendingDeepLink()
    if m.pendingDeepLink = invalid or m.pendingDeepLink.contentId = invalid then return
    contentId = m.pendingDeepLink.contentId
    m.pendingDeepLink = invalid
    loadMediaDetail(contentId)
end sub

sub beginStartup()
    m.watchdog.control = "stop"
    m.watchdog.control = "start"
    m.state = "LOADING_REGISTRY"
    if m.registry.serverUrl = ""
        m.state = "READY"
        showServerSetup()
        return
    end if
    validateServer(m.registry.serverUrl)
end sub

sub showServerSetup()
    screen = showScreen("ServerSetupScreen")
    screen.observeField("serverSubmitted", "onServerSubmitted")
end sub

sub onServerSubmitted(event as Object)
    m.registry.serverUrl = event.GetData()
    validateServer(m.registry.serverUrl)
end sub

sub validateServer(serverUrl as String)
    m.state = "CHECKING_NETWORK"
    device = CreateObject("roDeviceInfo")
    if device.GetLinkStatus() <> true
        showError("No network connection", "Connect this Roku to the network, then try again.", true, "retryStartup")
        return
    end if
    m.state = "VALIDATING_SERVER"
    LogEvent("info", "server", "validation_started")
    runRequest({ url: JoinUrl(serverUrl, m.routes.bootstrap), method: "GET" }, "onBootstrapLoaded", "onBootstrapFailed")
end sub

sub onBootstrapLoaded(event as Object)
    response = event.GetData()
    data = response.data
    if not IsAssociativeArray(data)
        showCompatibility("This server returned invalid Flux Roku bootstrap data.")
        return
    end if
    incompatibleApi = data.apiVersion = invalid
    if data.apiVersion <> invalid
        if data.apiVersion < 1 then incompatibleApi = true
    end if
    if data.minimumApiVersion <> invalid and data.minimumApiVersion > 1 then incompatibleApi = true
    supportsDeviceLink = data.authentication <> invalid and data.authentication.deviceLink = true
    if data.product <> "flux" or data.serverId = invalid or incompatibleApi or data.rokuSupported <> true or not supportsDeviceLink
        showCompatibility("This server is not a compatible Flux Roku server.")
        return
    end if
    m.bootstrap = data
    LogEvent("info", "server", "validation_succeeded", { serverId: data.serverId, version: data.serverVersion })
    if data.branding <> invalid
        if data.branding.backgroundColor <> invalid
            canvas = m.top.findNode("background").findNode("canvas")
            if canvas <> invalid then canvas.color = data.branding.backgroundColor
        end if
        if data.branding.accentColor <> invalid then m.accentColor = data.branding.accentColor
    end if
    WriteServerState({ url: m.registry.serverUrl, id: data.serverId, name: data.serverName })
    m.state = "CHECKING_VERSION"
    runRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.version), method: "GET" }, "onVersionLoaded", "onVersionFailed")
end sub

sub onBootstrapFailed(event as Object)
    failure = event.GetData()
    LogEvent("error", "server", "validation_failed", { status: failure.status })
    showError("Server unavailable", failure.message, failure.retryable, "retryStartup")
end sub

sub onVersionLoaded(event as Object)
    data = event.GetData().data
    if not IsAssociativeArray(data)
        showError("Version check unavailable", "Flux returned invalid Roku version data. Try again.", true, "retryStartup")
        return
    end if
    decision = EvaluateVersion(data)
    m.versionDecision = decision
    m.versionData = data
    LogEvent("info", "version", "version_checked", { required: decision.required, available: decision.available })
    if decision.required
        screen = showScreen("MessageScreen")
        screen.title = "Update required"
        screen.message = decision.message
        screen.actions = ["Retry", "Remove server"]
        screen.observeField("actionSelected", "onRequiredUpdateAction")
        return
    end if
    loadClientConfig()
end sub

sub onVersionFailed(event as Object)
    loadClientConfig()
end sub

sub loadClientConfig()
    runRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.config), method: "GET" }, "onClientConfigLoaded", "onClientConfigFailed")
end sub

sub onClientConfigLoaded(event as Object)
    data = event.GetData().data
    if not IsAssociativeArray(data)
        m.clientConfig = invalid
        validateAuthentication()
        return
    end if
    m.clientConfig = data
    if m.clientConfig.features <> invalid then m.bootstrap.features = m.clientConfig.features
    if m.clientConfig.minimumServerVersion <> invalid and CompareSemanticVersions(m.bootstrap.serverVersion, m.clientConfig.minimumServerVersion) < 0
        showCompatibility("This Flux server is too old for the Roku client. Update the server and try again.")
        return
    end if
    validateAuthentication()
end sub

sub onClientConfigFailed(event as Object)
    m.clientConfig = invalid
    validateAuthentication()
end sub

sub validateAuthentication()
    m.state = "VALIDATING_AUTH"
    if m.registry.accessToken = ""
        showDeviceLink()
        return
    end if
    loadProfiles()
end sub

sub showDeviceLink()
    m.state = "VALIDATING_AUTH"
    device = CreateObject("roDeviceInfo")
    body = {
        deviceName: "Roku " + device.GetModelDisplayName()
        platform: "roku"
        deviceId: m.registry.deviceId
        appVersion: AppVersion()
    }
    runRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.createDevice), method: "POST", body: body }, "onDeviceCode", "onDeviceCodeFailed")
end sub

sub onDeviceCode(event as Object)
    data = event.GetData().data
    if not IsAssociativeArray(data) or data.deviceCode = invalid or data.userCode = invalid or data.verificationUrl = invalid
        showError("Device link unavailable", "Flux returned incomplete device-link data. Try again.", true, "retryDeviceLink")
        return
    end if
    LogEvent("info", "authentication", "device_link_started", { expiresIn: data.expiresIn })
    screen = showScreen("DeviceLinkScreen")
    screen.linkData = data
    screen.serverName = m.bootstrap.serverName
    screen.observeField("retryRequested", "retryDeviceLink")
    polling = CreateObject("roSGNode", "DeviceLinkPollingTask")
    polling.url = JoinUrl(m.registry.serverUrl, m.routes.deviceStatus)
    polling.deviceCode = data.deviceCode
    polling.pollInterval = data.pollInterval
    polling.observeField("result", "onDeviceLinkResult")
    polling.observeField("failure", "onDeviceLinkPollFailure")
    m.devicePollingTask = polling
    polling.control = "RUN"
end sub

sub onDeviceLinkResult(event as Object)
    data = event.GetData()
    if data.state = "approved"
        LogEvent("info", "authentication", "device_link_approved")
        m.account = data.account
        m.registry.accessToken = data.accessToken
        m.registry.refreshToken = data.refreshToken
        WriteAuthState(data.accessToken, data.refreshToken)
        loadProfiles()
    else if data.state = "denied"
        showError("Link denied", "This Roku was not granted access.", true, "retryDeviceLink")
    else
        showError("Code expired", "The device code expired before it was approved.", true, "retryDeviceLink")
    end if
end sub

sub onDeviceLinkPollFailure(event as Object)
    failure = event.GetData()
    showError("Link interrupted", failure.message, failure.retryable, "retryDeviceLink")
end sub

sub onDeviceCodeFailed(event as Object)
    failure = event.GetData()
    showError("Device link unavailable", failure.message, failure.retryable, "retryDeviceLink")
end sub

sub retryDeviceLink()
    if m.devicePollingTask <> invalid then m.devicePollingTask.control = "STOP"
    showDeviceLink()
end sub

sub loadProfiles()
    m.state = "LOADING_PROFILES"
    runRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.profiles), method: "GET", token: m.registry.accessToken }, "onProfilesLoaded", "onAuthorizedFailure")
end sub

sub onProfilesLoaded(event as Object)
    payload = event.GetData().data
    if not IsAssociativeArray(payload) or not IsArray(payload.profiles)
        showError("Profiles unavailable", "Flux returned incomplete profile data. Try again.", true, "loadProfiles")
        return
    end if
    profiles = payload.profiles
    if profiles = invalid or profiles.Count() = 0
        LogEvent("warn", "authentication", "profiles_empty", {})
        showError("No profiles available", "This Flux account has no available profiles. Check the account on the Flux server, then try again.", true, "loadProfiles")
        return
    end if
    m.account = payload.account
    m.profiles = profiles
    LogEvent("info", "authentication", "profiles_loaded", { count: profiles.Count() })
    if profiles.Count() = 1
        selectProfile(profiles[0].id)
        return
    end if
    screen = showScreen("ProfileSelectionScreen")
    screen.profiles = profiles
    screen.observeField("profileSelected", "onProfileSelected")
end sub

sub onProfileSelected(event as Object)
    selectProfile(event.GetData())
end sub

sub selectProfile(profileId as String)
    runRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.selectProfile), method: "POST", token: m.registry.accessToken, body: { profileId: profileId } }, "onProfileActivated", "onAuthorizedFailure")
end sub

sub onProfileActivated(event as Object)
    data = event.GetData().data
    if not IsAssociativeArray(data) or data.accessToken = invalid or data.refreshToken = invalid or not IsAssociativeArray(data.profile) or data.profile.id = invalid
        showError("Profile setup failed", "Flux returned incomplete profile activation data. Try selecting the profile again.", true, "loadProfiles")
        return
    end if
    if data.accessToken <> invalid then m.registry.accessToken = data.accessToken
    if data.refreshToken <> invalid then m.registry.refreshToken = data.refreshToken
    m.registry.profileId = data.profile.id
    m.currentProfile = data.profile
    LogEvent("info", "authentication", "profile_selected", { profileId: data.profile.id })
    WriteAuthState(m.registry.accessToken, m.registry.refreshToken)
    WriteProfileId(data.profile.id)
    if m.pendingDeepLink <> invalid then openPendingDeepLink() else loadHome()
end sub

sub onLogoutComplete(event as Object)
    ClearAuthentication()
    m.registry.accessToken = ""
    m.registry.refreshToken = ""
    m.registry.profileId = ""
    if m.pendingSettingsAction = "server" or m.pendingSettingsAction = "remove_server"
        ClearServer()
        m.registry = ReadRegistryState()
        retryStartup()
    else
        showDeviceLink()
    end if
end sub

sub onAuthorizedFailure(event as Object)
    failure = event.GetData()
    if (failure.status = 401 or failure.status = 403) and m.registry.refreshToken <> ""
        refreshAuthentication()
    else if failure.status = 401 or failure.status = 403
        ClearAuthentication()
        m.registry.accessToken = ""
        m.registry.refreshToken = ""
        showDeviceLink()
    else
        showError("Flux could not load", failure.message, failure.retryable, "retryStartup")
    end if
end sub

sub refreshAuthentication()
    body = { refreshToken: m.registry.refreshToken, deviceId: m.registry.deviceId }
    runRequest({ url: JoinUrl(m.registry.serverUrl, m.routes.refresh), method: "POST", body: body }, "onAuthenticationRefreshed", "onRefreshFailed")
end sub

sub onAuthenticationRefreshed(event as Object)
    data = event.GetData().data
    if not IsAssociativeArray(data) or data.accessToken = invalid or data.refreshToken = invalid
        onRefreshFailed(event)
        return
    end if
    m.registry.accessToken = data.accessToken
    m.registry.refreshToken = data.refreshToken
    WriteAuthState(data.accessToken, data.refreshToken)
    if m.registry.profileId <> "" then loadHome() else loadProfiles()
end sub

sub onRefreshFailed(event as Object)
    ClearAuthentication()
    m.registry.accessToken = ""
    m.registry.refreshToken = ""
    showDeviceLink()
end sub
