// Charging tab (EV mode — only shown when trip.vehicle is set).
// Shows charging networks + per-leg min-SoC thresholds, plus a per-day charge-plan summary.

import { getTrip, collectionAdd, collectionUpdate, collectionDelete } from '../store.js';
import { escapeHTML } from '../utils/format.js';
import { fmtDate } from '../utils/dates.js';
import { openModal, field } from './modal.js';
import { toast } from './toast.js';

const SEVERITY = ['danger', 'warn', 'info'];

export function renderCharging(tripId) {
  const panel = document.getElementById('panel-charging');
  const trip = getTrip(tripId);
  if (!trip) {
    panel.innerHTML = `<div class="empty"><h2>No trip selected</h2></div>`;
    return;
  }
  if (!trip.vehicle) {
    panel.innerHTML = `<div class="empty"><h2>EV mode is off</h2><p>Set a vehicle in <b>Edit trip</b> to enable charging planning.</p></div>`;
    return;
  }
  const v = trip.vehicle;
  const networks = trip.chargingNetworks || [];
  const thresholds = trip.minSocThresholds || [];
  const days = trip.days || [];

  panel.innerHTML = `
    <div class="card">
      <div class="card__head"><h2>🔋 ${escapeHTML(v.model)}</h2></div>
      <div class="kv">
        ${v.chargingConvention ? `<dt>Convention</dt><dd>${escapeHTML(v.chargingConvention)}</dd>` : ''}
        ${v.batteryKWh ? `<dt>Battery</dt><dd>${v.batteryKWh} kWh</dd>` : ''}
        ${v.usableRangeMiles ? `<dt>Usable range</dt><dd>${v.usableRangeMiles} mi</dd>` : ''}
        ${v.fullRangeMiles ? `<dt>Full range</dt><dd>${v.fullRangeMiles} mi</dd>` : ''}
        ${v.efficiencyMilesPerKWh ? `<dt>Efficiency</dt><dd>${v.efficiencyMilesPerKWh} mi/kWh</dd>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card__head"><h2>Charging networks</h2><span class="subtle">${networks.length}</span>
        <button class="btn btn--sm btn--primary" data-add="chargingNetworks" style="margin-left:auto">+ Add</button>
      </div>
      ${networks.length ? `<table class="data"><thead><tr><th>Name</th><th>Location</th><th>Network</th><th>NACS adapter</th><th></th></tr></thead><tbody>
        ${networks.map((n) => `<tr>
          <td><strong>${escapeHTML(n.name || '')}</strong></td>
          <td>${escapeHTML(n.location || '—')}</td>
          <td>${escapeHTML(n.network || '—')}</td>
          <td>${n.nacsAdapter ? '✓' : '—'}</td>
          <td><button class="btn--ghost" data-edit="chargingNetworks" data-id="${n.id}">Edit</button><button class="btn--ghost" data-del="chargingNetworks" data-id="${n.id}">Delete</button></td>
        </tr>`).join('')}
      </tbody></table>` : `<p class="subtle mb0">Add networks you plan to use (e.g. Superchargers, Electrify America).</p>`}
    </div>

    <div class="card">
      <div class="card__head"><h2>Min state-of-charge thresholds</h2><span class="subtle">${thresholds.length}</span>
        <button class="btn btn--sm btn--primary" data-add="minSocThresholds" style="margin-left:auto">+ Add</button>
      </div>
      ${thresholds.length ? `<table class="data"><thead><tr><th>Day</th><th>Leg</th><th>Min SoC</th><th>Reason</th><th>Severity</th><th></th></tr></thead><tbody>
        ${thresholds.map((t) => `<tr>
          <td>${escapeHTML(String(t.day ?? '—'))}</td>
          <td>${escapeHTML(t.leg || '—')}</td>
          <td><strong>${escapeHTML(String(t.minSoc ?? '—'))}%</strong></td>
          <td>${escapeHTML(t.reason || '—')}</td>
          <td>${t.severity ? `<span class="badge badge--${t.severity === 'danger' ? 'high' : t.severity === 'warn' ? 'med' : 'low'}">${escapeHTML(t.severity)}</span>` : '—'}</td>
          <td><button class="btn--ghost" data-edit="minSocThresholds" data-id="${t.id}">Edit</button><button class="btn--ghost" data-del="minSocThresholds" data-id="${t.id}">Delete</button></td>
        </tr>`).join('')}
      </tbody></table>` : `<p class="subtle mb0">Set minimum charge you want at the start of each driving leg.</p>`}
    </div>

    <div class="card">
      <div class="card__head"><h2>Per-day charge plan</h2></div>
      ${days.map((d, i) => {
        const chargeItems = (d.items || []).filter((it) => it.flags?.charge);
        const meta = [
          d.drive && `🚗 ${escapeHTML(d.drive)}`,
          d.chargeStops != null && `⚡ ${d.chargeStops} stops`,
          d.nacs && `NACS`,
        ].filter(Boolean).join(' · ');
        if (!meta && !chargeItems.length) return '';
        return `<div class="item" style="grid-template-columns:1fr auto">
          <div>
            <div class="item__title">Day ${i + 1} — ${escapeHTML(fmtDate(d.date))}${d.title ? ' · ' + escapeHTML(d.title) : ''}</div>
            <div class="item__meta">${meta || 'no charge data'}</div>
            ${chargeItems.length ? `<div class="item__meta">⚡ ${chargeItems.map((c) => escapeHTML(c.title) + (c.flags?.minSoc ? ` (min ${escapeHTML(c.flags.minSoc)}%)` : '')).join(' · ')}</div>` : ''}
          </div>
        </div>`;
      }).join('') || `<p class="subtle mb0">No charge stops flagged on any day.</p>`}
    </div>
  `;

  panel.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => fieldModal(trip.id, b.dataset.add, null)));
  panel.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const item = (trip[b.dataset.edit] || []).find((x) => x.id === b.dataset.id);
    if (item) fieldModal(trip.id, b.dataset.edit, item);
  }));
  panel.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => collectionDelete(trip.id, b.dataset.del, b.dataset.id)));
}

function fieldModal(tripId, key, existing) {
  const body = document.createElement('div');
  if (key === 'chargingNetworks') {
    body.appendChild(field('Name', textInput('f-name', existing?.name || '', 'e.g. Supercharger')));
    body.appendChild(field('Location', textInput('f-loc', existing?.location || '', 'e.g. Osaka Bay')));
    body.appendChild(field('Network', textInput('f-network', existing?.network || '', 'e.g. Tesla')));
    body.appendChild(field('NACS adapter', checkbox('f-nacs', !!existing?.nacsAdapter)));
  } else {
    body.appendChild(field('Day (number or date)', textInput('f-day', existing?.day ?? '', 'e.g. 2 or 2025-04-12')));
    body.appendChild(field('Leg', textInput('f-leg', existing?.leg || '', 'e.g. Osaka → Kyoto')));
    body.appendChild(field('Min SoC (%)', numInput('f-minsoc', existing?.minSoc)));
    body.appendChild(field('Reason', textInput('f-reason', existing?.reason || '', 'e.g. long highway stretch')));
    body.appendChild(field('Severity', selectInput('f-sev', SEVERITY, existing?.severity || 'warn')));
  }
  openModal({
    title: `${existing ? 'Edit' : 'Add'} ${key === 'chargingNetworks' ? 'charging network' : 'min-SoC threshold'}`,
    body,
    actions: [{ label: 'Save', kind: 'primary', onclick: async (b, close) => {
      let payload;
      if (key === 'chargingNetworks') {
        payload = {
          name: val(b, 'f-name'), location: val(b, 'f-loc'), network: val(b, 'f-network'),
          nacsAdapter: b.querySelector('#f-nacs').checked,
        };
        if (!payload.name) { alert('Enter a name.'); return; }
      } else {
        const minSoc = numVal(b.querySelector('#f-minsoc').value);
        payload = {
          day: b.querySelector('#f-day').value.trim() || undefined,
          leg: val(b, 'f-leg'), minSoc, reason: val(b, 'f-reason'), severity: val(b, 'f-sev'),
        };
        if (payload.minSoc == null) { alert('Enter a min SoC %.'); return; }
      }
      for (const k of Object.keys(payload)) if (payload[k] == null) delete payload[k];
      if (existing) await collectionUpdate(tripId, key, existing.id, payload);
      else await collectionAdd(tripId, key, payload);
      close();
      toast('Saved.', 'ok');
    } }],
  });
}

function val(b, id) { return b.querySelector(`#${id}`)?.value.trim() || undefined; }
function numVal(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; }
function textInput(id, value, placeholder) {
  const i = document.createElement('input'); i.className = 'input'; i.id = id; i.value = value ?? '';
  if (placeholder) i.placeholder = placeholder; return i;
}
function numInput(id, value) {
  const i = document.createElement('input'); i.className = 'input'; i.id = id; i.type = 'number'; i.value = value ?? ''; return i;
}
function checkbox(id, checked) {
  const i = document.createElement('input'); i.id = id; i.type = 'checkbox'; i.checked = !!checked; return i;
}
function selectInput(id, opts, value) {
  const s = document.createElement('select'); s.className = 'input'; s.id = id;
  s.innerHTML = opts.map((o) => `<option value="${o}">${o}</option>`).join('');
  if (value) s.value = value; return s;
}