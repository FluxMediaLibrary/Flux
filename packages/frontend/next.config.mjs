import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicApiOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_API_BASE_URL
      ? new URL(process.env.NEXT_PUBLIC_API_BASE_URL).origin
      : '';
  } catch {
    return '';
  }
})();
const connectSources = ["'self'", publicApiOrigin].filter(Boolean).join(' ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle for the Docker image (`next start` equiv).
  output: 'standalone',
  // Build context is the repo root; trace the monorepo so the `@flux/shared`
  // workspace package is copied into the standalone output.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // `@flux/shared` ships as TypeScript source (resolved via tsconfig paths);
  // let Next transpile it as part of the app graph.
  transpilePackages: ['@flux/shared'],
  reactStrictMode: true,
  // Do not leak framework details in response headers.
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://image.tmdb.org; media-src ${connectSources} blob:; connect-src ${connectSources}; worker-src 'self' blob:; frame-src https://www.youtube.com https://www.youtube-nocookie.com` },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
  images: {
    // TMDb poster/backdrop host (proxied metadata still points at TMDb CDN images).
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        pathname: '/t/p/**',
      },
    ],
  },
};

export default nextConfig;
