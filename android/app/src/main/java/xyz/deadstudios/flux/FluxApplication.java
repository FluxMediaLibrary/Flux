package xyz.deadstudios.flux;

import android.app.Application;
import android.util.Log;
import android.webkit.WebView;

public final class FluxApplication extends Application {
    private static final String TAG = "FluxApplication";

    @Override
    public void onCreate() {
        super.onCreate();
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
            Log.i(TAG, "WebView debugging enabled for debug build");
        }
    }
}
