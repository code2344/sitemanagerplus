async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function refresh() {
  const data = await getJSON('/maintenance');
  const workers = data.workers || [];
  document.getElementById('wCount').textContent = workers.length;
  const container = document.getElementById('workers');
  container.innerHTML = '';
  workers.forEach(w => {
    const div = document.createElement('div');
    div.className = 'kv';
    div.innerHTML = `<span>Worker #${w.id} (pid ${w.pid})</span>
      <span>
        <button class="btn small" data-id="${w.id}" data-action="restart">Restart</button>
        <button class="btn small outline" data-id="${w.id}" data-action="force">Force Kill</button>
      </span>`;
    container.appendChild(div);
  });

  const m = data.maintenance || {};
  document.getElementById('mEnabled').textContent = m.enabled ? 'Yes' : 'No';
}

async function rollingRestart() {
  await fetch('/maintenance/restart/rolling', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Operator initiated via UI' }) });
  await refresh();
}

async function workerAction(id, action) {
  const ep = action === 'force' ? `/maintenance/restart/worker/${id}/force` : `/maintenance/restart/worker/${id}`;
  await fetch(ep, { method: 'POST' });
  await refresh();
}

async function setMaint(enable) {
  if (enable) {
    await fetch('/admin/maintenance/enable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Ops enable via UI' }) });
  } else {
    await fetch('/admin/maintenance/disable', { method: 'POST' });
  }
  await refresh();
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnRolling').addEventListener('click', rollingRestart);
  document.getElementById('workers').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    workerAction(btn.dataset.id, btn.dataset.action);
  });
  document.getElementById('btnEnableMaint').addEventListener('click', () => setMaint(true));
  document.getElementById('btnDisableMaint').addEventListener('click', () => setMaint(false));

  refresh();
  setInterval(refresh, 8000);
});
