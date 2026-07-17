package xyz.deadstudios.flux;

import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

/** Native-only configuration; no web APK banner or browser installer is used. */
public final class SettingsActivity extends AppCompatActivity {
    @Override protected void onCreate(@Nullable Bundle state) {
        super.onCreate(state);
        ScrollView scroll = new ScrollView(this);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(24), dp(36), dp(24), dp(36));
        scroll.addView(page);
        addText(page, "Flux application", 24);
        addText(page, "Version " + BuildConfig.VERSION_NAME + " (" + BuildConfig.VERSION_CODE + ")", 15);
        addText(page, "Server: " + getString(R.string.flux_api_base_url), 14);
        addText(page, "Cast diagnostics are available while a receiver is connected in the Android system Cast controls.", 14);
        Switch automatic = new Switch(this);
        automatic.setText("Check for updates automatically");
        automatic.setChecked(getSharedPreferences("flux", MODE_PRIVATE).getBoolean("automatic_updates", true));
        automatic.setOnCheckedChangeListener((button, checked) -> getSharedPreferences("flux", MODE_PRIVATE).edit().putBoolean("automatic_updates", checked).apply());
        page.addView(automatic);
        Button check = new Button(this);
        check.setText("Check for updates");
        check.setOnClickListener(v -> UpdateManager.checkForUpdate(this, true));
        page.addView(check);
        Button clear = new Button(this);
        clear.setText("Clear downloaded update files");
        clear.setOnClickListener(v -> UpdateManager.clearDownloads(this));
        page.addView(clear);
        addText(page, "Flux uses the Android package installer. You will always approve an update before installation.", 13);
        setContentView(scroll);
    }
    private void addText(LinearLayout target, String text, int size) { TextView view = new TextView(this); view.setText(text); view.setTextSize(size); view.setPadding(0, dp(10), 0, dp(10)); target.addView(view); }
    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density + .5f); }
}
