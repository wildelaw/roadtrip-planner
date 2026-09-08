// Layout + tab switching.

import { renderTripList } from './trip-list.js';
import { renderItinerary } from './trip-editor.js';
import { renderChecklists } from './checklists.js';
import { renderLodging } from './lodging.js';
import { renderBookings } from './bookings.js';
import { renderPlaces } from './places.js';
import { renderCharging } from './charging.js';
import { renderBudget } from './budget.js';
import { renderAIPanel } from './ai-panel.js';
import { renderSettings } from './settings-view.js';
import { getState, setState, getTrip, importTripData } from '../store.js';
import { readFileAsJSON } from '../io.js';
import { toast, showApiError } from './toast.js';

// Static tab order. The 'charging' tab is shown/hidden dynamically (EV mode).
const STATIC_TABS = ['itinerary', 'checklists', 'lodging', 'bookings', 'places', 'charging', 'budget', 'ai', 'settings'];

// Panels that should live-update when the store changes (others re-render on tab switch).
const LIVE_TABS = new Set(['itinerary', 'checklists', 'lodging', 'bookings', 'places', 'charging', 'budget']);

export function initShell() {
  const bar = document.getElementById('tabs');
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });

  document.getElementById('new-trip-btn').addEventListener('click', () => {
    import('./trip-list.js').then((m) => m.openNewTripModal());
  });

  // Import trip-data.json
  const importBtn = document.getElementById('import-btn');
  const importFile = document.getElementById('import-file');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => handleImport(importFile));
  }

  const search = document.getElementById('trip-search');
  search.addEventListener('input', () => {
    setState({ search: search.value });
    renderTripList();
  });

  initMobileDrawer();
}

// On small screens the sidebar is an off-canvas drawer: the mobile bar's
// ☰ button opens it; the backdrop, a trip selection, or Escape closes it.
function initMobileDrawer() {
  const app = document.getElementById('app');
  const backdrop = document.getElementById('drawer-backdrop');
  const menuBtn = document.getElementById('menu-btn');
  if (!app || !backdrop || !menuBtn) return;

  const setDrawer = (open) => {
    app.classList.toggle('app--drawer-open', open);
    backdrop.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  };

  menuBtn.addEventListener('click', () => setDrawer(!app.classList.contains('app--drawer-open')));
  backdrop.addEventListener('click', () => setDrawer(false));
  document.getElementById('trip-list').addEventListener('click', (e) => {
    if (e.target.closest('.trip-item')) setDrawer(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && app.classList.contains('app--drawer-open')) setDrawer(false);
  });
}

// Which tabs are currently relevant (charging gated on trip.vehicle).
function activeTabs() {
  const trip = getTrip(getState().currentTripId);
  const isEV = !!(trip && trip.vehicle);
  return STATIC_TABS.filter((t) => t !== 'charging' || isEV);
}

export function switchTab(name) {
  if (!STATIC_TABS.includes(name)) return;
  setState({ tab: name });
  const tabs = activeTabs();
  if (!tabs.includes(name)) name = 'itinerary'; // fall back if tab is now hidden
  for (const t of STATIC_TABS) {
    const btn = document.querySelector(`.tab[data-tab="${t}"]`);
    const panel = document.getElementById(`panel-${t}`);
    if (!btn || !panel) continue;
    const on = t === name;
    btn.classList.toggle('tab--active', on);
    btn.hidden = !tabs.includes(t);
    panel.hidden = !on;
  }
  renderActive();
}

// Re-apply tab visibility (e.g. after vehicle set/cleared) without forcing a switch.
export function refreshTabs() {
  const tabs = activeTabs();
  for (const t of STATIC_TABS) {
    const btn = document.querySelector(`.tab[data-tab="${t}"]`);
    if (btn) btn.hidden = !tabs.includes(t);
  }
  if (!tabs.includes(getState().tab)) switchTab('itinerary');
}

export function renderActive() {
  const { tab, currentTripId } = getState();
  switch (tab) {
    case 'checklists': renderChecklists(currentTripId); break;
    case 'lodging': renderLodging(currentTripId); break;
    case 'bookings': renderBookings(currentTripId); break;
    case 'places': renderPlaces(currentTripId); break;
    case 'charging': renderCharging(currentTripId); break;
    case 'budget': renderBudget(currentTripId); break;
    case 'ai': renderAIPanel(currentTripId); break;
    case 'settings': renderSettings(); break;
    case 'itinerary':
    default: renderItinerary(currentTripId);
  }
}

export function renderAll() {
  renderTripList();
  refreshTabs();
  renderActive();
}

// Read a chosen .json file and import it as a trip. Reused by the sidebar Import
// button and the Settings Import button (both drive a hidden #import-file input).
export async function handleImport(inputEl) {
  const file = inputEl.files && inputEl.files[0];
  inputEl.value = ''; // allow re-importing the same file later
  if (!file) return;
  try {
    const obj = await readFileAsJSON(file);
    if (!obj || (!obj.trip && !Array.isArray(obj.days))) {
      toast('File doesn\'t look like trip-data.json (missing "trip" or "days").', 'warn', 0);
      return;
    }
    const trip = await importTripData(obj);
    setState({ tab: 'itinerary' });
    refreshTabs();
    switchTab('itinerary');
    toast(`Imported "${trip.title}" with ${trip.days.length} day${trip.days.length === 1 ? '' : 's'}.`, 'ok');
  } catch (e) {
    showApiError({ kind: 'http', message: e?.message || String(e) });
  }
}

export { LIVE_TABS };