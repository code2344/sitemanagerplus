const statusEl = document.getElementById('status');
const outEl = document.getElementById('metricsOut');

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

async function loadSummary() {
  try {
    setStatus('Loading summary…');
    const res = await fetch('/admin/metrics/summary');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load metrics');
    const pretty = JSON.stringify(data, null, 2);
    if (outEl) outEl.textContent = pretty;
    setStatus('Updated just now.');
  } catch (err) {
    setStatus(err.message || 'Failed to load metrics');
  }
}

async function resetMetrics() {
  try {
    setStatus('Resetting counters…');
    const res = await fetch('/admin/metrics/reset', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Reset failed');
    setStatus('Metrics reset. Refreshing…');
    await loadSummary();
  } catch (err) {
    setStatus(err.message || 'Reset failed');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const btnRefresh = document.getElementById('btnRefresh');
  const btnReset = document.getElementById('btnReset');
  if (btnRefresh) btnRefresh.addEventListener('click', loadSummary);
  if (btnReset) btnReset.addEventListener('click', resetMetrics);
  loadSummary();
});
