'use client';

import { useCallback, useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';
import type {
  AppReleaseAssetDTO,
  AppReleasesDTO,
  ReleaseArch,
  ReleaseFormat,
} from '@flux/shared';
import { api } from '@/lib/api';

const GITHUB_RELEASES_URL = 'https://github.com/FluxMediaLibrary/Flux/releases';

type PlatformId = 'android' | 'windows' | 'macos' | 'linux';

interface PlatformMeta {
  id: PlatformId;
  label: string;
  icon: ComponentType;
}

export default function DownloadsPage() {
  const [releases, setReleases] = useState<AppReleasesDTO | null>(null);
  const [arch, setArch] = useState<ReleaseArch>('x64');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setReleases(await api.appReleases());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load the latest Flux downloads.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setArch(detectArch());
    void load();
  }, [load]);

  return (
    <div className="downloads-shell">
      <div className="downloads-wrap">
        <header className="downloads-topbar">
          <Link href="/" className="downloads-brand" aria-label="Flux home">
            <span className="downloads-brand-icon" aria-hidden>
              <IconFluxMark />
            </span>
            <span>Flux</span>
          </Link>

          <nav className="downloads-topbar-links" aria-label="Download page links">
            <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">
              GitHub releases
            </a>
            <Link href="/">Back to Flux</Link>
          </nav>
        </header>

        <main className="downloads-simple-main">
          <section className="downloads-simple-card" aria-labelledby="downloads-title">
            <h1 id="downloads-title">Download Flux</h1>

            {loading ? (
              <div className="downloads-button-grid" aria-label="Loading downloads">
                {PLATFORMS.map((platform) => (
                  <span
                    key={platform.id}
                    className="downloads-platform-button downloads-platform-button-loading"
                    aria-hidden
                  />
                ))}
              </div>
            ) : error ? (
              <div className="downloads-simple-error">
                <p>{error}</p>
                <button type="button" className="btn btn-primary" onClick={() => void load()}>
                  Try again
                </button>
              </div>
            ) : (
              <div className="downloads-button-grid">
                {PLATFORMS.map((platform) => {
                  const Icon = platform.icon;
                  const asset = getPlatformAsset(platform.id, releases, arch);

                  if (!asset) {
                    return (
                      <span
                        key={platform.id}
                        className="downloads-platform-button unavailable"
                        aria-disabled="true"
                      >
                        <span className="downloads-platform-button-icon" aria-hidden>
                          <Icon />
                        </span>
                        <span>{platform.label}</span>
                        <small>Unavailable</small>
                      </span>
                    );
                  }

                  return (
                    <a
                      key={platform.id}
                      className="downloads-platform-button"
                      href={asset.url}
                    >
                      <span className="downloads-platform-button-icon" aria-hidden>
                        <Icon />
                      </span>
                      <span>{platform.label}</span>
                      <span className="downloads-platform-download-icon" aria-hidden>
                        <IconDownload />
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function getPlatformAsset(
  platform: PlatformId,
  releases: AppReleasesDTO | null,
  arch: ReleaseArch,
): AppReleaseAssetDTO | undefined {
  const release = platform === 'android' ? releases?.android : releases?.desktop;
  const assets = release?.assets.filter((asset) => asset.platform === platform) ?? [];

  if (platform === 'android') {
    return assets.find((asset) => asset.format === 'apk') ?? assets[0];
  }

  return pickPrimary(platform, arch, assets);
}

function pickPrimary(
  platform: Exclude<PlatformId, 'android'>,
  arch: ReleaseArch,
  assets: AppReleaseAssetDTO[],
): AppReleaseAssetDTO | undefined {
  if (assets.length === 0) return undefined;

  if (platform === 'windows') {
    const installer = assets.find(
      (asset) => asset.format === 'exe' && asset.arch === 'universal',
    );
    if (installer) return installer;
  }

  const matchingArch = assets.filter(
    (asset) => asset.arch === arch || asset.arch === 'universal',
  );
  const pool = matchingArch.length > 0 ? matchingArch : assets;
  const formatPriority: Record<Exclude<PlatformId, 'android'>, ReleaseFormat[]> = {
    windows: ['exe'],
    macos: ['dmg', 'zip'],
    linux: ['appimage', 'deb', 'rpm'],
  };

  for (const format of formatPriority[platform]) {
    const match = pool.find((asset) => asset.format === format);
    if (match) return match;
  }

  return pool[0];
}

function detectArch(): ReleaseArch {
  if (typeof navigator === 'undefined') return 'x64';

  const ua = navigator.userAgent;
  if (/arm64|aarch64/i.test(ua)) return 'arm64';

  const data = (navigator as { userAgentData?: { architecture?: string } }).userAgentData;
  if (data?.architecture && /arm/i.test(data.architecture)) return 'arm64';
  return 'x64';
}

const iconProps = { viewBox: '0 0 24 24', 'aria-hidden': true } as const;

const IconFluxMark = () => (
  <svg viewBox="0 0 48 48" fill="none" aria-hidden>
    <rect x="2" y="2" width="44" height="44" rx="12" fill="var(--accent)" />
    <path d="M19 15.5v17l15-8.5z" fill="#0d0f12" />
  </svg>
);

const IconWindows = () => (
  <svg {...iconProps} fill="currentColor">
    <path d="M0 3.449 9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
  </svg>
);

const IconApple = () => (
  <svg {...iconProps} fill="currentColor">
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.702" />
  </svg>
);

const IconLinux = () => (
  <svg {...iconProps} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 9 3 3-3 3" />
    <path d="M12 15h5" />
  </svg>
);

const IconAndroid = () => (
  <svg {...iconProps} fill="currentColor">
    <path d="M17.523 9.328 19.865 5.71a.706.706 0 0 0-.184-.98.703.703 0 0 0-.98.185l-2.36 3.643a11.743 11.743 0 0 0-8.682 0L5.299 4.914a.704.704 0 0 0-1.164.795l2.342 3.62A9.893 9.893 0 0 0 2.06 17.09h19.88a9.893 9.893 0 0 0-4.417-7.762zM7.189 14.565a1.177 1.177 0 1 1 0-2.354 1.177 1.177 0 0 1 0 2.354zm9.622 0a1.177 1.177 0 1 1 0-2.354 1.177 1.177 0 0 1 0 2.354z" />
  </svg>
);

const PLATFORMS: PlatformMeta[] = [
  { id: 'android', label: 'Android', icon: IconAndroid },
  { id: 'windows', label: 'PC', icon: IconWindows },
  { id: 'macos', label: 'Mac', icon: IconApple },
  { id: 'linux', label: 'Linux', icon: IconLinux },
];

const IconDownload = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 21h16" />
  </svg>
);
