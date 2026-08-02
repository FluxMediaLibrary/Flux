const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const port = Number(process.env.FLUX_SMOKE_PORT || 48766);
const feedDirectory = path.resolve(process.env.FLUX_SMOKE_FEED || '');
const frontendCss = path.resolve(__dirname, '../../../../packages/frontend/app/globals.css');

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="/globals.css" />
    <title>Flux Desktop Smoke Player</title>
    <style>
      html, body { width: 100%; height: 100%; margin: 0; background: #000; }
      .fx-player { width: 100%; height: 100%; }
      .smoke-video { position: absolute; inset: 0; background: radial-gradient(circle at 48% 30%, #293648, #080a0d 62%); }
      .smoke-actions { display: flex; gap: 8px; }
      .smoke-actions button { padding: 8px 12px; border: 1px solid rgba(255,255,255,.24); border-radius: 6px; background: rgba(10,13,17,.74); color: white; }
      #exit-fullscreen { display: none; }
      #player:fullscreen #enter-fullscreen { display: none; }
      #player:fullscreen #exit-fullscreen { display: inline-flex; }
    </style>
  </head>
  <body>
    <div class="watch-stage">
      <media-player class="fx-player fx-player--fill" id="player" data-paused data-controls>
        <div class="smoke-video"></div>
        <div class="fx-chrome">
          <div class="fx-top">
            <div class="fx-titlewrap">
              <div class="fx-title">Runtime smoke test</div>
              <div class="fx-subtitle">Dock-safe controls and update flow</div>
            </div>
            <div class="smoke-actions">
              <button id="check-updates" type="button">Check for updates</button>
            </div>
          </div>
          <button class="fx-timeline" type="button" aria-label="Player timeline probe">
            <span class="fx-seek"><span class="fx-seek-track"><span class="fx-seek-played" style="width:42%"></span></span></span>
          </button>
          <div class="fx-controls">
            <div class="fx-row">
              <button class="fx-btn" id="control-probe" type="button" aria-label="Player controls probe">▶</button>
              <span class="fx-time">18:42 / 44:10</span>
              <span class="fx-spacer"></span>
              <button class="fx-btn" id="enter-fullscreen" type="button" aria-label="Enter media fullscreen">⛶</button>
              <button class="fx-btn" id="exit-fullscreen" type="button" aria-label="Exit media fullscreen">×</button>
            </div>
          </div>
        </div>
      </media-player>
    </div>
    <script>
      const player = document.querySelector('#player');
      const reportLayout = () => {
        const rootStyle = document.documentElement.style.getPropertyValue('--flux-desktop-workarea-bottom') || 'unset';
        const playerStyle = getComputedStyle(player);
        const controlsStyle = getComputedStyle(document.querySelector('.fx-controls'));
        player.setAttribute(
          'aria-label',
          [
            'dock gutter ', rootStyle,
            '; player inset ', playerStyle.getPropertyValue('--fx-player-bottom-inset').trim() || 'unset',
            '; controls bottom ', controlsStyle.bottom,
          ].join(''),
        );
      };
      setTimeout(reportLayout, 500);
      document.querySelector('#check-updates').addEventListener('click', () => window.FluxDesktop.checkForUpdates());
      document.querySelector('#enter-fullscreen').addEventListener('click', (event) => player.requestFullscreen({ navigationUI: 'hide' }));
      document.querySelector('#exit-fullscreen').addEventListener('click', () => document.exitFullscreen());
    </script>
  </body>
</html>`;

function sendFile(request, response, file) {
  const stat = fs.statSync(file);
  const extension = path.extname(file).toLowerCase();
  const type = extension === '.yml' ? 'text/yaml'
    : extension === '.blockmap' ? 'application/octet-stream'
      : 'application/vnd.microsoft.portable-executable';
  const range = /^bytes=(\d+)-(\d*)$/.exec(String(request.headers.range || ''));
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    response.writeHead(206, {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
      'Content-Type': type,
    });
    fs.createReadStream(file, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, {
    'Accept-Ranges': 'bytes',
    'Content-Length': stat.size,
    'Content-Type': type,
  });
  fs.createReadStream(file).pipe(response);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true}');
    return;
  }
  if (url.pathname === '/library') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(page);
    return;
  }
  if (url.pathname === '/globals.css') {
    response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
    fs.createReadStream(frontendCss).pipe(response);
    return;
  }
  const filename = path.basename(decodeURIComponent(url.pathname));
  const target = path.join(feedDirectory, filename);
  if (!filename || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  sendFile(request, response, target);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Flux smoke server listening on http://127.0.0.1:${port}\n`);
});
