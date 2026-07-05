import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
