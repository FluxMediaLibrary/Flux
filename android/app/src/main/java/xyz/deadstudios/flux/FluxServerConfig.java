package xyz.deadstudios.flux;

import android.content.Context;
import android.net.Uri;

final class FluxServerConfig {
    private static final String PREFS = "flux";
    private static final String KEY_SERVER_URL = "server_url";

    private FluxServerConfig() {}

    static String getBaseUrl(Context context) {
        String value = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SERVER_URL, "");
        return value == null || value.trim().isEmpty() ? null : value;
    }

    static String requireBaseUrl(Context context) {
        String base = getBaseUrl(context);
        if (base == null) throw new IllegalStateException("Flux server URL is not configured");
        return base;
    }

    static String getStartUrl(Context context) {
        String base = getBaseUrl(context);
        if (base == null) return null;
        return base + "/library";
    }

    static void setBaseUrl(Context context, String input) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_URL, normalize(input))
            .apply();
    }

    static boolean isConfiguredInternalUrl(Context context, Uri uri) {
        String base = getBaseUrl(context);
        if (base == null || uri == null) return false;
        Uri configured = Uri.parse(base);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        return ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
            && scheme.equalsIgnoreCase(configured.getScheme())
            && host != null
            && host.equalsIgnoreCase(configured.getHost())
            && uri.getPort() == configured.getPort();
    }

    static String normalize(String input) {
        String trimmed = input == null ? "" : input.trim();
        if (trimmed.isEmpty()) throw new IllegalArgumentException("Enter a Flux server URL.");
        if (!trimmed.matches("(?i)^https?://.*")) trimmed = "https://" + trimmed;

        Uri uri = Uri.parse(trimmed);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(scheme)) {
            throw new IllegalArgumentException("Flux for Android requires an https:// server URL.");
        }
        if (host == null || host.trim().isEmpty()) {
            throw new IllegalArgumentException("Enter a valid host, like https://domain.com.");
        }

        Uri.Builder builder = new Uri.Builder()
            .scheme(scheme.toLowerCase())
            .encodedAuthority(uri.getEncodedAuthority());
        return builder.build().toString().replaceAll("/+$", "");
    }
}
