async function getJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function formatBytes(m) {
  const mb = Math.round(m.heapUsed / 1024 / 1024);
  return `${mb} MB`;
}

async function refresh() {
  const data = await getJSON('/admin');
  document.getElementById('sysHealth').textContent = data.system.health?.overall || 'unknown';
  document.getElementById('sysUptime').textContent = `${Math.round(data.system.uptime)}s`;
  document.getElementById('sysMem').textContent = formatBytes(data.system.memory || {});
  document.getElementById('sysWorkers').textContent = `${(data.workers||[]).length}`;

  const st = data.maintenance || {};
  document.getElementById('maintEnabled').textContent = st.enabled ? 'Yes' : 'No';
  document.getElementById('maintReason').textContent = st.reason || '—';
}

async function toggleMaintenance(enabled) {
  if (enabled) {
    const body = {
      reason: document.getElementById('reason').value || '',
      durationMinutes: parseInt(document.getElementById('duration').value || '0', 10) || undefined,
    };
    await fetch('/admin/maintenance/enable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } else {
    await fetch('/admin/maintenance/disable', { method: 'POST' });
  }
  await refresh();
}

async function fetchLogs() {
  const logFile = document.getElementById('logFile').value || 'app.log';
  const lines = parseInt(document.getElementById('logLines').value || '150', 10);
  const res = await fetch('/admin/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logFile, lines }) });
  if (!res.ok) {
    document.getElementById('logs').textContent = 'Failed to fetch logs.';
    return;
  }
  const data = await res.json();
  document.getElementById('logs').textContent = data.logs || '';
}

async function downloadLog() {
  const name = document.getElementById('logNameAction').value || 'app.log';
  window.location.href = `/admin/logs/download/${encodeURIComponent(name)}`;
}

async function rotateLog() {
  const name = document.getElementById('logNameAction').value || 'app.log';
  const res = await fetch('/admin/logs/rotate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logname: name }) });
  alert(res.ok ? 'Rotated' : 'Rotate failed');
}

async function listFiles() {
  const dir = document.getElementById('fmDir').value || '';
  const res = await fetch(`/admin/files/list?dir=${encodeURIComponent(dir)}`);
  const data = await res.json();
  document.getElementById('fmList').textContent = res.ok ? JSON.stringify(data.entries || [], null, 2) : data.error || 'Failed';
}

async function readFile() {
  const file = document.getElementById('fmFile').value.trim();
  if (!file) { alert('File required'); return; }
  const res = await fetch('/admin/files/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }) });
  const data = await res.json();
  if (res.ok) document.getElementById('fmContent').value = data.content || '';
  else alert(data.error || 'Read failed');
}

async function writeFile() {
  const file = document.getElementById('fmFile').value.trim();
  if (!file) { alert('File required'); return; }
  const content = document.getElementById('fmContent').value;
  const res = await fetch('/admin/files/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file, content }) });
  alert(res.ok ? 'Saved' : 'Save failed');
}

async function deleteFile() {
  const file = document.getElementById('fmFile').value.trim();
  if (!file) { alert('File required'); return; }
  const res = await fetch('/admin/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }) });
  alert(res.ok ? 'Deleted' : 'Delete failed');
}

async function setCsp() {
  const policy = document.getElementById('cspInput').value.trim();
  if (!policy) { alert('Enter CSP policy'); return; }
  const res = await fetch('/admin/security/csp/set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policy }) });
  alert(res.ok ? 'CSP saved' : 'Failed to save');
}

async function loadCfg() {
  const res = await fetch('/admin/config/override/get');
  const data = await res.json();
  if (res.ok) document.getElementById('cfgOverride').value = JSON.stringify(data.config || {}, null, 2);
  else alert(data.error || 'Load failed');
}

async function saveCfg() {
  try {
    const text = document.getElementById('cfgOverride').value || '{}';
    const cfg = JSON.parse(text);
    const res = await fetch('/admin/config/override/set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg }) });
    alert(res.ok ? 'Config saved' : 'Save failed');
  } catch (e) { alert('Invalid JSON'); }
}

async function createZip() {
  const res = await fetch('/admin/backups/create-zip', { method: 'POST' });
  const data = await res.json();
  document.getElementById('zipStatus').textContent = res.ok ? JSON.stringify(data, null, 2) : data.error || 'Failed';
}

async function pruneZip() {
  const keep = parseInt(document.getElementById('zipKeep').value || '5', 10);
  const res = await fetch('/admin/backups/prune', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keep }) });
  const data = await res.json();
  document.getElementById('zipStatus').textContent = res.ok ? JSON.stringify(data, null, 2) : data.error || 'Failed';
}

async function snapshot() {
  const res = await fetch('/admin/system/snapshot');
  const data = await res.json();
  document.getElementById('snapshot').textContent = res.ok ? JSON.stringify(data, null, 2) : data.error || 'Failed';
}


window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnEnable').addEventListener('click', () => toggleMaintenance(true));
  document.getElementById('btnDisable').addEventListener('click', () => toggleMaintenance(false));
  document.getElementById('btnFetchLogs').addEventListener('click', fetchLogs);
  const btnDlLog = document.getElementById('btnDownloadLog');
  if (btnDlLog) btnDlLog.addEventListener('click', downloadLog);
  const btnRotLog = document.getElementById('btnRotateLog');
  if (btnRotLog) btnRotLog.addEventListener('click', rotateLog);
  const btnReg = document.getElementById('btnRegisterHW');
  if (btnReg) btnReg.addEventListener('click', async () => {
    try {
      const resp = await fetch('/admin/webauthn/register/start', { method: 'POST' });
      const opts = await resp.json();
      // Convert challenge and user.id to ArrayBuffers
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
      const vr = await fetch('/admin/webauthn/register/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(att) });
      alert(vr.ok ? 'Hardware key registered.' : 'Registration failed');
    } catch (e) {
      console.error('HW register error', e);
      alert('Registration failed: ' + (e && e.message ? e.message : 'Type error'));
    }
  });
  const btnReset = document.getElementById('btnResetHW');
  if (btnReset) btnReset.addEventListener('click', async () => {
    const otp = document.getElementById('otpInput').value.trim();
    const res = await fetch('/admin/reset-hw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otp }) });
    alert(res.ok ? 'Reset successful. Re-register key.' : 'Invalid OTP or error');
  });
  const btnExport = document.getElementById('btnExportSmp');
  if (btnExport) btnExport.addEventListener('click', () => { window.location.href = '/admin/backups/export-smp'; });
  const btnImport = document.getElementById('btnImportSmp');
  if (btnImport) btnImport.addEventListener('click', async () => {
    const url = document.getElementById('importUrl').value.trim();
    if (!url) { alert('Enter a URL to import.'); return; }
    const res = await fetch('/admin/backups/import-smp-from-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const ok = res.ok;
    alert(ok ? 'Import started/completed. Check logs for details.' : 'Import failed');
  });
  const btnImportUpload = document.getElementById('btnImportUpload');
  if (btnImportUpload) btnImportUpload.addEventListener('click', async () => {
    const fileInput = document.getElementById('importFile');
    if (!fileInput.files || !fileInput.files[0]) { alert('Choose a .smp/.zip file'); return; }
    const form = new FormData();
    form.append('file', fileInput.files[0]);
    const res = await fetch('/admin/backups/import-smp-upload', { method: 'POST', body: form });
    alert(res.ok ? 'Upload import completed' : 'Upload import failed');
  });
  const btnLoadAdmin = document.getElementById('btnLoadAdmin');
  if (btnLoadAdmin) btnLoadAdmin.addEventListener('click', async () => {
    try { const data = await getJSON('/admin/accounts/admin/list'); document.getElementById('accountsList').textContent = JSON.stringify(data.users || [], null, 2); }
    catch { document.getElementById('accountsList').textContent = 'Failed to load admin accounts'; }
  });
  const btnLoadMaint = document.getElementById('btnLoadMaint');
  if (btnLoadMaint) btnLoadMaint.addEventListener('click', async () => {
    try { const data = await getJSON('/admin/accounts/maintenance/list'); document.getElementById('accountsList').textContent = JSON.stringify(data.users || [], null, 2); }
    catch { document.getElementById('accountsList').textContent = 'Failed to load maintenance accounts'; }
  });
  const btnAddAccount = document.getElementById('btnAddAccount');
  if (btnAddAccount) btnAddAccount.addEventListener('click', async () => {
    const role = document.getElementById('accountRole').value;
    const username = document.getElementById('accountUser').value.trim();
    const password = document.getElementById('accountPass').value;
    if (!username || !password) { alert('Username and password required'); return; }
    const res = await fetch(`/admin/accounts/${role}/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    alert(res.ok ? 'Account added' : 'Failed to add');
  });
  const btnRemoveAccount = document.getElementById('btnRemoveAccount');
  if (btnRemoveAccount) btnRemoveAccount.addEventListener('click', async () => {
    const role = document.getElementById('accountRole').value;
    const username = document.getElementById('accountUser').value.trim();
    if (!username) { alert('Username required'); return; }
    const res = await fetch(`/admin/accounts/${role}/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
    alert(res.ok ? 'Account removed' : 'Failed to remove');
  });
  const btnListFiles = document.getElementById('btnListFiles');
  if (btnListFiles) btnListFiles.addEventListener('click', listFiles);
  const btnReadFile = document.getElementById('btnReadFile');
  if (btnReadFile) btnReadFile.addEventListener('click', readFile);
  const btnWriteFile = document.getElementById('btnWriteFile');
  if (btnWriteFile) btnWriteFile.addEventListener('click', writeFile);
  const btnDeleteFile = document.getElementById('btnDeleteFile');
  if (btnDeleteFile) btnDeleteFile.addEventListener('click', deleteFile);
  const btnSetCsp = document.getElementById('btnSetCsp');
  if (btnSetCsp) btnSetCsp.addEventListener('click', setCsp);
  const btnLoadCfg = document.getElementById('btnLoadCfg');
  if (btnLoadCfg) btnLoadCfg.addEventListener('click', loadCfg);
  const btnSaveCfg = document.getElementById('btnSaveCfg');
  if (btnSaveCfg) btnSaveCfg.addEventListener('click', saveCfg);
  const btnCreateZip = document.getElementById('btnCreateZip');
  if (btnCreateZip) btnCreateZip.addEventListener('click', createZip);
  const btnPruneZip = document.getElementById('btnPruneZip');
  if (btnPruneZip) btnPruneZip.addEventListener('click', pruneZip);
  const btnSnapshot = document.getElementById('btnSnapshot');
  if (btnSnapshot) btnSnapshot.addEventListener('click', snapshot);
  refresh();
  setInterval(refresh, 8000);
});
