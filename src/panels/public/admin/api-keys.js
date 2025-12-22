const statusEl = document.getElementById('status');
const keysBody = document.getElementById('keysBody');
const newKeyBox = document.getElementById('newKeyBox');
const newKeyEl = document.getElementById('newKey');

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function fmt(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString();
}

function scopesText(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) return '—';
  return scopes.join(', ');
}

function parseScopes(raw) {
  if (!raw) return ['read', 'write'];
  return raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

function renderKeys(keys = []) {
  if (!keysBody) return;
  keysBody.innerHTML = '';
  if (!keys.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6">No keys yet.</td>';
    keysBody.appendChild(tr);
    return;
  }

  for (const key of keys) {
    const tr = document.createElement('tr');
    const status = key.active ? '<span class="badge success">active</span>' : '<span class="badge warn">revoked</span>';
    const expires = key.expiresAt ? fmt(key.expiresAt) : 'none';
    const lastUsed = key.lastUsed ? fmt(key.lastUsed) : 'never';
    tr.innerHTML = `
      <td class="mono">${key.id}</td>
      <td>${key.name || '—'}</td>
      <td>${scopesText(key.scopes)}</td>
      <td>${status}<br/><small class="note">Expires: ${expires}</small></td>
      <td>${lastUsed}</td>
      <td>
        ${key.active ? `<button class="btn small outline" data-revoke="${key.id}">Revoke</button>` : ''}
      </td>
    `;
    keysBody.appendChild(tr);
  }
}

async function loadKeys() {
  try {
    setStatus('Loading keys…');
    const res = await fetch('/admin/api-keys');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load keys');
    renderKeys(data.keys || []);
    setStatus(`Loaded ${data.keys ? data.keys.length : 0} keys.`);
  } catch (err) {
    setStatus(err.message || 'Failed to load keys');
  }
}

async function generateKey() {
  try {
    setStatus('Generating key…');
    const name = document.getElementById('name').value.trim() || 'api-key';
    const scopes = parseScopes(document.getElementById('scopes').value);
    const expiresVal = document.getElementById('expires').value;
    const expiresInDays = expiresVal ? parseInt(expiresVal, 10) : undefined;

    const res = await fetch('/admin/api-keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scopes, expiresInDays }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate key');

    if (newKeyBox && newKeyEl) {
      newKeyEl.textContent = data.key ? data.key.key : 'Generated';
      newKeyBox.style.display = 'block';
    }
    setStatus('Key generated. Copy it now; it cannot be shown again.');
    await loadKeys();
  } catch (err) {
    setStatus(err.message || 'Failed to generate key');
  }
}

async function revokeKey(id) {
  if (!id) return;
  const ok = confirm('Revoke this API key? It will stop working.');
  if (!ok) return;
  try {
    setStatus('Revoking…');
    const res = await fetch(`/admin/api-keys/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to revoke');
    setStatus('Key revoked.');
    await loadKeys();
  } catch (err) {
    setStatus(err.message || 'Failed to revoke');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const btnLoad = document.getElementById('btnLoad');
  const btnReloadTop = document.getElementById('btnReloadTop');
  const btnGenerate = document.getElementById('btnGenerate');

  if (btnLoad) btnLoad.addEventListener('click', loadKeys);
  if (btnReloadTop) btnReloadTop.addEventListener('click', loadKeys);
  if (btnGenerate) btnGenerate.addEventListener('click', generateKey);

  keysBody?.addEventListener('click', (e) => {
    const target = e.target;
    if (target && target.dataset && target.dataset.revoke) {
      revokeKey(target.dataset.revoke);
    }
  });

  loadKeys();
});
