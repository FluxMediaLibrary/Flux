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
    public boolean isNativeApp() { return true; }

    @JavascriptInterface
    public String getAppInfo() {
        try {
            JSONObject info = new JSONObject();
            info.put("versionName", BuildConfig.VERSION_NAME);
            info.put("versionCode", BuildConfig.VERSION_CODE);
            info.put("automaticUpdates", UpdateManager.areAutomaticUpdatesEnabled(activity));
            info.put("updateServer", activity.getString(R.string.flux_api_base_url));
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
