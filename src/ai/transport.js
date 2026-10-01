// The AI transport dispatcher (specs/07-ui.md §4.4, REQ-708).
//
// This module is the gate. `TP.environment.aiEnabled` is false under `file://`, and every entry
// point below returns a refusal BEFORE touching a transport — so no code path reaches `fetch` or
// the CDN `import()`, even if a UI guard is bypassed by a stale tab state or a future bug.
//
// The UI guards (the hidden tab, the hidden connection card) exist for the user. This one exists
// for the invariant, and it is the only one that has to hold.

TP.ai = TP.ai || {};

TP.ai.transport = (function () {
  'use strict';

  // Models curated from web-llm's prebuiltAppConfig. All download from the MLC CDN on first use.
  // `tools` records how reliably each one calls functions in the agent loop.
  //
  // Note: web-llm's TVM runtime hard-requires maxStorageBuffersPerShaderStage >= 10 regardless of
  // model size. Older Intel Macs and some integrated GPUs report 8 and cannot run any of these.
  var WEBGPU_MODELS = [
    { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 0.5B', size: '~944 MB VRAM', tools: 'weak' },
    { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B', size: '~1.6 GB VRAM', tools: 'partial' },
    { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B', size: '~879 MB VRAM', tools: 'weak' },
    { id: 'Hermes-3-Llama-3.2-3B-q4f16_1-MLC', label: 'Hermes-3 3B', size: '~2.3 GB VRAM', tools: 'first-class' },
    { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 3B', size: '~2.5 GB VRAM', tools: 'partial' },
  ];

  var DEFAULT_WEBGPU_MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

  var DEFAULTS = {
    mode: 'webgpu',                                  // 'webgpu' | 'cloud' | 'local'
    cloud: { apiKey: '', baseUrl: 'https://ollama.com' },
    local: { baseUrl: 'http://localhost:11434' },
    webgpu: { model: DEFAULT_WEBGPU_MODEL },
    proxyUrl: '',                                    // optional CORS proxy prefix on every AI call
    model: 'qwen2.5:7b',                             // must be tool-capable for the agent loop
    numCtx: 32000,
    maxIterations: 12,
    mock: false,
  };

  // The reason the AI is absent, in one place, so no two surfaces explain it differently.
  var FILE_REASON = 'AI planning needs a web address. This planner is running from a file on your disk, ' +
    'where the browser gives it no web identity — so it cannot reach an AI service, and it will not ' +
    'store a service key somewhere any other local file could read it.';

  function available() {
    return !!(TP.environment && TP.environment.aiEnabled);
  }

  function refusal() {
    return { ok: false, error: { kind: 'unavailable', status: 0, message: FILE_REASON } };
  }

  // ---- Settings ----
  //
  // Per-user state, kept in this browser and deliberately outside the container (REQ-211): a key
  // is not a property of a portable document, and a document that carried one would hand it to
  // everyone it was sent to.

  function storedSettings() {
    var all = TP.store && TP.store.readSettings ? TP.store.readSettings() : {};
    return mergeSettings(DEFAULTS, all.ai || {});
  }

  function saveSettings(next) {
    var merged = mergeSettings(DEFAULTS, next || {});
    if (TP.store && TP.store.writeSettings) TP.store.writeSettings({ ai: merged });
    return merged;
  }

  function resetSettings() {
    if (TP.store && TP.store.writeSettings) TP.store.writeSettings({ ai: clone(DEFAULTS) });
    return clone(DEFAULTS);
  }

  // Resolved, read-only view the transports use.
  function config() {
    var s = storedSettings();
    var isCloud = s.mode === 'cloud';
    var isLocal = s.mode === 'local';
    var isWebGPU = s.mode === 'webgpu';
    var base = String((isCloud ? s.cloud.baseUrl : s.local.baseUrl) || '').replace(/\/+$/, '');
    return {
      mode: s.mode,
      baseUrl: base,
      proxyUrl: String(s.proxyUrl || '').trim(),
      apiKey: isCloud ? String(s.cloud.apiKey || '').trim() : '',
      model: s.model,
      webgpuModel: (s.webgpu && s.webgpu.model) || DEFAULT_WEBGPU_MODEL,
      numCtx: s.numCtx,
      maxIterations: s.maxIterations,
      mock: !!s.mock,
      isCloud: isCloud,
      isLocal: isLocal,
      isWebGPU: isWebGPU,
    };
  }

  function mergeSettings(base, over) {
    var out = clone(base);
    Object.keys(over || {}).forEach(function (k) {
      var o = over[k];
      if (o && typeof o === 'object' && !Array.isArray(o) &&
          base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        out[k] = mergeSettings(base[k], o);
      } else if (o !== undefined) {
        out[k] = o;
      }
    });
    return out;
  }

  // A deep copy that keeps the fields it does not understand, because the settings object it copies
  // contains scalars.
  //
  // The guard on the first line is the whole of it, and its absence was a live defect: `Object.keys`
  // accepts a STRING, and `Object.keys('webgpu')` is `['0','1',…]`, so `clone('webgpu')` recursed into
  // `'w'`, then `'w'[0]`, which is `'w'` again — a stack overflow, not a wrong answer. Since `DEFAULTS`
  // is mostly strings and `storedSettings()` clones it on every read, the entire AI configuration path
  // threw `RangeError: Maximum call stack size exceeded` the moment the AI was enabled. Under `file://`
  // nothing calls it (the panel is not offered at all, REQ-604), which is why it survived that far: the
  // one environment where the AI never runs is the one where this could not be seen.
  function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(clone);
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = clone(v[k]); });
    return out;
  }

  // ---- Routing ----

  function chat(options) {
    if (!available()) return Promise.resolve(refusal());
    var cfg = config();
    // Mock always wins, so the whole agent loop can be exercised with no network and no spend.
    if (cfg.mock) return TP.ai.mock.chat(options, cfg);
    if (cfg.isWebGPU) return TP.ai.webgpu.chat(options, cfg);
    return TP.ai.ollama.chat(options, cfg);
  }

  function testConnection() {
    if (!available()) return Promise.resolve(refusal());
    var cfg = config();
    if (cfg.mock) return TP.ai.mock.testConnection(cfg);
    if (cfg.isWebGPU) return TP.ai.webgpu.testConnection(cfg);
    return TP.ai.ollama.testConnection(cfg);
  }

  // Web search and web fetch exist only on the Ollama Cloud endpoint. The other transports return
  // the same honest "not available in this mode" error rather than silently planning blind.
  function webSearch(options) {
    if (!available()) return Promise.resolve(refusal());
    var cfg = config();
    if (cfg.mock) return TP.ai.mock.webSearch(options);
    if (cfg.isWebGPU) return Promise.resolve(notInMode('Web search'));
    return TP.ai.ollama.webSearch(options, cfg);
  }

  function webFetch(options) {
    if (!available()) return Promise.resolve(refusal());
    var cfg = config();
    if (cfg.mock) return TP.ai.mock.webFetch(options);
    if (cfg.isWebGPU) return Promise.resolve(notInMode('Web fetch'));
    return TP.ai.ollama.webFetch(options, cfg);
  }

  function notInMode(what) {
    return { ok: false, error: { kind: 'http', status: 0, message: what + ' is only available in Ollama Cloud mode.' } };
  }

  // A one-line description of what is answering, for the panel header and the test result.
  function modeLabel(cfg) {
    cfg = cfg || config();
    if (cfg.mock) return 'Mock transport (no network)';
    if (cfg.isWebGPU) {
      var m = findModel(cfg.webgpuModel);
      return 'In this browser · ' + (m ? m.label : cfg.webgpuModel);
    }
    return (cfg.isCloud ? 'Ollama Cloud' : 'Local Ollama') + ' · ' + cfg.model;
  }

  function findModel(id) {
    for (var i = 0; i < WEBGPU_MODELS.length; i++) if (WEBGPU_MODELS[i].id === id) return WEBGPU_MODELS[i];
    return null;
  }

  // Turn a typed transport error into something the user can act on.
  function describeError(error) {
    if (!error) return 'The request failed for no stated reason.';
    var msg = error.message || 'The request failed.';
    if (error.kind === 'unavailable') return msg;
    if (error.kind === 'auth') return 'The service refused the key' + (error.status ? ' (' + error.status + ')' : '') + '. ' + (msg ? msg : 'Check the API key in Settings.');
    if (error.kind === 'cors') return 'The browser blocked the request (CORS). ' + (error.hint || '');
    if (error.kind === 'network') return 'The request never reached the service. ' + (error.hint || msg);
    if (error.kind === 'webgpu') return msg;
    return msg;
  }

  return {
    WEBGPU_MODELS: WEBGPU_MODELS,
    DEFAULT_WEBGPU_MODEL: DEFAULT_WEBGPU_MODEL,
    DEFAULTS: DEFAULTS,
    FILE_REASON: FILE_REASON,
    available: available,
    refusal: refusal,
    config: config,
    storedSettings: storedSettings,
    saveSettings: saveSettings,
    resetSettings: resetSettings,
    chat: chat,
    testConnection: testConnection,
    webSearch: webSearch,
    webFetch: webFetch,
    modeLabel: modeLabel,
    findModel: findModel,
    describeError: describeError,
    notInMode: notInMode,
  };
})();
