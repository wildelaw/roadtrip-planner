// AI Planner tab: chat transcript, "Plan my trip", tool-call status lines, citations, free-text input.

import { getTrip, loadConversations, getState } from '../store.js';
import { runAgent } from '../ai/agent.js';
import { aiConfig, WEBGPU_MODELS } from '../settings.js';
import { renderMarkdown, escapeHTML } from '../utils/format.js';
import { toast, showApiError } from './toast.js';
import { switchTab } from './shell.js';

// In-memory transcript per trip (rebuilt from saved conversations on render).
const transcripts = new Map(); // tripId -> [{role, content, kind?}]
let running = false;

function modeLabel(cfg) {
  if (cfg.mock) return '🧪 Mock transport';
  if (cfg.isWebGPU) {
    const m = WEBGPU_MODELS.find((x) => x.id === cfg.webgpuModel);
    return `WebGPU · ${m ? m.label : cfg.webgpuModel}`;
  }
  return `${cfg.isCloud ? 'Cloud' : 'Local'} · ${cfg.model}`;
}

export function renderAIPanel(tripId) {
  const panel = document.getElementById('panel-ai');
  const trip = getTrip(tripId);
  const cfg = aiConfig();

  panel.innerHTML = `
    <div class="ai">
      <div class="ai__head">
        ${!trip ? '' : `
          <button class="btn btn--primary" id="ai-plan">🪄 Plan my trip</button>
          <button class="btn" id="ai-view">View itinerary</button>
        `}
        <span class="subtle" style="margin-left:auto">
          ${modeLabel(cfg)}
        </span>
      </div>
      <div class="ai__transcript" id="ai-transcript"></div>
      <div class="ai__composer">
        <textarea id="ai-input" class="input" placeholder="${trip ? 'Ask the agent to plan, adjust, or research something…' : 'Select a trip first'}" ${trip ? '' : 'disabled'}></textarea>
        <button class="btn btn--primary" id="ai-send" ${trip ? '' : 'disabled'}>Send</button>
      </div>
    </div>
  `;

  if (!trip) return;

  const trans = transcripts.get(trip.id) || [];
  if (!transcripts.has(trip.id)) {
    // seed from most recent saved conversation
    loadConversations(trip.id).then((convos) => {
      if (convos.length && !transcripts.has(trip.id)) {
        const last = convos[convos.length - 1];
        const seeded = (last.messages || [])
          .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
          .map((m) => ({ role: m.role, content: m.content, kind: m.role === 'system' ? 'system' : undefined }));
        transcripts.set(trip.id, seeded);
        renderTranscript(trip.id);
      }
    });
  }
  transcripts.set(trip.id, trans);
  renderTranscript(trip.id);

  panel.querySelector('#ai-plan').addEventListener('click', () => startPlan(trip, null));
  panel.querySelector('#ai-view').addEventListener('click', () => switchTab('itinerary'));
  panel.querySelector('#ai-send').addEventListener('click', () => {
    const inp = panel.querySelector('#ai-input');
    const text = inp.value.trim();
    if (!text || running) return;
    inp.value = '';
    startPlan(trip, text);
  });
  panel.querySelector('#ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); panel.querySelector('#ai-send').click(); }
  });
}

function renderTranscript(tripId) {
  const host = document.getElementById('ai-transcript');
  if (!host) return;
  const trans = transcripts.get(tripId) || [];
  if (!trans.length) {
    host.innerHTML = `<div class="empty"><p>Ask the AI to plan your trip, or click <b>Plan my trip</b>. The agent will research with web search (cloud mode) and write items directly into your itinerary.</p></div>`;
    return;
  }
  host.innerHTML = trans.map(renderMessage).join('');
  host.scrollTop = host.scrollHeight;
}

function renderMessage(m) {
  if (m.kind === 'tool' || m.role === 'tool') {
    return `<div class="toolline">${escapeHTML(m.content)}</div>`;
  }
  if (m.kind === 'system' || m.role === 'system') {
    return `<div class="toolline" style="border-color:#fde68a">ℹ️ ${escapeHTML(m.content)}</div>`;
  }
  const role = m.role === 'user' ? 'You' : 'Agent';
  const body = m.role === 'user' ? escapeHTML(m.content) : renderMarkdown(m.content);
  return `<div class="msg msg--${m.role}"><div class="msg__role">${role}</div><div class="bubble">${body}</div></div>`;
}

function pushToolLine(tripId, text) {
  const trans = transcripts.get(tripId) || [];
  trans.push({ role: 'tool', kind: 'tool', content: text });
  transcripts.set(tripId, trans);
  renderTranscript(tripId);
}

async function startPlan(trip, instruction) {
  if (running) return;
  const cfg = aiConfig();
  if (!cfg.mock && cfg.isCloud && !cfg.apiKey) {
    toast('Add an Ollama Cloud API key in Settings first.', 'warn', 0);
    switchTab('settings');
    return;
  }
  running = true;
  setBusy(true);
  const userText = instruction || 'Plan this trip: research with web search where useful, then write a day-by-day itinerary into the app.';
  const trans = transcripts.get(trip.id) || [];
  trans.push({ role: 'user', content: userText });
  transcripts.set(trip.id, trans);
  renderTranscript(trip.id);

  // WebGPU: lazily download + initialize the model on first send. Stream progress into the transcript.
  if (cfg.isWebGPU && !cfg.mock) {
    const { warmUp, isReady } = await import('../ai/webgpu.js');
    if (!isReady()) {
      pushToolLine(trip.id, 'Downloading model (one-time)…');
      const res = await warmUp({
        onProgress: (p) => {
          const pct = p && typeof p.progress === 'number' ? Math.round(p.progress * 100) + '%' : '';
          pushToolLine(trip.id, `Loading model… ${pct || (p?.text || '')}`.trim());
        },
      });
      if (!res.ok) { showApiError(res.error); pushToolLine(trip.id, `Error: ${res.error?.message || 'model load failed'}`); running = false; setBusy(false); return; }
      pushToolLine(trip.id, 'Model ready.');
    }
  }

  try {
    await runAgent(trip, userText, {
      onMessage: ({ role, content }) => {
        if (!content) return;
        const t = transcripts.get(trip.id) || [];
        t.push({ role, content, kind: role === 'system' ? 'system' : undefined });
        transcripts.set(trip.id, t);
        renderTranscript(trip.id);
      },
      onTool: ({ label }) => pushToolLine(trip.id, label),
      onCitations: (urls) => {
        const uniq = [...new Set(urls)].slice(0, 8);
        if (uniq.length) pushToolLine(trip.id, 'Sources: ' + uniq.map((u) => u).join('  '));
      },
      onError: (err) => { showApiError(err); pushToolLine(trip.id, `Error: ${err?.message || 'request failed'}`); },
      onDone: () => {
        // Itinerary may have changed via write-back tools; re-render the itinerary tab.
        import('./shell.js').then(({ renderActive }) => {
          if (getState().tab !== 'itinerary') renderActive();
        });
      },
    });
  } finally {
    running = false;
    setBusy(false);
  }
}

function setBusy(busy) {
  const send = document.getElementById('ai-send');
  const plan = document.getElementById('ai-plan');
  if (send) send.disabled = busy;
  if (plan) plan.disabled = busy;
  if (plan) plan.textContent = busy ? 'Planning…' : '🪄 Plan my trip';
}