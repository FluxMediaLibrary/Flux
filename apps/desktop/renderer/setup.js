const form = document.querySelector('#server-form');
const input = document.querySelector('#server-url');
const button = document.querySelector('#connect-button');
const status = document.querySelector('#status');
const version = document.querySelector('#version');

async function hydrate() {
  const [config, info] = await Promise.all([
    window.FluxDesktop.getServerConfig(),
    window.FluxDesktop.getAppInfo(),
  ]);
  if (config.serverUrl) input.value = config.serverUrl;
  version.textContent = `Desktop ${info.version} · ${info.platform}`;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  input.disabled = true;
  status.textContent = 'Checking your server...';
  try {
    await window.FluxDesktop.configureServer(input.value);
    status.textContent = 'Connected. Opening Flux...';
  } catch (error) {
    status.textContent = error?.message || 'Flux could not connect to that server.';
    button.disabled = false;
    input.disabled = false;
    input.focus();
  }
});

hydrate().catch(() => {
  status.textContent = 'Desktop settings could not be loaded.';
});
