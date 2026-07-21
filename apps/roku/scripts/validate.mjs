import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const appRoot = path.resolve(import.meta.dirname, '..');
const failures = [];
const legacyVisualTokens = [
  '#F7F9FC', '#B6C0CF', '#121824', '#4B9EFF', '#090B10', '#86C5FF',
  '#78869A', '#F6B84A', '#364154', '#FF6B6B', '#39C78A', '#172B46',
];
const requiredManifest = [
  'title', 'major_version', 'minor_version', 'build_version',
  'mm_icon_focus_fhd', 'mm_icon_focus_hd', 'splash_screen_fhd',
  'splash_screen_hd', 'ui_resolutions', 'flux_server_url',
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
if (manifest.get('major_version') !== '1' || manifest.get('minor_version') !== '0' || manifest.get('build_version') !== '11') {
  failures.push('manifest: expected Roku release version 1.0.11 (major=1, minor=0, build=11)');
}
try {
  const serverUrl = new URL(manifest.get('flux_server_url'));
  if (serverUrl.protocol !== 'https:' || serverUrl.pathname !== '/' || serverUrl.search || serverUrl.hash) {
    failures.push('manifest: flux_server_url must be an HTTPS origin without a path, query, or fragment');
  }
} catch {
  failures.push('manifest: flux_server_url must be a valid absolute URL');
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
const requestTask = fs.readFileSync(path.join(appRoot, 'components', 'tasks', 'ApiRequestTask.brs'), 'utf8');
if (!/IsAssociativeArray\(parsed\)/.test(requestTask) || !/RESPONSE_INVALID/.test(requestTask)) {
  failures.push('components/tasks/ApiRequestTask.brs: successful responses must reject malformed payload roots');
}
for (const file of files) {
  if (!/\.(xml|brs)$/.test(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (/TODO: implement later|Mock data|Fake playback|Temporary solution|For demonstration purposes/i.test(source)) {
    failures.push(`${relative(file)}: contains a forbidden unfinished implementation marker`);
  }
  if (/flux\.personal\.deadstudios\.xyz|Authorization\s*[:=]\s*["'][^"']+["']/i.test(source)) {
    failures.push(`${relative(file)}: contains a hardcoded domain or credential`);
  }
  if (/GetRoSGNode\(\)\s*(?:<>|=)/i.test(source)) {
    failures.push(`${relative(file)}: compares SceneGraph node objects directly`);
  }
  if (/\.SetConnectTimeout\s*\(/i.test(source)) {
    failures.push(`${relative(file)}: calls unsupported roUrlTransfer.SetConnectTimeout`);
  }
  if (/\btransfer\.(?:GetResponseCode|GetToString|PostFromString)\s*\(/i.test(source)) {
    failures.push(`${relative(file)}: uses a synchronous roUrlTransfer response path`);
  }
  const urlEncodeFunction = source.match(/function\s+UrlEncode\b[\s\S]*?end function/i)?.[0];
  if (urlEncodeFunction && (/roUrlTransfer/i.test(urlEncodeFunction) || !/\.EncodeUriComponent\s*\(/i.test(urlEncodeFunction))) {
    failures.push(`${relative(file)}: UrlEncode must use the render-thread-safe string encoder`);
  }
  if (/rowLabelOffset="\[(?!\[)/i.test(source)) {
    failures.push(`${relative(file)}: RowList rowLabelOffset must be an array of vector2d values`);
  }
  if (/showRowLabel="(?:true|false)"/i.test(source)) {
    failures.push(`${relative(file)}: RowList showRowLabel must be an array of Boolean values`);
  }
  if (/rowItemComponentName\s*=/i.test(source)) {
    failures.push(`${relative(file)}: RowList custom renderers must use itemComponentName`);
  }
  if (/<LabelList\b/i.test(source)) {
    failures.push(`${relative(file)}: use the shared FluxActionItem MarkupList instead of a generic LabelList`);
  }
  if (/<(?:Button|ButtonGroup)\b/i.test(source)) {
    failures.push(`${relative(file)}: use FluxActionItem inside MarkupList instead of a generic button control`);
  }
  if (legacyVisualTokens.some((token) => source.includes(token))) {
    failures.push(`${relative(file)}: contains a retired pre-rebuild visual token`);
  }
  if (/\.GetVersion\s*\(/i.test(source)) {
    failures.push(`${relative(file)}: roDeviceInfo.GetVersion is deprecated; use GetOsVersion`);
  }
  if (/accentColor\s*(?:=|<>)\s*""/i.test(source)) {
    failures.push(`${relative(file)}: color fields must not be compared with string values`);
  }
  if (/\.GetChild\([^\r\n]*\)\.GetChild\(/i.test(source)) {
    failures.push(`${relative(file)}: validate each nested ContentNode child before accessing it`);
  }
  if (/\.artwork\./i.test(source)) {
    failures.push(`${relative(file)}: use FluxArtworkUrl so missing artwork cannot crash a screen`);
  }
  for (const uri of source.matchAll(/pkg:\/([^"'\s<]+)/g)) {
    const target = path.join(appRoot, uri[1]);
    if (!fs.existsSync(target)) failures.push(`${relative(file)}: missing ${uri[0]}`);
  }
  if (file.endsWith('.xml')) {
    if (relative(file).startsWith('components/screens/')
      && path.basename(file) !== 'PlayerScreen.xml'
      && !/<FluxBackground\b/i.test(source)) {
      failures.push(`${relative(file)}: every non-player screen must use the shared FluxBackground shell`);
    }
    for (const markupList of source.matchAll(/<MarkupList\b[^>]*>/gi)) {
      if (!/itemComponentName="FluxActionItem"/i.test(markupList[0])) {
        failures.push(`${relative(file)}: every MarkupList must use FluxActionItem`);
      }
    }
    const name = source.match(/<component\s+name="([^"]+)"/)?.[1];
    if (!name) failures.push(`${relative(file)}: component name is missing`);
    else if (componentNames.has(name)) failures.push(`${relative(file)}: duplicate component ${name}`);
    else componentNames.set(name, file);
    const ids = [...source.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicateIds.length) failures.push(`${relative(file)}: duplicate ids ${[...new Set(duplicateIds)].join(', ')}`);
    const controllerPath = file.replace(/\.xml$/i, '.brs');
    if (fs.existsSync(controllerPath)) {
      const controller = fs.readFileSync(controllerPath, 'utf8');
      for (const nodeId of ids.filter((id) => /^[A-Za-z][A-Za-z0-9_]*$/.test(id))) {
        if (new RegExp(`\\bm\\.${nodeId}\\s*\\.`).test(controller)
          && !new RegExp(`\\bm\\.${nodeId}\\s*=\\s*m\\.top\\.findNode\\(["']${nodeId}["']\\)`, 'i').test(controller)) {
          failures.push(`${relative(controllerPath)}: uses m.${nodeId} without caching the ${nodeId} node`);
        }
      }
    }
  }
}

for (const [fileName, requiredFragments] of [
  ['components/screens/HomeScreen.xml', ['<MarkupGrid id="navigation"', 'translation="[72,238]"', 'rowItemSize="[[248,372]]"']],
  ['components/widgets/HeroBanner.xml', ['width="1776" height="390"', '<MarkupGrid id="actions"', 'translation="[94,328]"']],
  ['components/screens/LibraryScreen.xml', ['numColumns="6"', 'itemSize="[248,372]"', 'translation="[72,300]"']],
  ['components/screens/SettingsScreen.xml', ['<MarkupGrid id="categories"', 'numColumns="4"', 'translation="[72,618]"']],
  ['components/screens/ProfileSelectionScreen.xml', ['numColumns="5"', 'translation="[72,522]"']],
  ['components/screens/PlayerScreen.xml', ['translation="[72,874]"', 'width="1776" height="134"']],
  ['components/screens/HomeScreen.brs', ['Continue Watching', 'Server', 'focusContinueWatching']],
  ['components/screens/SettingsScreen.brs', ['"account"', '"server"', '"playback"', '"appearance"', '"developer"', '"debug"', '"about"', '"advanced"', 'm.categories.jumpToItem']],
  ['components/screens/SettingsScreen.xml', ['id="categories"', 'id="actions"']],
  ['components/screens/DetailsScreen.xml', ['id="actions"', 'MarkupGrid', 'trailerRequested']],
  ['components/screens/DetailsScreen.brs', ['detail.trailer.webUrl', 'trailerUrl']],
  ['components/controllers/BrowseController.brs', ['onTrailerRequested', 'trailer.url', 'IsArray(data.rows)', 'retrySelectedSeason', 'retrySelectedEpisode']],
  ['components/controllers/StartupAuthController.brs', ['IsAssociativeArray(payload)', 'Profiles unavailable', 'Profile setup failed']],
  ['components/widgets/MediaCard.brs', ['onPosterLoadStatus', 'm.posterFallback']],
  ['components/widgets/HeroBanner.brs', ['onBackdropLoadStatus', 'm.backdropFallback']],
  ['components/widgets/ProfileCard.brs', ['onAvatarLoadStatus', 'm.avatarFallback']],
  ['components/screens/EpisodeScreen.brs', ['onBackdropLoadStatus', 'onThumbnailLoadStatus']],
  ['components/screens/LibraryScreen.brs', ['if pageCount < 1 then pageCount = 1']],
  ['components/screens/RequestsScreen.brs', ['Untitled request', 'Unknown status']],
  ['components/screens/SearchScreen.brs', ['applyVoiceQuery', 'm.top.voiceQuery']],
  ['components/screens/PlayerScreen.xml', ['enableUI="false"', 'id="inputCapture"', 'id="playbackMenu"', 'id="subtitleOverlay"', 'id="qualityOverlay"', 'id="subtitleTracks"', 'id="qualityOptions"', 'id="transportOverlay"', 'id="seekFill"', 'id="bufferingOverlay"', 'id="bufferingSpinner"']],
  ['components/screens/PlayerScreen.brs', ['setBufferingVisible', 'state = "buffering"', 'm.inputCapture.SetFocus', 'm.inputCapture.HasFocus']],
  ['components/controllers/PlaybackController.brs', ['onSubtitleTrackSelected', 'onQualitySelected', 'restartPlaybackAt', 'showPlaybackError', 'onPlaybackErrorAction', 'IsAssociativeArray(payload)']],
]) {
  const source = fs.readFileSync(path.join(appRoot, fileName), 'utf8');
  for (const fragment of requiredFragments) {
    if (!source.includes(fragment)) failures.push(`${fileName}: missing rebuilt UI contract ${fragment}`);
  }
}

if (failures.length) {
  console.error(`Roku validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Roku validation passed: ${componentNames.size} components, ${files.length} packaged files.`);
