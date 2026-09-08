// Settings tab: Ollama mode/base URL/key/model/numCtx/maxIterations/proxy/mock + Test connection.

import { loadSettings, saveSettings, aiConfig, DEFAULTS, WEBGPU_MODELS } from '../settings.js';
import { testConnection } from '../ai/transport.js';
import { exportAllTrips } from '../store.js';
import { downloadJSON } from '../io.js';
import { toast, showApiError } from './toast.js';
import { field, openModal, closeModal } from './modal.js';

export function renderSettings() {
  const panel = document.getElementById('panel-settings');
  const s = loadSettings();

  panel.innerHTML = `
    <div class="card">
      <div class="card__head"><h2>Ollama connection</h2><span class="subtle">AI planner uses these settings</span></div>

      <div class="field">
        <label>Mode</label>
        <select id="set-mode">
          <option value="webgpu">In-browser (WebGPU, no key, no chat network)</option>
          <option value="cloud">Ollama Cloud (api key, web search enabled)</option>
          <option value="local">Local Ollama (no key, no web search)</option>
        </select>
      </div>

      <div id="set-webgpu-block">
        <div class="field">
          <label>WebGPU model</label>
          <select id="set-webgpu-model">
            ${WEBGPU_MODELS.map((m) => `<option value="${m.id}">${m.label} — ${m.size} · tools: ${m.tools}</option>`).join('')}
          </select>
          <p class="subtle mb0">Downloads from the MLC CDN on first use (one-time, cached after). Needs WebGPU:
            Chrome/Edge 113+, Safari 17+, or Firefox with <code>dom.computepainter.enabled</code>.
            <strong>Hermes-3 3B</strong> has the best tool-calling for the agent loop; the smallest models plan from knowledge only.</p>
        </div>
        <div class="info">Granite models are not MLC-compiled for the browser. To use Granite, switch to
          <strong>Local Ollama</strong> and run <code>ollama pull granite3.2:8b</code> (or <code>granite-4.0-h-tiny</code>).</div>
      </div>

      <div id="set-cloud-block">
        <div class="field">
          <label>Cloud base URL</label>
          <input id="set-cloud-baseurl" class="input" placeholder="https://ollama.com" />
        </div>
        <div class="field">
          <label>API key</label>
          <div class="flex gap">
            <input id="set-apikey" class="input" type="password" placeholder="ollama.com API key" autocomplete="off" />
            <button class="btn btn--sm" id="set-key-toggle" type="button">Show</button>
            <button class="btn btn--sm btn--danger" id="set-key-clear" type="button">Clear</button>
          </div>
          <p class="subtle mb0">Create a key at <code>ollama.com/settings/keys</code>. Stored only in this browser (localStorage).</p>
        </div>
      </div>

      <div id="set-local-block">
        <div class="field">
          <label>Local base URL</label>
          <input id="set-local-baseurl" class="input" placeholder="http://localhost:11434" />
        </div>
        <div class="info">Browsers are blocked by CORS unless Ollama is started with
          <code>OLLAMA_ORIGINS=* OLLAMA_HOST=0.0.0.0 ollama serve</code>. Local Ollama has no web search endpoint —
          the agent will plan from its own knowledge.
        </div>
      </div>

      <div class="field">
        <label>CORS proxy URL <span class="subtle">(optional)</span></label>
        <input id="set-proxy" class="input" placeholder="e.g. http://localhost:8080/" />
        <p class="subtle mb0">If cloud/local calls are blocked by CORS, prefix every request with this URL (a local
          <code>cors-anywhere</code> or your own relay). The relay can also inject the key server-side.</p>
      </div>

      <div class="row">
        <div class="field"><label>Model</label><input id="set-model" class="input" placeholder="qwen2.5:7b" /></div>
        <div class="field"><label>num_ctx</label><input id="set-numctx" class="input" type="number" min="4096" step="1024" /></div>
        <div class="field"><label>Max agent iterations</label><input id="set-maxiter" class="input" type="number" min="1" max="40" /></div>
      </div>

      <label class="flex gap"><input id="set-mock" type="checkbox" /> Mock transport (dev — no network/spend)</label>

      <hr/>
      <div class="flex gap">
        <button class="btn btn--primary" id="set-save">Save settings</button>
        <button class="btn" id="set-test">Test connection</button>
        <button class="btn btn--danger" id="set-reset">Reset to defaults</button>
      </div>
    </div>

    <div class="card">
      <div class="card__head"><h2>Data</h2></div>
      <p class="subtle">All trips, expenses, and AI conversations are stored in your browser (IndexedDB).
      Nothing is sent anywhere except the Ollama host you configure above.</p>
      <div class="flex gap wrap mt">
        <button class="btn" id="set-import">⬆ Import trip-data.json</button>
        <button class="btn" id="set-export-all">⬇ Export all trips</button>
        <button class="btn btn--danger" id="set-wipe">Delete ALL data</button>
      </div>
      <p class="subtle mt mb0">Import accepts a single <code>trip-data.json</code> file (one trip).
      Per-trip export is on the Itinerary tab. Export-all writes every trip as a JSON array.</p>
    </div>
  `;

  wire(panel, s);
}

