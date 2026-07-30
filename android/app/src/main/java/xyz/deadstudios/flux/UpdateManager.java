package xyz.deadstudios.flux;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Secure sideloaded APK update flow: version, host, checksum, package and signing certificate checks. */
final class UpdateManager {
    private static final String TAG = "FluxUpdater";
    private static final String PREFS = "flux";
    private static final long CHECK_INTERVAL_MS = 6L * 60L * 60L * 1000L;
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();

    static boolean areAutomaticUpdatesEnabled(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("automatic_updates", true);
    }

    static void setAutomaticUpdatesEnabled(Context context, boolean enabled) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("automatic_updates", enabled).apply();
        toast(context, enabled ? "Automatic updates enabled." : "Automatic updates disabled.");
    }

    static void checkForUpdate(Context context, boolean manual) {
        if (FluxServerConfig.getBaseUrl(context) == null) {
            if (manual) toast(context, "Set the Flux server URL before checking for updates.");
            return;
        }
        if (!manual && (!areAutomaticUpdatesEnabled(context) ||
            System.currentTimeMillis() - context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("last_update_check", 0) < CHECK_INTERVAL_MS)) return;
        WORKER.execute(() -> {
            try {
                Manifest manifest = fetchManifest(context);
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong("last_update_check", System.currentTimeMillis()).apply();
                if (manifest.versionCode <= BuildConfig.VERSION_CODE) {
                    if (manual) toast(context, "Flux is up to date.");
                    return;
                }
                int dismissed = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("dismissed_update", 0);
                if (!manual && !manifest.mandatory && dismissed >= manifest.versionCode) return;
                showPrompt(context, manifest);
            } catch (Exception error) {
                Log.w(TAG, "Update check failed", error);
                if (manual) toast(context, userMessage(error));
            }
        });
    }

    static void clearDownloads(Context context) {
        File folder = new File(context.getCacheDir(), "updates");
        File[] files = folder.listFiles();
        if (files != null) for (File file : files) file.delete();
        toast(context, "Downloaded update files cleared.");
    }

    private static Manifest fetchManifest(Context context) throws Exception {
        String base = FluxServerConfig.requireBaseUrl(context);
        List<Exception> failures = new ArrayList<>();
        for (String path : new String[] { "/api/app/android/latest", "/app-version.json" }) {
            URL url = new URL(base + path);
            try {
                return fetchManifestFrom(url);
            } catch (Exception error) {
                failures.add(error);
                Log.w(TAG, "Manifest fetch failed for " + url, error);
            }
        }
        IllegalStateException error = new IllegalStateException("No Flux update manifest is reachable or valid");
        for (Exception failure : failures) error.addSuppressed(failure);
        throw error;
    }

    private static Manifest fetchManifestFrom(URL url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setConnectTimeout(10000); c.setReadTimeout(15000); c.setRequestProperty("Accept", "application/json");
        if (c.getResponseCode() != 200) throw new IllegalStateException("manifest HTTP " + c.getResponseCode());
        StringBuilder text = new StringBuilder();
        try (InputStream input = c.getInputStream()) { byte[] chunk = new byte[8192]; int read; while ((read = input.read(chunk)) >= 0) text.append(new String(chunk, 0, read, java.nio.charset.StandardCharsets.UTF_8)); }
        String json = text.toString();
        return Manifest.parse(new JSONObject(json), url);
    }

    private static void showPrompt(Context context, Manifest manifest) {
        if (!(context instanceof android.app.Activity)) return;
        ((android.app.Activity) context).runOnUiThread(() -> {
            String notes = manifest.notes.length() == 0 ? "" : "\n\n" + manifest.notes.replace("\n", "\n• ");
            AlertDialog.Builder prompt = new AlertDialog.Builder(context)
                .setTitle("Flux " + manifest.versionName + " is ready")
                .setMessage("Current version: " + BuildConfig.VERSION_NAME + "\nDownload: " + readableBytes(manifest.fileSize) + notes)
                .setPositiveButton("Update", (d, w) -> downloadAndInstall(context, manifest));
            if (manifest.mandatory || BuildConfig.VERSION_CODE < manifest.minimumSupportedVersionCode) {
                prompt.setNegativeButton("Retry", (d, w) -> checkForUpdate(context, true)).setCancelable(false);
            } else {
                prompt.setNegativeButton("Later", (d, w) -> context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt("dismissed_update", manifest.versionCode).apply());
            }
            prompt.show();
        });
    }

    private static void downloadAndInstall(Context context, Manifest manifest) {
        WORKER.execute(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) manifest.apkUrl.openConnection();
                c.setInstanceFollowRedirects(false); c.setConnectTimeout(15000); c.setReadTimeout(30000);
                if (c.getResponseCode() != 200) throw new IllegalStateException("APK HTTP " + c.getResponseCode());
                File folder = new File(context.getCacheDir(), "updates"); folder.mkdirs();
                File apk = new File(folder, "Flux-" + manifest.versionCode + ".apk");
                try (InputStream input = c.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
                    byte[] buffer = new byte[32768]; int count;
                    while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
                }
                if (apk.length() != manifest.fileSize || !sha256(apk).equalsIgnoreCase(manifest.sha256)) throw new SecurityException("APK checksum verification failed");
                verifyPackageAndSignature(context, apk, manifest.versionCode);
                launchInstaller(context, apk);
            } catch (Exception error) {
                Log.e(TAG, "Update failed", error); toast(context, "Update failed verification. The downloaded file was rejected.");
            }
        });
    }

    private static void verifyPackageAndSignature(Context context, File apk, int expectedCode) throws Exception {
        PackageManager pm = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (archive == null) throw new SecurityException("APK package metadata is unreadable");
        long archiveVersion = Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
        if (!context.getPackageName().equals(archive.packageName) || archiveVersion != expectedCode || archiveVersion <= BuildConfig.VERSION_CODE) throw new SecurityException("APK package or version mismatch");
        PackageInfo current = pm.getPackageInfo(context.getPackageName(), flags);
        if (!signatureDigest(current).equals(signatureDigest(archive))) throw new SecurityException("APK signing certificate mismatch");
    }

    private static String signatureDigest(PackageInfo info) throws Exception {
        Signature signature;
        if (Build.VERSION.SDK_INT >= 28) signature = info.signingInfo.getApkContentsSigners()[0];
        else signature = info.signatures[0];
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        return hex(digest.digest(signature.toByteArray()));
    }

    private static void launchInstaller(Context context, File apk) {
        if (Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); context.startActivity(settings); toast(context, "Allow Flux to install updates, then check for updates again."); return;
        }
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        Intent install = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(install);
    }

    private static void toast(Context context, String message) { if (context instanceof android.app.Activity) ((android.app.Activity) context).runOnUiThread(() -> android.widget.Toast.makeText(context, message, android.widget.Toast.LENGTH_LONG).show()); }
    private static String sha256(File file) throws Exception { MessageDigest digest = MessageDigest.getInstance("SHA-256"); try (FileInputStream in = new FileInputStream(file)) { byte[] b = new byte[32768]; int n; while ((n = in.read(b)) >= 0) digest.update(b, 0, n); } return hex(digest.digest()); }
    private static String hex(byte[] bytes) { StringBuilder b = new StringBuilder(); for (byte value : bytes) b.append(String.format(Locale.US, "%02x", value)); return b.toString(); }
    private static String readableBytes(long bytes) { return String.format(Locale.US, "%.1f MB", bytes / (1024d * 1024d)); }
    private static String userMessage(Exception error) {
        String combined = error.getMessage() == null ? "" : error.getMessage();
        for (Throwable suppressed : error.getSuppressed()) {
            if (suppressed.getMessage() != null) combined += " " + suppressed.getMessage();
        }
        if (combined.contains("Unsafe update manifest")) return "The Flux update manifest is invalid or incomplete.";
        if (combined.contains("manifest HTTP 404")) return "No Android update is published on this server yet.";
        return "Could not reach the Flux update server.";
    }

    private static final class Manifest {
        final int versionCode, minimumSupportedVersionCode; final String versionName, sha256, notes; final boolean mandatory; final long fileSize; final URL apkUrl;
        Manifest(int versionCode, int minimum, String versionName, String sha256, String notes, boolean mandatory, long fileSize, URL apkUrl) { this.versionCode=versionCode; this.minimumSupportedVersionCode=minimum; this.versionName=versionName; this.sha256=sha256; this.notes=notes; this.mandatory=mandatory; this.fileSize=fileSize; this.apkUrl=apkUrl; }
        static Manifest parse(JSONObject json, URL manifestUrl) throws Exception {
            int code=json.getInt("versionCode"), minimum=json.optInt("minimumSupportedVersionCode", 1); String name=json.getString("versionName"), sum=json.getString("sha256"), raw=json.optString("apkUrl", json.optString("url")); long size=json.getLong("fileSize");
            URL apk=new URL(manifestUrl, raw); if (!apk.getProtocol().equals(manifestUrl.getProtocol()) || !apk.getHost().equalsIgnoreCase(manifestUrl.getHost()) || code < 1 || raw.length() == 0 || size < 1 || !sum.matches("(?i)[a-f0-9]{64}")) throw new SecurityException("Unsafe update manifest");
            JSONArray notes=json.optJSONArray("releaseNotes"); StringBuilder text=new StringBuilder(); if(notes!=null) for(int i=0;i<notes.length();i++) text.append(i==0?"- ":"\n- ").append(notes.optString(i)); else text.append(json.optString("notes", ""));
            return new Manifest(code, minimum, name, sum, text.toString(), json.optBoolean("mandatory", false), size, apk);
        }
    }
}
