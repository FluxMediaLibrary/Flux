const version = document.querySelector('#version');
const title = document.querySelector('#title');
const summary = document.querySelector('#summary');
const notes = document.querySelector('#notes');
const error = document.querySelector('#error');
const close = document.querySelector('#close');
const later = document.querySelector('#later');
const update = document.querySelector('#update');
const release = document.querySelector('#release');
const progressLabel = document.querySelector('#progress-label');
const progressPercent = document.querySelector('#progress-percent');
const progressBar = document.querySelector('#progress-bar');

function renderNotes(value) {
  notes.replaceChildren();
  let list = null;
  for (const rawLine of String(value || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      list = null;
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      const heading = document.createElement('h2');
      heading.textContent = line.replace(/^#{1,6}\s+/, '');
      notes.append(heading);
      list = null;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!list) {
        list = document.createElement('ul');
        notes.append(list);
      }
      const item = document.createElement('li');
      item.textContent = line.replace(/^[-*]\s+/, '');
      list.append(item);
      continue;
    }
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    notes.append(paragraph);
    list = null;
  }
}

function render(state) {
  if (!state) return;
  const phase = state.phase || 'available';
  const percent = Math.max(0, Math.min(100, Math.round(Number(state.percent) || 0)));
  document.body.dataset.phase = phase;
  version.textContent = state.version ? `Flux Desktop ${state.version}` : 'Desktop update';
  renderNotes(state.notes);
  release.style.display = state.releaseUrl ? 'inline-flex' : 'none';
  error.textContent = state.error || 'Flux could not download this update. Check your connection and try again.';
  progressBar.style.width = `${percent}%`;
  progressPercent.textContent = `${percent}%`;

  if (phase === 'available') {
    title.textContent = state.title || 'A new cut is ready.';
    summary.textContent = 'Review what changed, then choose when Flux should update.';
    update.textContent = 'Update and restart';
  } else if (phase === 'downloading') {
    title.textContent = 'Downloading the update.';
    summary.textContent = 'Flux will install it silently and reopen when the download is complete.';
    progressLabel.textContent = 'Downloading update…';
  } else if (phase === 'installing') {
    title.textContent = 'Installing quietly.';
    summary.textContent = 'No installer wizard will appear. Flux will reopen automatically.';
    progressLabel.textContent = 'Restarting Flux…';
  } else if (phase === 'error') {
    title.textContent = 'The update hit a snag.';
    summary.textContent = 'Nothing was installed. You can retry safely.';
    update.textContent = 'Retry download';
  }
}

close.addEventListener('click', () => window.FluxDesktopUpdater.respond('later'));
later.addEventListener('click', () => window.FluxDesktopUpdater.respond('later'));
update.addEventListener('click', () => {
  const action = document.body.dataset.phase === 'error' ? 'retry' : 'update';
  window.FluxDesktopUpdater.respond(action);
});
release.addEventListener('click', () => window.FluxDesktopUpdater.openRelease());

window.FluxDesktopUpdater.onStateChanged(render);
window.FluxDesktopUpdater.getState().then(render);
