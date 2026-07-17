package xyz.deadstudios.flux;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class CastPlaybackInfo {
    final String url;
    final String contentType;
    final String streamType;
    final String title;
    final String subtitle;
    final String posterUrl;
    final double durationSeconds;
    final String method;

    private CastPlaybackInfo(
        String url,
        String contentType,
        String streamType,
        String title,
        String subtitle,
        String posterUrl,
        double durationSeconds,
        String method
    ) {
        this.url = url;
        this.contentType = contentType;
        this.streamType = streamType;
        this.title = title;
        this.subtitle = subtitle;
        this.posterUrl = posterUrl;
        this.durationSeconds = durationSeconds;
        this.method = method;
    }

    static CastPlaybackInfo fromJson(String json) throws JSONException {
        JSONObject object = new JSONObject(json);
        JSONArray warnings = object.optJSONArray("warnings");
        if (warnings != null && warnings.length() > 0) {
            android.util.Log.w("FluxCast", "Backend cast warnings: " + warnings);
        }
        return new CastPlaybackInfo(
            object.getString("url"),
            object.getString("contentType"),
            object.optString("streamType", "BUFFERED"),
            object.optString("title", "Flux"),
            object.optString("subtitle", null),
            object.optString("posterUrl", null),
            object.optDouble("durationSeconds", 0),
            object.optString("method", "hls")
        );
    }
}
