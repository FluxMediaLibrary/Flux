'use client';

/**
 * In-app updater for the sideloaded Android app.
 *
 * The Flux Android app is a TWA — it just loads the live site — so *web* changes
 * (new avatars, casting, etc.) appear automatically on the next launch after a
 * deploy; the APK never needs reinstalling for those. This banner exists only
 * for the rare case where the native shell changes (new icon, package config,
 * TWA settings), which does require a fresh APK.
 *
 * How it works: only when running as the installed app, we fetch
 * `/app-version.json` and compare its `versionCode` to the last one the user
 * acknowledged (localStorage). On first sight we silently record the current
 * version (no nag); when a newer APK is later published (bump the JSON), we show
 * an "Update available" banner whose button downloads the new APK — Android then
 * prompts to install it. Play In-App Updates aren't available for sideloaded
 * apps, so this is the self-hosted equivalent.
 */
import { useEffect, useState } from 'react';

const ACK_KEY = 'flux.apkAck';

interface AppVersion {
  versionCode: number;
  versionName: string;
  url: string;
  notes?: string;
}

/** True when running inside the installed TWA (not a normal browser tab). */
function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  // A TWA sets document.referrer to `android-app://<package>` on launch.
  if (document.referrer.startsWith('android-app://')) return true;
  return window.matchMedia('(display-mode: standalone)').matches;
}

export function AppUpdateBanner() {
  const [update, setUpdate] = useState<AppVersion | null>(null);

  useEffect(() => {
    if (!isInstalledApp()) return;
    let cancelled = false;
    fetch('/app-version.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AppVersion | null) => {
        if (cancelled || !data || typeof data.versionCode !== 'number') return;
        const ack = Number(localStorage.getItem(ACK_KEY) ?? '0');
        if (ack === 0) {
          // First time we've seen a version on this device — assume the user is
          // current and don't nag; only prompt on a *future* bump.
          localStorage.setItem(ACK_KEY, String(data.versionCode));
          return;
        }
        if (data.versionCode > ack) setUpdate(data);
      })
      .catch(() => {
        /* offline or no manifest — nothing to do */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;

  const ack = () => localStorage.setItem(ACK_KEY, String(update.versionCode));
  const onLater = () => {
    ack();
    setUpdate(null);
  };
  const onUpdate = () => {
    ack();
    // Downloads the APK; Android shows its install prompt (requires the one-time
    // "install unknown apps" permission for the browser/app).
    window.location.href = update.url;
  };

  return (
    <div className="app-update-banner" role="alert">
      <div className="app-update-text">
        <strong>Update available</strong>
        <span>
          Flux {update.versionName} is ready to install.
          {update.notes ? ` ${update.notes}` : ''}
        </span>
      </div>
      <div className="app-update-actions">
        <button className="btn btn-ghost" type="button" onClick={onLater}>
          Later
        </button>
        <button className="btn btn-primary" type="button" onClick={onUpdate}>
          Update
        </button>
      </div>
    </div>
  );
}
