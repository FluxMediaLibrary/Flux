import type { MetadataRoute } from 'next';

/**
 * PWA manifest. This is purely additive — browsers ignore it unless a user
 * explicitly installs the app, so the normal in-browser experience is
 * unchanged. It also lets the Android TWA (the installable APK) resolve the
 * app's name, colors, and launcher icon from the live site.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Flux',
    short_name: 'Flux',
    description: 'Your personal media library.',
    start_url: '/library',
    scope: '/',
    display: 'standalone',
    background_color: '#0b1116',
    theme_color: '#0b1116',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
