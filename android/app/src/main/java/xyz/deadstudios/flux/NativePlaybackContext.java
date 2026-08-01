package xyz.deadstudios.flux;

import org.json.JSONException;
import org.json.JSONObject;

/** Trusted WebView-to-native handoff. It contains no auth material. */
final class NativePlaybackContext {
    final String mediaItemId;
    final String episodeId;
    final double currentTimeSeconds;

    private NativePlaybackContext(String mediaItemId, String episodeId, double currentTimeSeconds) {
        this.mediaItemId = mediaItemId;
        this.episodeId = episodeId;
        this.currentTimeSeconds = currentTimeSeconds;
    }

    static NativePlaybackContext fromJson(String json) throws JSONException {
        JSONObject object = new JSONObject(json);
        String mediaItemId = object.optString("mediaItemId", "").trim();
        String episodeId = object.optString("episodeId", "").trim();
        double position = object.optDouble("currentTimeSeconds", 0);
        if (mediaItemId.isEmpty() || mediaItemId.length() > 128) throw new JSONException("Invalid mediaItemId");
        if (episodeId.length() > 128) throw new JSONException("Invalid episodeId");
        if (!Double.isFinite(position) || position < 0) position = 0;
        return new NativePlaybackContext(mediaItemId, episodeId.isEmpty() ? null : episodeId, position);
    }

    NativePlaybackContext withPosition(double positionSeconds) {
        double position = Double.isFinite(positionSeconds) && positionSeconds >= 0 ? positionSeconds : 0;
        return new NativePlaybackContext(mediaItemId, episodeId, position);
    }
}
