// One-off: resize the checked-in Flux logo source into the PNG app icons
// served from public/. Run with: npx --yes -p sharp node scripts/gen-icons.mjs
import sharp from 'sharp';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');
const source = path.join(here, 'flux-logo-source.png');

const jobs = [
  [512, 'icon-512.png'],
  [192, 'icon-192.png'],
  [180, 'apple-icon.png'],
  [64, 'favicon.png'],
];

for (const [size, out] of jobs) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(path.join(pub, out));
  console.log('wrote', out, `${size}x${size}`);
}

await sharp(source)
  .resize(430, 430)
  .extend({ top: 41, right: 41, bottom: 41, left: 41, background: '#0b1116' })
  .png()
  .toFile(path.join(pub, 'icon-maskable-512.png'));
console.log('wrote', 'icon-maskable-512.png', '512x512');

const icoSizes = [16, 32, 48, 64, 128, 256];
const icoImages = await Promise.all(
  icoSizes.map((size) => sharp(source).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoImages.length, 4);

const entries = Buffer.alloc(icoImages.length * 16);
let offset = header.length + entries.length;
for (let index = 0; index < icoImages.length; index += 1) {
  const size = icoSizes[index];
  const image = icoImages[index];
  const entry = index * 16;
  entries.writeUInt8(size === 256 ? 0 : size, entry);
  entries.writeUInt8(size === 256 ? 0 : size, entry + 1);
  entries.writeUInt8(0, entry + 2);
  entries.writeUInt8(0, entry + 3);
  entries.writeUInt16LE(1, entry + 4);
  entries.writeUInt16LE(32, entry + 6);
  entries.writeUInt32LE(image.length, entry + 8);
  entries.writeUInt32LE(offset, entry + 12);
  offset += image.length;
}

await fs.writeFile(path.join(pub, 'favicon.ico'), Buffer.concat([header, entries, ...icoImages]));
console.log('wrote', 'favicon.ico');
