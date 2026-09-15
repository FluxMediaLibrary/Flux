#!/usr/bin/env node
/**
 * Package the Roku channel from apps/roku/src into a sideloadable zip.
 *
 *   node apps/roku/package.mjs            → apps/roku/dist/flux-roku-<version>.zip
 *   node apps/roku/package.mjs --install  → also sideload to $ROKU_DEV_TARGET
 *                                           (needs ROKU_DEV_PASSWORD, curl)
 *
 * The version comes from src/manifest so the zip name and the app's
 * AppVersion() always agree.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'src');
const dist = path.join(here, 'dist');

const manifest = readFileSync(path.join(src, 'manifest'), 'utf8');
const field = (name) => manifest.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim() ?? '0';
const version = `${field('major_version')}.${field('minor_version')}.${field('build_version')}`;
const zipPath = path.join(dist, `flux-roku-${version}.zip`);

mkdirSync(dist, { recursive: true });
if (existsSync(zipPath)) rmSync(zipPath);

// Roku requires manifest at the zip root; zip from inside src/.
try {
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path "${path.join(src, '*')}" -DestinationPath "${zipPath}" -Force`], { stdio: 'inherit' });
  } else {
    execFileSync('zip', ['-r', '-q', zipPath, 'manifest', 'source', 'components', 'images'], { cwd: src, stdio: 'inherit' });
  }
} catch (error) {
  console.error('Packaging failed:', error.message);
  process.exit(1);
}
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
