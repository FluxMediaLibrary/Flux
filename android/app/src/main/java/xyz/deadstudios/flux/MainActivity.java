package xyz.deadstudios.flux;

import android.annotation.SuppressLint;
import android.app.Activity;
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
import android.view.MotionEvent;
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
    private boolean castLaunchRequested;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();

    private final SessionManagerListener<CastSession> castSessionListener = new SessionManagerListener<CastSession>() {
        @Override public void onSessionStarted(@NonNull CastSession session, @NonNull String sessionId) {
            Log.i(TAG, "Cast session started: " + sessionId);
            notifyCastState("connected", null);
            if (castLaunchRequested) loadPendingCastMedia();
        }
        @Override public void onSessionStartFailed(@NonNull CastSession session, int error) {
            Log.e(TAG, "Cast session start failed: " + error);
            notifyCastError("Cast session failed: " + error);
        }
        @Override public void onSessionEnded(@NonNull CastSession session, int error) {
            Log.i(TAG, "Cast session ended reason=" + error);
            notifyCastState("disconnected", String.valueOf(error));
        }
        @Override public void onSessionResumed(@NonNull CastSession session, boolean wasSuspended) {
            Log.i(TAG, "Cast session resumed suspended=" + wasSuspended);
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
        mediaRouteButton.setContentDescription("Cast");
        FrameLayout.LayoutParams castParams = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP | Gravity.END);
        castParams.setMargins(0, dp(8), dp(8), 0);
        root.addView(mediaRouteButton, castParams);
        mediaRouteButton.setOnTouchListener((view, event) -> {
            if (event.getAction() == MotionEvent.ACTION_UP) {
                if (playbackContext == null) {
                    notifyCastError("Open a movie or episode before starting Cast");
                } else {
                    pendingCastContext = playbackContext;
                    castLaunchRequested = true;
                    notifyCastState("connecting", null);
                }
            }
            return false;
        });

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

            FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) mediaRouteButton.getLayoutParams();
            params.topMargin = statusBars.top + dp(6);
            params.rightMargin = dp(8);
            mediaRouteButton.setLayoutParams(params);
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
        if (!isOnline()) {
            showError("Offline", "No network connection is available.");
            return;
        }
        String url = getString(R.string.flux_start_url);
        Log.i(TAG, "Loading start URL: " + redact(url));
        webView.loadUrl(url);
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
        String scheme = uri.getScheme();
        String host = uri.getHost();
        return ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
            && getString(R.string.flux_allowed_host).equalsIgnoreCase(host);
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
        String url = getString(R.string.flux_api_base_url) + "/api/cast/sessions";
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

        MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE);
        metadata.putString(MediaMetadata.KEY_TITLE, info.title);
        if (info.subtitle != null && !"null".equals(info.subtitle)) {
            metadata.putString(MediaMetadata.KEY_SUBTITLE, info.subtitle);
        }
        if (info.posterUrl != null && !"null".equals(info.posterUrl)) {
            metadata.addImage(new WebImage(Uri.parse(info.posterUrl)));
        }

        MediaInfo.Builder mediaBuilder = new MediaInfo.Builder(info.url)
            .setContentUrl(info.url)
            .setContentType(info.contentType)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
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
                pendingCastContext = null;
                castLaunchRequested = false;
                notifyCastState("media-loaded", info.method);
                webView.evaluateJavascript("document.dispatchEvent(new CustomEvent('flux:native-cast-local-pause'))", null);
            }
        });
        client.registerCallback(new RemoteMediaClient.Callback() {
            @Override public void onStatusUpdated() {
                MediaStatus status = client.getMediaStatus();
                if (status != null) {
                    Log.i(TAG, "Receiver status playerState=" + status.getPlayerState() + " idleReason=" + status.getIdleReason());
                    notifyCastState("playback", "state=" + status.getPlayerState() + " idle=" + status.getIdleReason());
                }
            }
        });
    }

    void notifyCastError(String message) {
        notifyCastState("error", message);
    }

    private void notifyCastState(String state, @Nullable String detail) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("state", state);
            if (detail != null) payload.put("detail", detail);
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
            mediaRouteButton.setVisibility(View.GONE);
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
        mediaRouteButton.setVisibility(View.VISIBLE);
        getWindow().getDecorView().setSystemUiVisibility(0);
        if (fullscreenCallback != null) {
            fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
        Log.i(TAG, "Exited fullscreen media");
    }
}
