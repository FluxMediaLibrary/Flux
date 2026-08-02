const { spawn } = require('node:child_process');
const fs = require('node:fs');

const executable = process.argv[2];
if (!executable) throw new Error('Pass the packaged smoke executable path.');
const logFile = process.argv[3];
const log = logFile ? fs.openSync(logFile, 'a') : 'ignore';

const child = spawn(executable, [], {
  detached: true,
  stdio: ['ignore', log, log],
  env: {
    ...process.env,
    FLUX_DESKTOP_UPDATE_FEED_URL: 'http://127.0.0.1:48766',
    FLUX_DESKTOP_UPDATE_RELEASE_NAME: 'Flux Desktop v0.1.2 Runtime Test',
    FLUX_DESKTOP_UPDATE_RELEASE_NOTES: [
      '## Desktop fixes',
      '',
      '- Shows this changelog before downloading.',
      '- Installs updates silently without an installer wizard.',
      '- Keeps player controls above the operating system dock.',
    ].join('\n'),
  },
});
child.unref();
process.stdout.write(String(child.pid));
