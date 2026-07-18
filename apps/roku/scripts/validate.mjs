import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const appRoot = path.resolve(import.meta.dirname, '..');
const failures = [];
const requiredManifest = [
  'title', 'major_version', 'minor_version', 'build_version',
  'mm_icon_focus_fhd', 'mm_icon_focus_hd', 'splash_screen_fhd',
  'splash_screen_hd', 'ui_resolutions',
];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'dist' ? [] : walk(absolute);
    return [absolute];
  });
}

function relative(file) {
  return path.relative(appRoot, file).replaceAll('\\', '/');
}

function pngSize(file) {
  const data = fs.readFileSync(file);
  if (data.length < 24 || data.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

const manifestText = fs.readFileSync(path.join(appRoot, 'manifest'), 'utf8');
const manifest = new Map(
  manifestText.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=');
      return at < 0 ? [line, ''] : [line.slice(0, at), line.slice(at + 1)];
    }),
);
for (const key of requiredManifest) {
  if (!manifest.get(key)) failures.push(`manifest: missing ${key}`);
}
for (const [key, expected] of [
  ['mm_icon_focus_fhd', [540, 405]],
  ['mm_icon_focus_hd', [290, 218]],
  ['splash_screen_fhd', [1920, 1080]],
  ['splash_screen_hd', [1280, 720]],
]) {
  const uri = manifest.get(key)?.replace('pkg:/', '');
  const file = uri ? path.join(appRoot, uri) : '';
  if (!file || !fs.existsSync(file)) {
    failures.push(`manifest: ${key} points to a missing asset`);
    continue;
  }
  const dimensions = pngSize(file);
  if (!dimensions || dimensions.width !== expected[0] || dimensions.height !== expected[1]) {
    failures.push(`${relative(file)}: expected ${expected[0]}x${expected[1]}`);
  }
}
for (const [fileName, expected] of [
  ['placeholder-poster.png', [342, 513]],
  ['placeholder-backdrop.png', [1280, 720]],
]) {
  const file = path.join(appRoot, 'images', fileName);
  const dimensions = fs.existsSync(file) ? pngSize(file) : null;
  if (!dimensions || dimensions.width !== expected[0] || dimensions.height !== expected[1]) {
    failures.push(`images/${fileName}: expected ${expected[0]}x${expected[1]}`);
  }
}

const files = walk(appRoot);
const componentNames = new Map();
for (const file of files) {
  if (!/\.(xml|brs)$/.test(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (/TODO: implement later|Mock data|Fake playback|Temporary solution|For demonstration purposes/i.test(source)) {
    failures.push(`${relative(file)}: contains a forbidden unfinished implementation marker`);
  }
  if (/flux\.personal\.deadstudios\.xyz|Authorization\s*[:=]\s*["'][^"']+["']/i.test(source)) {
    failures.push(`${relative(file)}: contains a hardcoded domain or credential`);
  }
  for (const uri of source.matchAll(/pkg:\/([^"'\s<]+)/g)) {
    const target = path.join(appRoot, uri[1]);
    if (!fs.existsSync(target)) failures.push(`${relative(file)}: missing ${uri[0]}`);
  }
  if (file.endsWith('.xml')) {
    const name = source.match(/<component\s+name="([^"]+)"/)?.[1];
    if (!name) failures.push(`${relative(file)}: component name is missing`);
    else if (componentNames.has(name)) failures.push(`${relative(file)}: duplicate component ${name}`);
    else componentNames.set(name, file);
    const ids = [...source.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicateIds.length) failures.push(`${relative(file)}: duplicate ids ${[...new Set(duplicateIds)].join(', ')}`);
  }
}

if (failures.length) {
  console.error(`Roku validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Roku validation passed: ${componentNames.size} components, ${files.length} packaged files.`);
