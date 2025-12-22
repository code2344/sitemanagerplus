const statusEl = document.getElementById('status');
const listEl = document.getElementById('pluginList');

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function renderPlugins(plugins = []) {
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!plugins.length) {
    const div = document.createElement('div');
    div.className = 'callout';
    div.textContent = 'No plugins found. Add a folder under plugins/ with an index.js that exports a Plugin subclass.';
    listEl.appendChild(div);
    return;
  }

  for (const plugin of plugins) {
    const card = document.createElement('div');
    card.className = 'callout';
    const badge = plugin.enabled ? '<span class="badge success">enabled</span>' : '<span class="badge warn">disabled</span>';
    card.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:700">${plugin.name}</div>
          <small class="note">Version ${plugin.version || '1.0.0'}</small>
        </div>
        ${badge}
      </div>
      <div class="toolbar">
        <button class="btn small" data-toggle="${plugin.name}">${plugin.enabled ? 'Disable' : 'Enable'}</button>
      </div>
    `;
    listEl.appendChild(card);
  }
}

async function loadPlugins() {
  try {
    setStatus('Loading plugins…');
    const res = await fetch('/admin/plugins');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load plugins');
    renderPlugins(data.plugins || []);
    setStatus(`Loaded ${data.plugins ? data.plugins.length : 0} plugins.`);
  } catch (err) {
    setStatus(err.message || 'Failed to load plugins');
  }
}

async function togglePlugin(name) {
  if (!name) return;
  try {
    setStatus(`Toggling ${name}…`);
    const res = await fetch(`/admin/plugins/${encodeURIComponent(name)}/toggle`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Toggle failed');
    setStatus(`${name} is now ${data.enabled ? 'enabled' : 'disabled'}.`);
    await loadPlugins();
  } catch (err) {
    setStatus(err.message || 'Toggle failed');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const btnRefresh = document.getElementById('btnRefresh');
  if (btnRefresh) btnRefresh.addEventListener('click', loadPlugins);

  listEl?.addEventListener('click', (e) => {
    const target = e.target;
    if (target && target.dataset && target.dataset.toggle) {
      togglePlugin(target.dataset.toggle);
    }
  });

  loadPlugins();
});
