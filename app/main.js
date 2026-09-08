// App entry: boot store, init shell, wire store change events to re-render, reflect storage status.

import { initStore, onChange, getState } from './store.js';
import { initShell, renderAll, renderActive, refreshTabs, LIVE_TABS } from './ui/shell.js';
import { renderTripList } from './ui/trip-list.js';
import { idbAvailable } from './db.js';

async function boot() {
  const status = document.getElementById('storage-status');
  // Clear the boot-watchdog timer from index.html — if we got here, the module loaded.
  if (typeof window !== 'undefined' && window.__tpBootFailed) {
    clearTimeout(window.__tpBootFailed);
    window.__tpBootFailed = null;
  }
  if (!idbAvailable()) {
    status.textContent = '⚠️ IndexedDB unavailable — data won\'t persist.';
  }

  await initStore();

  // Re-render relevant surfaces when the store changes (CRUD, write-back, etc.).
  onChange(() => {
    const { tab } = getState();
    // Sidebar list + EV tab visibility always reflect trip changes.
    renderTripList();
    refreshTabs();
    // Active panel re-renders for live updates (itinerary, budget, collections).
    if (LIVE_TABS.has(tab)) renderActive();
  });

  initShell();
  renderAll();

  if (idbAvailable()) {
    const { trips } = getState();
    status.textContent = `${trips.length} trip${trips.length === 1 ? '' : 's'} stored locally`;
  }
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('storage-status').textContent = '⚠️ Failed to start: ' + (e?.message || e);
});