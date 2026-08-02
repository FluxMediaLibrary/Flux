const path = require('node:path');
const base = require('./electron-builder.config.cjs');

const version = String(process.env.FLUX_DESKTOP_SMOKE_VERSION || '0.1.2').trim();
const output = String(process.env.FLUX_DESKTOP_SMOKE_OUTPUT || '').trim()
  || path.join('smoke-release', version);

module.exports = {
  ...base,
  appId: 'xyz.deadstudios.flux.desktop.smoke',
  productName: 'Flux Desktop Smoke',
  executableName: 'FluxDesktopSmoke',
  directories: {
    ...base.directories,
    output,
  },
  extraMetadata: {
    ...base.extraMetadata,
    name: 'flux-desktop-smoke',
    productName: 'Flux Desktop Smoke',
    version,
  },
  win: {
    ...base.win,
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'Flux-Desktop-Smoke-Setup-${version}-${arch}.${ext}',
  },
  nsis: {
    ...base.nsis,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: false,
    createStartMenuShortcut: false,
    shortcutName: 'Flux Desktop Smoke',
    uninstallDisplayName: 'Flux Desktop Smoke',
  },
  publish: {
    provider: 'generic',
    url: 'http://127.0.0.1:48766',
  },
};
