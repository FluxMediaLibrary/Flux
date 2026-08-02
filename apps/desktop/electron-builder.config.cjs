const path = require('node:path');
const packageMetadata = require('./package.json');

module.exports = {
  appId: 'xyz.deadstudios.flux.desktop',
  productName: 'Flux',
  executableName: 'Flux',
  asar: true,
  compression: 'maximum',
  // discord-rpc's only native optional dependency is a protocol-registration
  // fallback that Electron never loads. Skipping native rebuilds keeps ARM64
  // cross-packaging reliable on hosted x64 runners.
  npmRebuild: false,
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: [
    'src/**/*',
    'renderer/**/*',
    'package.json',
    '!**/node_modules/register-scheme/**',
  ],
  extraMetadata: {
    fluxDiscordClientId: (
      process.env.FLUX_DISCORD_CLIENT_ID
      || packageMetadata.fluxDiscordClientId
      || ''
    ).trim(),
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }],
    icon: path.join('build', 'icon.ico'),
    artifactName: 'Flux-Setup-${version}-${arch}.${ext}',
  },
  nsis: {
    oneClick: false,
    include: path.join('build', 'installer.nsh'),
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Flux',
    deleteAppDataOnUninstall: false,
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    icon: path.join('build', 'icon.png'),
    identity: null,
    category: 'public.app-category.entertainment',
    artifactName: 'Flux-${version}-mac-${arch}.${ext}',
  },
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64', 'arm64'] },
      { target: 'deb', arch: ['x64', 'arm64'] },
      { target: 'rpm', arch: ['x64', 'arm64'] },
    ],
    icon: path.join('build', 'icon.png'),
    category: 'AudioVideo',
    syncDesktopName: true,
    maintainer: 'FluxMediaLibrary',
    synopsis: 'Desktop client for a self-hosted Flux media library',
    artifactName: 'Flux-${version}-linux-${arch}.${ext}',
  },
  publish: {
    provider: 'github',
    owner: 'FluxMediaLibrary',
    repo: 'Flux',
    releaseType: 'release',
  },
};
