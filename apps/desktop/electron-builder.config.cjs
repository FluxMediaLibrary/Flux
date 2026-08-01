const path = require('node:path');

module.exports = {
  appId: 'xyz.deadstudios.flux.desktop',
  productName: 'Flux',
  asar: true,
  compression: 'maximum',
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: [
    'src/**/*',
    'renderer/**/*',
    'package.json',
  ],
  extraMetadata: {
    fluxDiscordClientId: (process.env.FLUX_DISCORD_CLIENT_ID || '').trim(),
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: path.join('build', 'icon.ico'),
    artifactName: 'Flux-Setup-${version}-${arch}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Flux',
    deleteAppDataOnUninstall: false,
  },
  publish: {
    provider: 'github',
    owner: 'FluxMediaLibrary',
    repo: 'Flux',
    releaseType: 'release',
  },
};
