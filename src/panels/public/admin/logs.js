const statusEl = document.getElementById('status');
const outEl = document.getElementById('logOut');
const logInput = document.getElementById('logFile');
const linesInput = document.getElementById('logLines');
const logList = document.getElementById('logList');
const downloadLink = document.getElementById('btnDownload');

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function updateDownloadHref() {
  if (!downloadLink || !logInput) return;
  const name = logInput.value || 'app.log';
  downloadLink.href = `/admin/logs/download/${encodeURIComponent(name)}`;
}

async function fetchLogs() {
  try {
    const logFile = logInput.value || 'app.log';
    const lines = parseInt(linesInput.value || '200', 10);
    setStatus(`Fetching ${logFile}…`);
    const res = await fetch('/admin/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logFile, lines }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch logs');
    outEl.textContent = data.logs || '';
    setStatus(`Showing last ${lines} lines of ${logFile}.`);
  } catch (err) {
    outEl.textContent = '';
    setStatus(err.message || 'Failed to fetch logs');
  }
}

async function listLogs() {
  try {
    setStatus('Listing logs…');
    const res = await fetch('/admin/logs/list');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to list logs');
    const files = data.logs || [];
    if (logList) {
      if (!files.length) {
        logList.textContent = 'No .log files found.';
      } else {
        logList.innerHTML = files.map(f => `<div class="mono">${f}</div>`).join('');
      }
    }
    setStatus(`Found ${files.length} log files.`);
  } catch (err) {
    if (logList) logList.textContent = err.message || 'Failed to list logs';
    setStatus(err.message || 'Failed to list logs');
  }
}

async function rotateLog() {
  try {
    const logname = logInput.value || 'app.log';
    const confirmRotate = confirm(`Rotate ${logname}? Current file will be renamed with a timestamp.`);
    if (!confirmRotate) return;
    setStatus('Rotating…');
    const res = await fetch('/admin/logs/rotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logname }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Rotate failed');
    setStatus(`Rotated to ${data.rotatedTo || 'new file'}.`);
    await fetchLogs();
  } catch (err) {
    setStatus(err.message || 'Rotate failed');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  updateDownloadHref();

  document.getElementById('btnFetch')?.addEventListener('click', fetchLogs);
  document.getElementById('btnFetchSecondary')?.addEventListener('click', fetchLogs);
  document.getElementById('btnRotate')?.addEventListener('click', rotateLog);
  document.getElementById('btnList')?.addEventListener('click', listLogs);
  logInput?.addEventListener('input', updateDownloadHref);

  fetchLogs();
});
