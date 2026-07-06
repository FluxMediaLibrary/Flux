// One-off: rasterize the SVG sources in this folder into the PNG app icons
// served from public/. Run with: npx --yes -p sharp node scripts/gen-icons.mjs
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');
const any = path.join(here, 'icon-any.svg');
const maskable = path.join(here, 'icon-maskable.svg');

const jobs = [
  [any, 512, 'icon-512.png'],
  [any, 192, 'icon-192.png'],
  [any, 180, 'apple-icon.png'],
  [maskable, 512, 'icon-maskable-512.png'],
];

for (const [src, size, out] of jobs) {
  await sharp(src, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(path.join(pub, out));
  console.log('wrote', out, `${size}x${size}`);
}
