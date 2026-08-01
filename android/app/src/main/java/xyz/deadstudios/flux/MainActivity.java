package xyz.deadstudios.flux;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.WindowInsetsCompat;
import androidx.mediarouter.app.MediaRouteButton;

import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.MediaStatus;
import com.google.android.gms.cast.framework.CastButtonFactory;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.images.WebImage;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends AppCompatActivity {
    private static final String TAG = "FluxAndroid";
    private static final int FILE_CHOOSER_REQUEST = 7001;

    private WebView webView;
    private FrameLayout root;
    private ProgressBar progressBar;
    private LinearLayout errorPanel;
    private TextView errorTitle;
    private TextView errorDetail;
    private MediaRouteButton mediaRouteButton;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private ValueCallback<Uri[]> filePathCallback;

    private CastContext castContext;
    private SessionManager sessionManager;
    private NativePlaybackContext playbackContext;
    private NativePlaybackContext pendingCastContext;
    private NativePlaybackContext activeCastContext;
    private CastPlaybackInfo activeCastInfo;
    private RemoteMediaClient observedRemoteMediaClient;
    private double castTimelineOffsetSeconds;
    private volatile String lastCastStateJson = "{}";
    private boolean castLaunchRequested;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final RemoteMediaClient.Callback remoteMediaCallback = new RemoteMediaClient.Callback() {
        @Override public void onStatusUpdated() { publishCastPlaybackState(); }
        @Override public void onMetadataUpdated() { publishCastPlaybackState(); }
        @Override public void onQueueStatusUpdated() { publishCastPlaybackState(); }
    };
    private final RemoteMediaClient.ProgressListener remoteProgressListener = (progressMs, durationMs) -> publishCastPlaybackState();

    private final SessionManagerListener<CastSession> castSessionListener = new SessionManagerListener<CastSession>() {
        @Override public void onSessionStarted(@NonNull CastSession session, @NonNull String sessionId) {
            Log.i(TAG, "Cast session started: " + sessionId);
            observeRemoteMediaClient(session);
            notifyCastState("connected", null);
            if (castLaunchRequested) loadPendingCastMedia();
        }
        @Override public void onSessionStartFailed(@NonNull CastSession session, int error) {
            Log.e(TAG, "Cast session start failed: " + error);
            notifyCastError("Cast session failed: " + error);
        }
        @Override public void onSessionEnded(@NonNull CastSession session, int error) {
            Log.i(TAG, "Cast session ended reason=" + error);
            detachRemoteMediaClient();
            activeCastContext = null;
            activeCastInfo = null;
            castTimelineOffsetSeconds = 0;
            notifyCastState("disconnected", String.valueOf(error));
        }
        @Override public void onSessionResumed(@NonNull CastSession session, boolean wasSuspended) {
            Log.i(TAG, "Cast session resumed suspended=" + wasSuspended);
            observeRemoteMediaClient(session);
            notifyCastState("connected", null);
            notifyCastState("connected", "session-restored");
        }
        @Override public void onSessionResumeFailed(@NonNull CastSession session, int error) {
            Log.e(TAG, "Cast session resume failed: " + error);
            notifyCastError("Cast resume failed: " + error);
        }
        @Override public void onSessionSuspended(@NonNull CastSession session, int reason) {
            Log.w(TAG, "Cast session suspended: " + reason);
            notifyCastState("suspended", String.valueOf(reason));
        }
        @Override public void onSessionStarting(@NonNull CastSession session) { Log.i(TAG, "Cast session starting"); }
        @Override public void onSessionEnding(@NonNull CastSession session) { Log.i(TAG, "Cast session ending"); }
        @Override public void onSessionResuming(@NonNull CastSession session, @NonNull String sessionId) { Log.i(TAG, "Cast session resuming: " + sessionId); }
    };

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWindow();
        buildUi();
        configureCast();
        configureWebView();

        if (savedInstanceState != null) {
            Log.i(TAG, "Restoring WebView state");
            webView.restoreState(savedInstanceState);
        } else {
            loadStartUrl();
        }
    }

    private void configureWindow() {
        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(getColor(R.color.flux_bg));
        WindowCompat.setDecorFitsSystemWindows(window, false);
    }

    private void buildUi() {
        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.flux_bg));
        setContentView(root);

        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(3),
            Gravity.TOP
        );
        root.addView(progressBar, progressParams);

        mediaRouteButton = new MediaRouteButton(this);
        mediaRouteButton.setAlpha(0f);
        mediaRouteButton.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        FrameLayout.LayoutParams castParams = new FrameLayout.LayoutParams(dp(1), dp(1), Gravity.BOTTOM | Gravity.START);
        root.addView(mediaRouteButton, castParams);

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(28), dp(28), dp(28), dp(28));
        errorPanel.setBackgroundColor(getColor(R.color.flux_bg));
        errorPanel.setVisibility(View.GONE);

        errorTitle = new TextView(this);
        errorTitle.setTextColor(getColor(R.color.flux_text));
        errorTitle.setTextSize(20);
        errorTitle.setGravity(Gravity.CENTER);
        errorPanel.addView(errorTitle);

        errorDetail = new TextView(this);
        errorDetail.setTextColor(getColor(R.color.flux_muted));
        errorDetail.setTextSize(14);
        errorDetail.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        detailParams.setMargins(0, dp(12), 0, dp(20));
        errorPanel.addView(errorDetail, detailParams);

        Button retry = new Button(this);
        retry.setText("Retry");
        retry.setOnClickListener(view -> loadStartUrl());
        errorPanel.addView(retry);

        Button changeServer = new Button(this);
        changeServer.setText("Change URL");
        changeServer.setOnClickListener(view -> showServerUrlPrompt(true));
        errorPanel.addView(changeServer);

        root.addView(errorPanel, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets statusBars = insets.getInsets(WindowInsetsCompat.Type.statusBars());
            Insets navigationBars = insets.getInsets(WindowInsetsCompat.Type.navigationBars());

            FrameLayout.LayoutParams webParams = (FrameLayout.LayoutParams) webView.getLayoutParams();
            webParams.topMargin = statusBars.top;
            webParams.bottomMargin = navigationBars.bottom;
            webView.setLayoutParams(webParams);
            webView.setPadding(0, 0, 0, 0);

            FrameLayout.LayoutParams progressLayoutParams = (FrameLayout.LayoutParams) progressBar.getLayoutParams();
            progressLayoutParams.topMargin = statusBars.top;
            progressBar.setLayoutParams(progressLayoutParams);

            errorPanel.setPadding(dp(28), statusBars.top + dp(28), dp(28), navigationBars.bottom + dp(28));
            return insets;
        });
    }

    private void configureCast() {
        try {
            castContext = CastContext.getSharedInstance(this);
            sessionManager = castContext.getSessionManager();
            CastButtonFactory.setUpMediaRouteButton(getApplicationContext(), mediaRouteButton);
            Log.i(TAG, "CastContext initialized");
            CastSession currentSession = sessionManager.getCurrentCastSession();
            if (currentSession != null && currentSession.isConnected()) {
                observeRemoteMediaClient(currentSession);
            }
        } catch (Exception error) {
            Log.e(TAG, "CastContext initialization failed", error);
            mediaRouteButton.setVisibility(View.GONE);
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureWebView() {
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSafeBrowsingEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " FluxAndroid/" + BuildConfig.VERSION_NAME);

        webView.setBackgroundColor(getColor(R.color.flux_bg));
        webView.addJavascriptInterface(new FluxNativeBridge(this), "FluxNative");
        webView.setWebViewClient(new FluxWebViewClient());
        webView.setWebChromeClient(new FluxWebChromeClient());
    }

    private void loadStartUrl() {
        errorPanel.setVisibility(View.GONE);
        String url = FluxServerConfig.getStartUrl(this);
        if (url == null) {
            showServerUrlPrompt(false);
            return;
        }
        if (!isOnline()) {
            showError("Offline", "No network connection is available.");
            return;
        }
        Log.i(TAG, "Loading start URL: " + redact(url));
        webView.loadUrl(url);
    }

    private void showServerUrlPrompt(boolean allowCancel) {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("https://domain.com or http://102.3.214.3");
        input.setText(FluxServerConfig.getBaseUrl(this) == null ? "" : FluxServerConfig.getBaseUrl(this));
        input.setSelectAllOnFocus(true);

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Flux server URL")
            .setMessage("Enter the URL for your Flux web app.")
            .setView(input)
            .setPositiveButton("Continue", null)
            .setNegativeButton(allowCancel ? "Cancel" : "Exit", (d, which) -> {
                if (!allowCancel) finish();
            })
            .setCancelable(allowCancel)
            .create();

        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            try {
                FluxServerConfig.setBaseUrl(this, input.getText().toString());
                dialog.dismiss();
                loadStartUrl();
            } catch (IllegalArgumentException error) {
                input.setError(error.getMessage());
            }
        }));
        dialog.show();
    }

    private boolean isOnline() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        if (manager == null) return true;
        NetworkCapabilities caps = manager.getNetworkCapabilities(manager.getActiveNetwork());
        return caps != null && (
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
        );
    }

    private boolean isAllowedInternalUrl(Uri uri) {
        return FluxServerConfig.isConfiguredInternalUrl(this, uri);
    }

    private void openExternal(Uri uri) {
        Log.i(TAG, "Opening external URL: " + redact(uri.toString()));
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException error) {
            Log.e(TAG, "No external browser for URL", error);
            showError("Cannot open link", "No app is available to open this link.");
        }
    }

    void updatePlaybackContext(NativePlaybackContext context) {
        playbackContext = context;
        Log.d(TAG, "Updated native playback context mediaId=" + context.mediaItemId + " episodeId=" + context.episodeId);
    }

    void requestCastFromWeb() {
        if (playbackContext == null) {
            notifyCastError("Open a movie or episode before starting Cast");
            return;
        }

        pendingCastContext = playbackContext;
        castLaunchRequested = true;
        notifyCastState("connecting", null);

        CastSession session = sessionManager != null ? sessionManager.getCurrentCastSession() : null;
        if (session != null && session.isConnected()) {
            if (activeCastContext != null && sameMedia(activeCastContext, playbackContext)) {
                castLaunchRequested = false;
                pendingCastContext = null;
                mediaRouteButton.performClick();
                publishCastPlaybackState();
                return;
            }
            loadPendingCastMedia();
            return;
        }

        if (mediaRouteButton == null || !mediaRouteButton.performClick()) {
            notifyCastError("Cast is unavailable on this device");
        }
    }

    void loadCastMediaFromWeb(NativePlaybackContext context) {
        playbackContext = context;
        pendingCastContext = context;
        castLaunchRequested = true;
        Log.i(TAG, "Loading selected Cast media mediaId=" + context.mediaItemId
            + " episodeId=" + context.episodeId + " position=" + context.currentTimeSeconds);

        CastSession session = currentCastSession();
        if (session != null) {
            notifyCastState("loading-media", null);
            loadPendingCastMedia();
            return;
        }
        requestCastFromWeb();
    }

    private boolean sameMedia(NativePlaybackContext left, NativePlaybackContext right) {
        if (!left.mediaItemId.equals(right.mediaItemId)) return false;
        if (left.episodeId == null) return right.episodeId == null;
        return left.episodeId.equals(right.episodeId);
    }

    private void loadPendingCastMedia() {
        NativePlaybackContext request = pendingCastContext;
        CastSession session = sessionManager != null ? sessionManager.getCurrentCastSession() : null;
        if (request == null || session == null || !session.isConnected()) return;

        readLocalStorageToken(token -> {
            if (token == null || token.isEmpty()) {
                notifyCastError("Sign in before casting");
                return;
            }
            networkExecutor.execute(() -> {
                try {
                    CastPlaybackInfo info = fetchCastPlaybackInfo(request, token);
                    main.post(() -> loadMediaOnReceiver(session, request, info));
                } catch (Exception error) {
                    Log.e(TAG, "Cast preparation failed", error);
                    main.post(() -> notifyCastError("Cast preparation failed: " + error.getMessage()));
                }
            });
        });
    }

    private void readLocalStorageToken(ValueCallback<String> callback) {
        webView.evaluateJavascript("window.localStorage && window.localStorage.getItem('flux.token')", raw -> {
            try {
                if (raw == null || "null".equals(raw)) {
                    callback.onReceiveValue(null);
                } else {
                    callback.onReceiveValue(new JSONArray("[" + raw + "]").getString(0));
                }
            } catch (Exception error) {
                Log.e(TAG, "Could not read Flux token from WebView", error);
                callback.onReceiveValue(null);
            }
        });
    }

    private CastPlaybackInfo fetchCastPlaybackInfo(NativePlaybackContext request, String token) throws Exception {
        String url = FluxServerConfig.requireBaseUrl(this) + "/api/cast/sessions";
        Log.i(TAG, "Creating scoped cast session at " + redact(url));
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(20000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Authorization", "Bearer " + token);
        JSONObject payload = new JSONObject();
        payload.put("mediaItemId", request.mediaItemId);
        if (request.episodeId != null) payload.put("episodeId", request.episodeId);
        payload.put("positionSeconds", request.currentTimeSeconds);
        connection.getOutputStream().write(payload.toString().getBytes(StandardCharsets.UTF_8));
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        String body = readAll(stream);
        if (status < 200 || status >= 300) {
            throw new IllegalStateException("Backend returned HTTP " + status + ": " + body);
        }
        return CastPlaybackInfo.fromJson(body);
    }

    private String readAll(InputStream stream) throws Exception {
        if (stream == null) return "";
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
        StringBuilder builder = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) builder.append(line);
        return builder.toString();
    }

    private void loadMediaOnReceiver(CastSession session, NativePlaybackContext request, CastPlaybackInfo info) {
        RemoteMediaClient client = session.getRemoteMediaClient();
        if (client == null) {
            notifyCastError("Remote media client is unavailable");
            return;
        }
        observeRemoteMediaClient(session);
        MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE);
        metadata.putString(MediaMetadata.KEY_TITLE, info.title);
        if (info.subtitle != null && !"null".equals(info.subtitle)) {
            metadata.putString(MediaMetadata.KEY_SUBTITLE, info.subtitle);
        }
        if (info.posterUrl != null && !"null".equals(info.posterUrl)) {
            metadata.addImage(new WebImage(Uri.parse(info.posterUrl)));
        }

        JSONObject customData = new JSONObject();
        try {
            customData.put("fluxMediaItemId", request.mediaItemId);
            customData.put("fluxEpisodeId", request.episodeId == null ? JSONObject.NULL : request.episodeId);
            customData.put("fluxTimelineOffsetSeconds", "hls".equals(info.method) ? request.currentTimeSeconds : 0);
        } catch (Exception error) {
            Log.w(TAG, "Could not attach Flux Cast media identity", error);
        }

        MediaInfo.Builder mediaBuilder = new MediaInfo.Builder(info.url)
            .setContentUrl(info.url)
            .setContentType(info.contentType)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setCustomData(customData)
            .setMetadata(metadata);
        if (info.durationSeconds > 0) {
            mediaBuilder.setStreamDuration((long) (info.durationSeconds * 1000));
        }

        long startMs = "direct".equals(info.method) ? (long) (request.currentTimeSeconds * 1000) : 0;
        MediaLoadRequestData loadRequest = new MediaLoadRequestData.Builder()
            .setMediaInfo(mediaBuilder.build())
            .setAutoplay(true)
            .setCurrentTime(startMs)
            .build();

        Log.i(TAG, "Loading Cast receiver media mode=" + info.method + " contentType=" + info.contentType + " url=" + redact(info.url));
        client.load(loadRequest).addStatusListener(status -> {
            if (!status.isSuccess()) {
                Log.e(TAG, "Receiver rejected load status=" + status.getStatusCode());
                notifyCastError("Receiver rejected media: " + status.getStatusCode());
            } else {
                activeCastContext = request;
                activeCastInfo = info;
                castTimelineOffsetSeconds = "hls".equals(info.method) ? request.currentTimeSeconds : 0;
                if (pendingCastContext == request) {
                    pendingCastContext = null;
                    castLaunchRequested = false;
                }
                notifyCastState("media-loaded", info.method);
                publishCastPlaybackState();
                webView.evaluateJavascript("document.dispatchEvent(new CustomEvent('flux:native-cast-local-pause'))", null);
            }
        });
    }

    private void observeRemoteMediaClient(CastSession session) {
        RemoteMediaClient client = session.getRemoteMediaClient();
        if (client == observedRemoteMediaClient) {
            publishCastPlaybackState();
            return;
        }
        detachRemoteMediaClient();
        observedRemoteMediaClient = client;
        if (client != null) {
            client.registerCallback(remoteMediaCallback);
            client.addProgressListener(remoteProgressListener, 1000);
        }
        publishCastPlaybackState();
    }

    private void detachRemoteMediaClient() {
        if (observedRemoteMediaClient == null) return;
        observedRemoteMediaClient.unregisterCallback(remoteMediaCallback);
        observedRemoteMediaClient.removeProgressListener(remoteProgressListener);
        observedRemoteMediaClient = null;
    }

    void playCastMedia() {
        RemoteMediaClient client = currentRemoteMediaClient();
        if (client == null || client.getMediaInfo() == null) {
            notifyCastError("No Cast media is loaded");
            return;
        }
        client.play();
        publishCastPlaybackState();
    }

    void pauseCastMedia() {
        RemoteMediaClient client = currentRemoteMediaClient();
        if (client == null || client.getMediaInfo() == null) {
            notifyCastError("No Cast media is loaded");
            return;
        }
        client.pause();
        publishCastPlaybackState();
    }

    void seekCastMedia(double positionSeconds) {
        if (!Double.isFinite(positionSeconds) || positionSeconds < 0) {
            notifyCastError("Invalid Cast seek position");
            return;
        }
        RemoteMediaClient client = currentRemoteMediaClient();
        if (client == null || client.getMediaInfo() == null) {
            notifyCastError("No Cast media is loaded");
            return;
        }

        // A Flux HLS URL is generated from one absolute source position. Reload
        // it for arbitrary seeks so forward/back and Skip Intro are not limited
        // to the receiver's currently generated playlist window.
        if (activeCastInfo != null && "hls".equals(activeCastInfo.method) && activeCastContext != null) {
            pendingCastContext = activeCastContext.withPosition(positionSeconds);
            castLaunchRequested = true;
            notifyCastState("seeking", String.valueOf(positionSeconds));
            loadPendingCastMedia();
            return;
        }

        client.seek((long) (positionSeconds * 1000));
        publishCastPlaybackState();
    }

    void setCastVolume(double volume) {
        CastSession session = currentCastSession();
        if (session == null) return;
        try {
            session.setVolume(Math.max(0, Math.min(1, volume)));
            main.postDelayed(this::publishCastPlaybackState, 250);
        } catch (Exception error) {
            Log.w(TAG, "Could not set Cast volume", error);
            notifyCastError("The TV volume could not be changed");
        }
    }

    void toggleCastMute() {
        CastSession session = currentCastSession();
        if (session == null) return;
        try {
            session.setMute(!session.isMute());
            main.postDelayed(this::publishCastPlaybackState, 250);
        } catch (Exception error) {
            Log.w(TAG, "Could not change Cast mute state", error);
            notifyCastError("The TV mute state could not be changed");
        }
    }

    void disconnectCast() {
        if (sessionManager != null) sessionManager.endCurrentSession(true);
    }

    String getCastStateJson() {
        return lastCastStateJson;
    }

    private CastSession currentCastSession() {
        CastSession session = sessionManager != null ? sessionManager.getCurrentCastSession() : null;
        return session != null && session.isConnected() ? session : null;
    }

    private RemoteMediaClient currentRemoteMediaClient() {
        CastSession session = currentCastSession();
        return session != null ? session.getRemoteMediaClient() : null;
    }

    private String castPlayerStateName(int state) {
        if (state == MediaStatus.PLAYER_STATE_PLAYING) return "PLAYING";
        if (state == MediaStatus.PLAYER_STATE_PAUSED) return "PAUSED";
        if (state == MediaStatus.PLAYER_STATE_BUFFERING) return "BUFFERING";
        if (state == MediaStatus.PLAYER_STATE_IDLE) return "IDLE";
        return "UNKNOWN";
    }

    private JSONObject buildCastStatePayload() throws Exception {
        JSONObject payload = new JSONObject();
        CastSession session = currentCastSession();
        RemoteMediaClient client = session != null ? session.getRemoteMediaClient() : null;
        MediaInfo receiverInfo = client != null ? client.getMediaInfo() : null;
        MediaStatus status = client != null ? client.getMediaStatus() : null;
        JSONObject customData = receiverInfo != null ? receiverInfo.getCustomData() : null;
        boolean mediaLoaded = receiverInfo != null;
        double receiverPosition = client != null ? Math.max(0, client.getApproximateStreamPosition() / 1000.0) : 0;
        double duration = activeCastInfo != null && activeCastInfo.durationSeconds > 0
            ? activeCastInfo.durationSeconds
            : receiverInfo != null && receiverInfo.getStreamDuration() > 0
                ? receiverInfo.getStreamDuration() / 1000.0
                : 0;
        MediaMetadata metadata = receiverInfo != null ? receiverInfo.getMetadata() : null;
        String title = activeCastInfo != null ? activeCastInfo.title : metadata != null ? metadata.getString(MediaMetadata.KEY_TITLE) : null;
        String subtitle = activeCastInfo != null ? activeCastInfo.subtitle : metadata != null ? metadata.getString(MediaMetadata.KEY_SUBTITLE) : null;

        String mediaItemId = activeCastContext != null
            ? activeCastContext.mediaItemId
            : customData != null ? customData.optString("fluxMediaItemId", null) : null;
        String episodeId = activeCastContext != null
            ? activeCastContext.episodeId
            : customData != null && !customData.isNull("fluxEpisodeId")
                ? customData.optString("fluxEpisodeId", null)
                : null;
        double timelineOffset = activeCastContext != null
            ? castTimelineOffsetSeconds
            : customData != null ? Math.max(0, customData.optDouble("fluxTimelineOffsetSeconds", 0)) : 0;

        payload.put("connected", session != null);
        payload.put("mediaLoaded", mediaLoaded);
        payload.put("mediaItemId", mediaItemId == null ? JSONObject.NULL : mediaItemId);
        payload.put("episodeId", episodeId == null ? JSONObject.NULL : episodeId);
        payload.put("playerState", status != null ? castPlayerStateName(status.getPlayerState()) : "UNKNOWN");
        payload.put("currentTimeSeconds", timelineOffset + receiverPosition);
        payload.put("durationSeconds", duration);
        payload.put("title", title == null ? JSONObject.NULL : title);
        payload.put("subtitle", subtitle == null ? JSONObject.NULL : subtitle);
        payload.put("deviceName", session != null && session.getCastDevice() != null ? session.getCastDevice().getFriendlyName() : JSONObject.NULL);
        payload.put("volume", session != null ? session.getVolume() : 1);
        payload.put("muted", session != null && session.isMute());
        if (status != null) payload.put("idleReason", status.getIdleReason());
        return payload;
    }

    private void publishCastPlaybackState() {
        try {
            JSONObject payload = buildCastStatePayload();
            payload.put("state", "playback");
            lastCastStateJson = payload.toString();
            Log.d(TAG, "Cast state=" + payload.optString("playerState") + " position=" + payload.optDouble("currentTimeSeconds"));
            String js = "document.dispatchEvent(new CustomEvent('flux:native-cast-state',{detail:" + payload + "}))";
            webView.evaluateJavascript(js, null);
        } catch (Exception error) {
            Log.w(TAG, "Could not publish Cast playback state", error);
        }
    }

    void notifyCastError(String message) {
        notifyCastState("error", message);
    }

    private void notifyCastState(String state, @Nullable String detail) {
        try {
            JSONObject payload = buildCastStatePayload();
            payload.put("state", state);
            if (detail != null) payload.put("detail", detail);
            lastCastStateJson = payload.toString();
            String js = "document.dispatchEvent(new CustomEvent('flux:native-cast-state',{detail:" + payload + "}))";
            webView.evaluateJavascript(js, null);
        } catch (Exception error) {
            Log.e(TAG, "Could not notify web cast state", error);
        }
    }

    private void showError(String title, String detail) {
        Log.e(TAG, title + ": " + detail);
        errorTitle.setText(title);
        errorDetail.setText(detail);
        errorPanel.setVisibility(View.VISIBLE);
        progressBar.setVisibility(View.GONE);
    }

    private String redact(String value) {
        try {
            Uri uri = Uri.parse(value);
            if (uri.getQueryParameter("token") == null) return value;
            Uri.Builder builder = uri.buildUpon().clearQuery();
            for (String name : uri.getQueryParameterNames()) {
                builder.appendQueryParameter(name, "token".equals(name) ? "[redacted]" : uri.getQueryParameter(name));
            }
            return builder.build().toString();
        } catch (Exception ignored) {
            return value;
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (sessionManager != null) sessionManager.addSessionManagerListener(castSessionListener, CastSession.class);
    }

    @Override
    protected void onStop() {
        if (sessionManager != null) sessionManager.removeSessionManagerListener(castSessionListener, CastSession.class);
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        UpdateManager.checkForUpdate(this, false);
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        networkExecutor.shutdownNow();
        if (isFinishing()) {
            root.removeView(webView);
            webView.removeJavascriptInterface("FluxNative");
            webView.destroy();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (fullscreenView != null) {
            hideFullscreenView();
        } else if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && filePathCallback != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            filePathCallback.onReceiveValue(result);
            filePathCallback = null;
        }
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private final class FluxWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isAllowedInternalUrl(uri)) return false;
            openExternal(uri);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            Log.i(TAG, "Page load started: " + redact(url));
            progressBar.setVisibility(View.VISIBLE);
            errorPanel.setVisibility(View.GONE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            Log.i(TAG, "Page load finished: " + redact(url));
            progressBar.setVisibility(View.GONE);
            view.evaluateJavascript("window.FLUX_NATIVE_APP=true;", null);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            showError("Flux could not load", "URL: " + redact(request.getUrl().toString()) + "\nReason: " + error.getDescription());
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            showError("Secure connection failed", "Flux refused to load because Android reported an SSL error.");
        }
    }

    private final class FluxWebChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            progressBar.setProgress(newProgress);
            progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreenView != null) {
                callback.onCustomViewHidden();
                return;
            }
            fullscreenView = view;
            fullscreenCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ));
            webView.setVisibility(View.GONE);
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
            Log.i(TAG, "Entered fullscreen media");
        }

        @Override
        public void onHideCustomView() {
            hideFullscreenView();
        }

        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
            if (MainActivity.this.filePathCallback != null) {
                MainActivity.this.filePathCallback.onReceiveValue(null);
            }
            MainActivity.this.filePathCallback = filePathCallback;
            try {
                startActivityForResult(fileChooserParams.createIntent(), FILE_CHOOSER_REQUEST);
            } catch (ActivityNotFoundException error) {
                MainActivity.this.filePathCallback = null;
                return false;
            }
            return true;
        }
    }

    private void hideFullscreenView() {
        if (fullscreenView == null) return;
        root.removeView(fullscreenView);
        fullscreenView = null;
        webView.setVisibility(View.VISIBLE);
        getWindow().getDecorView().setSystemUiVisibility(0);
        if (fullscreenCallback != null) {
            fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
        Log.i(TAG, "Exited fullscreen media");
    }
}
