package xyz.deadstudios.flux;

import org.json.JSONException;
import org.json.JSONObject;

final class CastRequest {
    final String mediaItemId;
    final String episodeId;
    final double currentTimeSeconds;

    private CastRequest(String mediaItemId, String episodeId, double currentTimeSeconds) {
        this.mediaItemId = mediaItemId;
        this.episodeId = episodeId;
        this.currentTimeSeconds = currentTimeSeconds;
    }

    static CastRequest fromJson(String json) throws JSONException {
        JSONObject object = new JSONObject(json);
        String mediaItemId = object.optString("mediaItemId", "").trim();
        if (mediaItemId.isEmpty() || mediaItemId.length() > 128) {
            throw new JSONException("Invalid mediaItemId");
        }
        String episodeId = object.optString("episodeId", "").trim();
        if (episodeId.length() > 128) {
            throw new JSONException("Invalid episodeId");
        }
        double currentTime = object.optDouble("currentTimeSeconds", 0);
        if (!Double.isFinite(currentTime) || currentTime < 0) currentTime = 0;
        return new CastRequest(mediaItemId, episodeId.isEmpty() ? null : episodeId, currentTime);
    }
}
