'use client';

import { useCallback, useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';
import type {
  AppReleaseAssetDTO,
  AppReleaseDTO,
  AppReleasesDTO,
  ReleaseArch,
  ReleaseFormat,
} from '@flux/shared';
import { api } from '@/lib/api';

const GITHUB_RELEASES_URL = 'https://github.com/FluxMediaLibrary/Flux/releases';

type PlatformId = 'windows' | 'macos' | 'linux' | 'android';

interface PlatformMeta {
  id: PlatformId;
  name: string;
  tagline: string;
  description: string;
  icon: ComponentType;
}

const PLATFORMS: PlatformMeta[] = [
  {
    id: 'windows',
    name: 'Windows',
    tagline: 'Windows 10 & 11',
    description: 'The complete Flux desktop experience for your Windows PC.',
    icon: () => <IconWindows />,
  },
  {
    id: 'macos',
    name: 'macOS',
    tagline: 'Intel & Apple silicon',
    description: 'A native desktop home for your Flux library on Mac.',
    icon: () => <IconApple />,
  },
  {
    id: 'linux',
    name: 'Linux',
    tagline: 'AppImage, .deb & .rpm',
    description: 'Flexible packages for the most common Linux distributions.',
    icon: () => <IconLinux />,
  },
  {
    id: 'android',
    name: 'Android',
    tagline: 'Phone, tablet & TV',
    description: 'Bring your Flux library to Android phones, tablets, and TVs.',
    icon: () => <IconAndroid />,
  },
];

const FORMAT_LABELS: Record<ReleaseFormat, string> = {
  exe: 'Installer',
  dmg: 'Disk image',
  zip: 'Zip archive',
  appimage: 'AppImage',
  deb: '.deb package',
  rpm: '.rpm package',
  apk: 'APK',
};

const ARCH_LABELS: Record<ReleaseArch, string> = {
  x64: 'x64',
  arm64: 'ARM64',
  universal: 'Universal',
};

export default function DownloadsPage() {
  const [releases, setReleases] = useState<AppReleasesDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PlatformId>('windows');
  const [devicePlatform, setDevicePlatform] = useState<PlatformId | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setReleases(await api.appReleases());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load the latest releases. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const detected = detectPlatform();
    if (detected !== 'unknown') {
      setDevicePlatform(detected);
      setSelected(detected);
    }
  }, []);

  const desktop = releases?.desktop ?? null;
  const android = releases?.android ?? null;
  const selectedMeta = getPlatformMeta(selected);
  const selectedRelease = selected === 'android' ? android : desktop;

  return (
    <div className="downloads-shell">
      <div className="downloads-ambient" aria-hidden />

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

        <main className="downloads-main">
          <section className="downloads-hero">
            <div className="downloads-hero-copy">
              <span className="downloads-eyebrow">
                <span className="downloads-eyebrow-dot" aria-hidden />
                Official Flux apps
              </span>

              <h1>Flux, wherever you watch.</h1>
              <p>
                Install Flux on desktop or Android and connect to your self-hosted
                library from the screens you use every day.
              </p>

              <div className="downloads-hero-actions">
                <a className="btn btn-primary downloads-hero-primary" href="#downloads">
                  Choose your platform
                  <IconArrow />
                </a>
                <a
                  className="btn btn-ghost downloads-hero-secondary"
                  href={GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Browse releases
                </a>
              </div>

              <div className="downloads-trust-row" aria-label="Download benefits">
                <span><IconCheck /> Free &amp; open source</span>
                <span><IconCheck /> Desktop and Android</span>
                <span><IconCheck /> Automatic device detection</span>
              </div>
            </div>

            <AppPreview />
          </section>

          <section className="downloads-section" id="downloads">
            <div className="downloads-section-heading">
              <div>
                <span className="downloads-section-kicker">Latest release</span>
                <h2>Download Flux</h2>
                <p>Select a platform and grab the installer that fits your device.</p>
              </div>

              {devicePlatform && (
                <span className="downloads-detected">
                  Detected: {getPlatformMeta(devicePlatform).name}
                </span>
              )}
            </div>

            {loading ? (
              <DownloadSkeleton />
            ) : error ? (
              <div className="downloads-state downloads-state-error">
                <div>
                  <strong>We couldn’t load the latest builds.</strong>
                  <p>{error}</p>
                </div>
                <div className="downloads-state-actions">
                  <button className="btn btn-primary" onClick={() => void load()}>
                    Try again
                  </button>
                  <a
                    className="btn btn-ghost"
                    href={GITHUB_RELEASES_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open GitHub releases
                  </a>
                </div>
              </div>
            ) : (
              <>
                <div className="downloads-platform-tabs" role="tablist" aria-label="Platforms">
                  {PLATFORMS.map((platform) => {
                    const Icon = platform.icon;
                    const isSelected = selected === platform.id;
                    const isDevice = devicePlatform === platform.id;

                    return (
                      <button
                        key={platform.id}
                        type="button"
                        role="tab"
                        id={`downloads-tab-${platform.id}`}
                        aria-selected={isSelected}
                        aria-controls="downloads-platform-panel"
                        className={`downloads-platform-tab${isSelected ? ' selected' : ''}`}
                        onClick={() => setSelected(platform.id)}
                      >
                        <span className="downloads-platform-tab-icon" aria-hidden>
                          <Icon />
                        </span>
                        <span className="downloads-platform-tab-copy">
                          <strong>{platform.name}</strong>
                          <small>{platform.tagline}</small>
                        </span>
                        {isDevice && <span className="downloads-device-dot" title="Your device" />}
                      </button>
                    );
                  })}
                </div>

                <section
                  className="downloads-download-card"
                  id="downloads-platform-panel"
                  role="tabpanel"
                  aria-labelledby={`downloads-tab-${selected}`}
                  key={selected}
                >
                  <DownloadPanel
                    platform={selected}
                    release={selectedRelease}
                    devicePlatform={devicePlatform}
                  />
                </section>
              </>
            )}
          </section>

          <section className="downloads-lower-grid" aria-label="More download information">
            <article>
              <span className="downloads-lower-number">01</span>
              <h3>Install the app</h3>
              <p>Choose the recommended build above and run the downloaded installer.</p>
            </article>
            <article>
              <span className="downloads-lower-number">02</span>
              <h3>Connect your server</h3>
              <p>Enter your Flux server address when the app asks where to connect.</p>
            </article>
            <article>
              <span className="downloads-lower-number">03</span>
              <h3>Start watching</h3>
              <p>Sign in, select a profile, and your library is ready on the new device.</p>
            </article>
          </section>

          <footer className="downloads-footer">
            <p>
              Need an older version or the complete changelog?{' '}
              <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">
                View every release on GitHub
              </a>
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}

function DownloadPanel({
  platform,
  release,
  devicePlatform,
}: {
  platform: PlatformId;
  release: AppReleaseDTO | null;
  devicePlatform: PlatformId | null;
}) {
  const meta = getPlatformMeta(platform);
  const Icon = meta.icon;
  const arch = detectArch();
  const assets = release?.assets.filter((asset) => asset.platform === platform) ?? [];
  const primary =
    platform === 'android'
      ? assets.find((asset) => asset.format === 'apk') ?? assets[0]
      : pickPrimary(platform, arch, assets);
  const otherAssets = primary
    ? assets.filter((asset) => asset.url !== primary.url)
    : assets;
  const isRecommended =
    devicePlatform === platform &&
    primary !== undefined &&
    (platform === 'android' || primary.arch === arch || primary.arch === 'universal');

  if (!release || !primary) {
    return (
      <div className="downloads-unavailable">
        <span className="downloads-panel-icon" aria-hidden>
          <Icon />
        </span>
        <div>
          <span className="downloads-section-kicker">Coming soon</span>
          <h2>No {meta.name} build is published yet.</h2>
          <p>Check GitHub releases for prerelease builds or future updates.</p>
        </div>
        <a
          className="btn btn-ghost"
          href={GITHUB_RELEASES_URL}
          target="_blank"
          rel="noreferrer"
        >
          Check GitHub
        </a>
      </div>
    );
  }

  return (
    <div className="downloads-panel-inner">
      <div className="downloads-card-main">
        <div className="downloads-panel-head">
          <span className="downloads-panel-icon" aria-hidden>
            <Icon />
          </span>
          <div>
            <span className="downloads-panel-overline">Flux for</span>
            <h2>{meta.name}</h2>
          </div>
          {isRecommended && (
            <span className="downloads-recommended-badge">
              <IconCheck /> Recommended
            </span>
          )}
        </div>

        <p className="downloads-panel-description">{meta.description}</p>

        <a className="downloads-primary-action" href={primary.url}>
          <span className="downloads-primary-action-icon" aria-hidden>
            <IconDownload />
          </span>
          <span className="downloads-primary-action-copy">
            <strong>{platform === 'android' ? 'Download APK' : `Download for ${meta.name}`}</strong>
            <small>{describeAsset(primary)}</small>
          </span>
          <span className="downloads-primary-action-arrow" aria-hidden>
            <IconArrow />
          </span>
        </a>

        {platform === 'android' && (
          <p className="downloads-android-note">
            Android may ask you to allow installs from your browser. Only install the APK
            downloaded from this page or the official Flux GitHub release.
          </p>
        )}

        <div className="downloads-inline-links">
          <a href={release.releaseUrl} target="_blank" rel="noreferrer">
            Release notes
          </a>
          <span aria-hidden>•</span>
          <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">
            All versions
          </a>
        </div>
      </div>

      <aside className="downloads-release-summary">
        <span className="downloads-section-kicker">Build details</span>
        <dl>
          <div>
            <dt>Version</dt>
            <dd>v{release.version}</dd>
          </div>
          <div>
            <dt>Released</dt>
            <dd>{formatDate(release.publishedAt)}</dd>
          </div>
          <div>
            <dt>Package</dt>
            <dd>{FORMAT_LABELS[primary.format]}</dd>
          </div>
          <div>
            <dt>Architecture</dt>
            <dd>{ARCH_LABELS[primary.arch]}</dd>
          </div>
          <div>
            <dt>Download size</dt>
            <dd>{formatSize(primary.size)}</dd>
          </div>
        </dl>
      </aside>

      {otherAssets.length > 0 && (
        <div className="downloads-builds">
          <div className="downloads-builds-heading">
            <div>
              <span className="downloads-section-kicker">Alternatives</span>
              <h3>Other {meta.name} installers</h3>
            </div>
            <span>{otherAssets.length} available</span>
          </div>
          <div className="downloads-builds-list">
            {otherAssets.map((asset) => (
              <DownloadRow key={`${asset.name}-${asset.arch}`} asset={asset} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DownloadRow({ asset }: { asset: AppReleaseAssetDTO }) {
  return (
    <a className="downloads-build-row" href={asset.url} title={asset.name}>
      <span className="downloads-build-file-icon" aria-hidden>
        <IconDownload />
      </span>
      <span className="downloads-build-copy">
        <strong>{FORMAT_LABELS[asset.format]}</strong>
        <small>{asset.name}</small>
      </span>
      <span className="downloads-build-meta">
        {ARCH_LABELS[asset.arch]} · {formatSize(asset.size)}
      </span>
      <span className="downloads-build-action">Download <IconArrow /></span>
    </a>
  );
}

function AppPreview() {
  return (
    <div className="downloads-showcase" aria-hidden>
      <div className="downloads-showcase-glow" />
      <div className="downloads-preview-window">
        <div className="downloads-preview-topbar">
          <div className="downloads-window-dots"><span /><span /><span /></div>
          <span>Flux</span>
          <div />
        </div>
        <div className="downloads-preview-content">
          <aside className="downloads-preview-sidebar">
            <span className="active" />
            <span />
            <span />
            <span />
          </aside>
          <div className="downloads-preview-library">
            <div className="downloads-preview-title"><span /><span /></div>
            <div className="downloads-preview-posters">
              <span /><span /><span /><span /><span /><span />
            </div>
          </div>
        </div>
      </div>
      <div className="downloads-platform-float downloads-platform-float-one"><IconWindows /></div>
      <div className="downloads-platform-float downloads-platform-float-two"><IconAndroid /></div>
      <div className="downloads-showcase-caption">
        <span className="downloads-showcase-caption-icon"><IconFluxMark /></span>
        <span><strong>One library</strong><small>Four supported platforms</small></span>
      </div>
    </div>
  );
}

function DownloadSkeleton() {
  return (
    <div className="downloads-skeleton" aria-label="Loading latest releases">
      <div className="downloads-skeleton-tabs">
        <span /><span /><span /><span />
      </div>
      <div className="downloads-skeleton-card">
        <span className="downloads-skeleton-icon" />
        <div className="downloads-skeleton-lines"><span /><span /><span /></div>
      </div>
    </div>
  );
}

function getPlatformMeta(platform: PlatformId): PlatformMeta {
  return PLATFORMS.find((item) => item.id === platform)!;
}

function describeAsset(asset: AppReleaseAssetDTO): string {
  return `${FORMAT_LABELS[asset.format]} · ${ARCH_LABELS[asset.arch]} · ${formatSize(asset.size)}`;
}

function pickPrimary(
  platform: Exclude<PlatformId, 'android'>,
  arch: ReleaseArch,
  assets: AppReleaseAssetDTO[],
): AppReleaseAssetDTO | undefined {
  if (assets.length === 0) return undefined;

  if (platform === 'windows') {
    const universal = assets.find(
      (asset) => asset.format === 'exe' && asset.arch === 'universal',
    );
    if (universal) return universal;
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

function detectPlatform(): PlatformId | 'unknown' {
  if (typeof navigator === 'undefined') return 'unknown';

  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/macintosh|mac os x/i.test(ua)) return 'macos';
  if (/windows/i.test(ua)) return 'windows';
  if (/linux|crOS/i.test(ua)) return 'linux';
  return 'unknown';
}

function detectArch(): ReleaseArch {
  if (typeof navigator === 'undefined') return 'x64';

  const ua = navigator.userAgent;
  if (/arm64|aarch64/i.test(ua)) return 'arm64';

  const data = (navigator as { userAgentData?: { architecture?: string } }).userAgentData;
  if (data?.architecture && /arm/i.test(data.architecture)) return 'arm64';
  return 'x64';
}

function formatDate(iso: string): string {
  if (!iso) return 'Unknown';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatSize(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 1) return 'Unknown';

  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/* ─── Brand glyphs (monochrome, use currentColor) ─────────────────────────── */

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
  <svg {...iconProps} fill="currentColor">
    <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 00-.402-.533 1.45 1.45 0 00-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 00.314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 01.647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 01-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z" />
  </svg>
);

const IconAndroid = () => (
  <svg {...iconProps} fill="currentColor">
    <path d="M17.523 9.328 19.865 5.71a.706.706 0 0 0-.184-.98.703.703 0 0 0-.98.185l-2.36 3.643a11.743 11.743 0 0 0-8.682 0L5.299 4.914a.704.704 0 0 0-1.164.795l2.342 3.62A9.893 9.893 0 0 0 2.06 17.09h19.88a9.893 9.893 0 0 0-4.417-7.762zM7.189 14.565a1.177 1.177 0 1 1 0-2.354 1.177 1.177 0 0 1 0 2.354zm9.622 0a1.177 1.177 0 1 1 0-2.354 1.177 1.177 0 0 1 0 2.354z" />
  </svg>
);

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


const IconArrow = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

const IconCheck = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="m5 12 4 4L19 6" />
  </svg>
);
