package xyz.deadstudios.flux;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;

final class FluxAndroidCastBridge {
    private static final String TAG = "FluxCastBridge";
    private final MainActivity activity;
    private final Handler main = new Handler(Looper.getMainLooper());

    FluxAndroidCastBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public void requestCast(String json) {
        main.post(() -> {
            try {
                CastRequest request = CastRequest.fromJson(json);
                activity.requestNativeCast(request);
            } catch (Exception error) {
                Log.e(TAG, "Rejected cast bridge request: " + error.getMessage());
                activity.notifyCastError("Invalid cast request");
            }
        });
    }

    @JavascriptInterface
    public boolean isAvailable() {
        return true;
    }
}
