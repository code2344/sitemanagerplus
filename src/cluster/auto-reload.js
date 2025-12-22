/**
 * Auto-reload script injected into public pages
 * Checks for maintenance/coming-soon mode and reloads if activated
 */
(function () {
  'use strict';

  const CHECK_INTERVAL = 3000; // Check every 3 seconds
  let lastMaintenance = false;
  let lastComingSoon = false;

  async function checkStatus() {
    try {
      const res = await fetch('/admin/page-status', { method: 'GET' });
      if (!res.ok) return;
      const data = await res.json();

      // If maintenance or coming-soon just got enabled, reload
      if ((data.maintenance && !lastMaintenance) || (data.comingSoon && !lastComingSoon)) {
        window.location.reload();
      }

      lastMaintenance = data.maintenance;
      lastComingSoon = data.comingSoon;
    } catch (err) {
      // Silently fail - network error or fetch unavailable
    }
  }

  // Start polling
  setInterval(checkStatus, CHECK_INTERVAL);
})();
