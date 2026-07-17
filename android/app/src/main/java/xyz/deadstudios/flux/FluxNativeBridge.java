package xyz.deadstudios.flux;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;

/** Narrow native bridge: web playback supplies context, native owns Cast. */
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
    public boolean isNativeApp() { return true; }
}