function wire(panel, s) {
  const $ = (id) => panel.querySelector(`#${id}`);
  $('set-mode').value = s.mode;
  $('set-webgpu-model').value = s.webgpu?.model || DEFAULTS.webgpu.model;
  $('set-cloud-baseurl').value = s.cloud.baseUrl;
  $('set-apikey').value = s.cloud.apiKey;
  $('set-local-baseurl').value = s.local.baseUrl;
  $('set-proxy').value = s.proxyUrl;
  $('set-model').value = s.model;
  $('set-numctx').value = s.numCtx;
  $('set-maxiter').value = s.maxIterations;
  $('set-mock').checked = !!s.mock;

  const reflectMode = () => {
    const mode = $('set-mode').value;
    $('set-webgpu-block').style.display = mode === 'webgpu' ? '' : 'none';
    $('set-cloud-block').style.display = mode === 'cloud' ? '' : 'none';
    $('set-local-block').style.display = mode === 'local' ? '' : 'none';
  };
  reflectMode();
  $('set-mode').addEventListener('change', reflectMode);

  $('set-key-toggle').addEventListener('click', () => {
    const inp = $('set-apikey');
    const btn = $('set-key-toggle');
    if (inp.type === 'password') { inp.type = 'text'; btn.textContent = 'Hide'; }
    else { inp.type = 'password'; btn.textContent = 'Show'; }
  });
  $('set-key-clear').addEventListener('click', () => { $('set-apikey').value = ''; });

  $('set-save').addEventListener('click', () => {
    saveSettings({
      mode: $('set-mode').value,
      webgpu: { model: $('set-webgpu-model').value || DEFAULTS.webgpu.model },
      cloud: { apiKey: $('set-apikey').value.trim(), baseUrl: $('set-cloud-baseurl').value.trim() || DEFAULTS.cloud.baseUrl },
      local: { baseUrl: $('set-local-baseurl').value.trim() || DEFAULTS.local.baseUrl },
      proxyUrl: $('set-proxy').value.trim(),
      model: $('set-model').value.trim() || DEFAULTS.model,
      numCtx: clampInt($('set-numctx').value, 4096, 200000, DEFAULTS.numCtx),
      maxIterations: clampInt($('set-maxiter').value, 1, 40, DEFAULTS.maxIterations),
      mock: $('set-mock').checked,
    });
    toast('Settings saved.', 'ok');
  });

  $('set-test').addEventListener('click', async () => {
    // Save first so test uses current values.
    $('set-save').click();
    const btn = $('set-test');
    btn.disabled = true; btn.textContent = 'Testing…';
    const res = await testConnection();
    btn.disabled = false; btn.textContent = 'Test connection';
    if (res.ok) toast(`Connected (${aiConfig().mode}). Model ready.`, 'ok');
    else showApiError(res.error);
  });

  $('set-reset').addEventListener('click', () => {
    if (confirm('Reset settings to defaults?')) {
      saveSettings(DEFAULTS);
      renderSettings();
      toast('Settings reset.', 'ok');
    }
  });

  $('set-wipe').addEventListener('click', async () => {
    openModal({
      title: 'Delete ALL data?',
      body: '<p>This permanently deletes every trip, expense, and AI conversation from this browser. Settings are kept. This cannot be undone.</p>',
      actions: [
        { label: 'Delete everything', kind: 'danger', onclick: async (_b, close) => {
          const { wipeAll } = await import('../store.js');
          await wipeAll();
          close();
          toast('All data deleted.', 'ok');
          const { renderAll } = await import('./shell.js');
          renderAll();
        } },
      ],
    });
  });

  $('set-import').addEventListener('click', () => {
    // Reuse the hidden #import-file input wired in shell.js.
    document.getElementById('import-file')?.click();
  });

  $('set-export-all').addEventListener('click', async () => {
    const all = await exportAllTrips();
    if (!all.length) { toast('No trips to export.', 'warn'); return; }
    downloadJSON(all, 'trip-planner-all.json');
    toast(`Exported ${all.length} trip${all.length === 1 ? '' : 's'}.`, 'ok');
  });
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}