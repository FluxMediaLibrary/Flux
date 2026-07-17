package xyz.deadstudios.flux;

import android.app.Application;
import android.util.Log;
import android.webkit.WebView;
import com.google.android.gms.cast.framework.CastContext;

public final class FluxApplication extends Application {
    private static final String TAG = "FluxApplication";

    @Override
    public void onCreate() {
        super.onCreate();
        // One process-wide Cast context; activities only attach UI/session listeners.
        try { CastContext.getSharedInstance(this); } catch (Exception error) { Log.e(TAG, "Cast framework unavailable", error); }
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
            Log.i(TAG, "WebView debugging enabled for debug build");
        }
    }
}
