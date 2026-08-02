package xyz.deadstudios.flux;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

/** Narrow native bridge: web supplies playback/settings actions; native owns Cast and updates. */
final class FluxNativeBridge {
    private final MainActivity activity;
    private final Handler main = new Handler(Looper.getMainLooper());

    FluxNativeBridge(MainActivity activity) { this.activity = activity; }

    @JavascriptInterface
    public void setPlaybackContext(String json) {
        main.post(() -> {
            try {
                activity.updatePlaybackContext(NativePlaybackContext.fromJson(json));
            } catch (Exception error) {
                Log.w("FluxNativeBridge", "Rejected playback context", error);
            }
        });
    }

    @JavascriptInterface
    public void requestCast() {
        main.post(activity::requestCastFromWeb);
    }

    @JavascriptInterface
    public void loadCastMedia(String json) {
        main.post(() -> {
            try {
                activity.loadCastMediaFromWeb(NativePlaybackContext.fromJson(json));
            } catch (Exception error) {
                Log.w("FluxNativeBridge", "Rejected Cast media load", error);
                activity.notifyCastError("The selected episode could not be sent to the TV");
            }
        });
    }

    @JavascriptInterface
    public String getCastState() {
        return activity.getCastStateJson();
    }

    @JavascriptInterface
    public void castPlay() {
        main.post(activity::playCastMedia);
    }

    @JavascriptInterface
    public void castPause() {
        main.post(activity::pauseCastMedia);
    }

    @JavascriptInterface
    public void castSeek(double positionSeconds) {
        main.post(() -> activity.seekCastMedia(positionSeconds));
    }

    @JavascriptInterface
    public void castSetVolume(double volume) {
        main.post(() -> activity.setCastVolume(volume));
    }

    @JavascriptInterface
    public void castToggleMute() {
        main.post(activity::toggleCastMute);
    }

    @JavascriptInterface
    public void disconnectCast() {
        main.post(activity::disconnectCast);
    }

    @JavascriptInterface
    public boolean isNativeApp() { return true; }

    @JavascriptInterface
    public String getAppInfo() {
        try {
            JSONObject info = new JSONObject();
            info.put("versionName", BuildConfig.VERSION_NAME);
            info.put("versionCode", BuildConfig.VERSION_CODE);
            info.put("automaticUpdates", UpdateManager.areAutomaticUpdatesEnabled(activity));
            info.put("updateServer", FluxServerConfig.getBaseUrl(activity));
            return info.toString();
        } catch (Exception error) {
            Log.w("FluxNativeBridge", "Could not build app info", error);
            return "{}";
        }
    }

    @JavascriptInterface
    public void checkForUpdates() {
        main.post(() -> UpdateManager.checkForUpdate(activity, true));
    }

    @JavascriptInterface
    public void setAutomaticUpdates(boolean enabled) {
        main.post(() -> UpdateManager.setAutomaticUpdatesEnabled(activity, enabled));
    }

    @JavascriptInterface
    public void clearUpdateDownloads() {
        main.post(() -> UpdateManager.clearDownloads(activity));
    }
}
