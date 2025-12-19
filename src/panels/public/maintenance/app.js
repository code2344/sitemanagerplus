async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function refresh() {
  try {
    const data = await getJSON('/maintenance');
    const workers = data?.workers || [];
    document.getElementById('wCount').textContent = workers.length;
    const container = document.getElementById('workers');
    container.innerHTML = '';
    workers.forEach(w => {
      const div = document.createElement('div');
      div.className = 'kv';
      div.innerHTML = `<span>Worker #${w?.id} (pid ${w?.pid})</span>
        <span>
          <button class="btn small" data-id="${w?.id}" data-action="restart">Restart</button>
          <button class="btn small outline" data-id="${w?.id}" data-action="force">Force Kill</button>
        </span>`;
      container.appendChild(div);
    });

    const m = data?.maintenance || {};
    document.getElementById('mEnabled').textContent = m?.enabled ? 'Yes' : 'No';
  } catch (err) {
    console.error('Refresh error:', err);
  }
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

async function exportSmp() {
  window.location.href = '/maintenance/backups/export-smp';
}

async function importSmpUrl() {
  const url = document.getElementById('importUrl').value.trim();
  if (!url) { alert('Enter a URL to import.'); return; }
  const res = await fetch('/maintenance/backups/import-smp-from-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  alert(res.ok ? 'Import completed' : 'Import failed');
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
  const btnExport = document.getElementById('btnExportSmp');
  if (btnExport) btnExport.addEventListener('click', exportSmp);
  const btnImport = document.getElementById('btnImportSmp');
  if (btnImport) btnImport.addEventListener('click', importSmpUrl);
  const btnReg = document.getElementById('btnRegisterHW');
  if (btnReg) btnReg.addEventListener('click', async () => {
    try {
      const resp = await fetch('/maintenance/webauthn/register/start', { method: 'POST' });
      const opts = await resp.json();
      const b64urlToUint8 = (s) => {
        const pad = (str) => str + '==='.slice((str.length + 3) % 4);
        const base64 = pad(s.replace(/-/g, '+').replace(/_/g, '/'));
        const bin = atob(base64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr.buffer;
      };
      const b64ToUint8 = (s) => {
        const bin = atob(s);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr.buffer;
      };
      const publicKey = { ...opts };
      if (typeof publicKey.challenge === 'string') publicKey.challenge = b64urlToUint8(publicKey.challenge);
      if (publicKey.user && typeof publicKey.user.id === 'string') publicKey.user.id = b64ToUint8(publicKey.user.id);
      const cred = await navigator.credentials.create({ publicKey });
      const att = {
        id: cred.id,
        rawId: btoa(String.fromCharCode(...new Uint8Array(cred.rawId))),
        type: cred.type,
        response: {
          clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(cred.response.clientDataJSON))),
          attestationObject: btoa(String.fromCharCode(...new Uint8Array(cred.response.attestationObject)))
        }
      };
      const vr = await fetch('/maintenance/webauthn/register/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(att) });
      alert(vr.ok ? 'Hardware key registered.' : 'Registration failed');
    } catch (e) {
      console.error('HW register error', e);
      alert('Registration failed: ' + (e && e.message ? e.message : 'Type error'));
    }
  });
  const btnReset = document.getElementById('btnResetHW');
  if (btnReset) btnReset.addEventListener('click', async () => {
    const otp = document.getElementById('otpInput').value.trim();
    const res = await fetch('/maintenance/reset-hw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otp }) });
    alert(res.ok ? 'Reset successful. Re-register key.' : 'Invalid OTP or error');
  });

  refresh();
  setInterval(refresh, 8000);
});
