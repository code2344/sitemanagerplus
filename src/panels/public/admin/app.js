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

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnEnable').addEventListener('click', () => toggleMaintenance(true));
  document.getElementById('btnDisable').addEventListener('click', () => toggleMaintenance(false));
  document.getElementById('btnFetchLogs').addEventListener('click', fetchLogs);
  const btnReg = document.getElementById('btnRegisterHW');
  if (btnReg) btnReg.addEventListener('click', async () => {
    const resp = await fetch('/admin/webauthn/register/start', { method: 'POST' });
    const opts = await resp.json();
    const cred = await navigator.credentials.create({ publicKey: opts });
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
  });
  const btnReset = document.getElementById('btnResetHW');
  if (btnReset) btnReset.addEventListener('click', async () => {
    const otp = document.getElementById('otpInput').value.trim();
    const res = await fetch('/admin/reset-hw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otp }) });
    alert(res.ok ? 'Reset successful. Re-register key.' : 'Invalid OTP or error');
  });
  refresh();
  setInterval(refresh, 8000);
});
