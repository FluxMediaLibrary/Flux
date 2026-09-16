#!/usr/bin/env node
/**
 * Package the Roku channel from apps/roku/src into a sideloadable zip.
 *
 *   node apps/roku/package.mjs            → apps/roku/dist/flux-roku-<version>.zip
 *   node apps/roku/package.mjs --install  → also sideload to $ROKU_DEV_TARGET
 *                                           (needs ROKU_DEV_PASSWORD, curl)
 *
 * The version comes from src/manifest so the zip name and the app's
 * AppVersion() always agree. The zip is written by hand (deflate + forward
 * slash entry names) because Roku rejects archives with backslash paths, which
 * is what Compress-Archive / .NET Framework produce on Windows.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'src');
const dist = path.join(here, 'dist');

const manifest = readFileSync(path.join(src, 'manifest'), 'utf8');
const field = (name) => manifest.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim() ?? '0';
const version = `${field('major_version')}.${field('minor_version')}.${field('build_version')}`;
const zipPath = path.join(dist, `flux-roku-${version}.zip`);

// ── minimal zip writer ───────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}
function walk(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, rel));
    else out.push({ rel, full });
  }
  return out;
}
function buildZip(root) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { rel, full } of walk(root)) {
    const data = readFileSync(full);
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const name = Buffer.from(rel, 'utf8');
    const { time, day } = dosDateTime(statSync(full).mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // utf-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + payload.length;
  }
  const centralSize = centrals.reduce((sum, buf) => sum + buf.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ── package ──────────────────────────────────────────────────────────────────
if (!existsSync(path.join(src, 'manifest'))) {
  console.error('apps/roku/src/manifest not found');
  process.exit(1);
}
mkdirSync(dist, { recursive: true });
writeFileSync(zipPath, buildZip(src));
console.log(`Packaged ${zipPath}`);

if (process.argv.includes('--install')) {
  const target = process.env.ROKU_DEV_TARGET;
  const password = process.env.ROKU_DEV_PASSWORD;
  if (!target || !password) {
    console.error('Set ROKU_DEV_TARGET (device IP) and ROKU_DEV_PASSWORD to sideload.');
    process.exit(1);
  }
  execFileSync('curl', ['--silent', '--show-error', '--user', `rokudev:${password}`, '--digest', '-F', 'mysubmit=Install', '-F', `archive=@${zipPath}`, `http://${target}/plugin_install`], { stdio: 'inherit' });
  console.log(`Installed on ${target}`);
}
