// Settings persisted in localStorage (small, synchronous, needed before async boot).
// The Ollama Cloud API key lives here too — see README security note.

const KEY = 'tp.settings';

// WebGPU models curated from web-llm's prebuiltAppConfig. All download from the
// MLC CDN on first use. `tools` indicates tool-calling reliability for the agent loop.
// Note: web-llm's TVM runtime hard-requires maxStorageBuffersPerShaderStage >= 10 regardless
// of model size — older Intel Macs / some integrated GPUs report 8 and cannot run any of these.
export const WEBGPU_MODELS = Object.freeze([
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 0.5B',    size: '~944 MB VRAM', tools: 'weak' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B',    size: '~1.6 GB VRAM', tools: 'partial' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B',    size: '~879 MB VRAM', tools: 'weak' },
  { id: 'Hermes-3-Llama-3.2-3B-q4f16_1-MLC', label: 'Hermes-3 3B',     size: '~2.3 GB VRAM', tools: 'first-class' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',  label: 'Qwen2.5 3B',       size: '~2.5 GB VRAM', tools: 'partial' },
]);

export const DEFAULT_WEBGPU_MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

export const DEFAULTS = Object.freeze({
  mode: 'webgpu', // 'webgpu' | 'cloud' | 'local'
  cloud: { apiKey: '', baseUrl: 'https://ollama.com' },
  local: { baseUrl: 'http://localhost:11434' },
  webgpu: { model: DEFAULT_WEBGPU_MODEL },
  proxyUrl: '',            // optional CORS proxy prefix prepended to all AI calls
  model: 'qwen2.5:7b',     // must be tool-capable for agent mode (used by cloud/local Ollama)
  numCtx: 32000,
  maxIterations: 12,
  mock: false,             // dev toggle -> routes ollama.js through mock.js
});

let cache = null;

export function loadSettings() {
  if (cache) return cache;
  let parsed = {};
  try {
    parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch { parsed = {}; }
  cache = merge(DEFAULTS, parsed);
  return cache;
}

export function saveSettings(next) {
  const merged = merge(DEFAULTS, next);
  cache = merged;
  localStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}

// Resolved, read-only view the AI client uses.
export function aiConfig() {
  const s = loadSettings();
  const isCloud = s.mode === 'cloud';
  const isLocal = s.mode === 'local';
  const isWebGPU = s.mode === 'webgpu';
  const base = (isCloud ? s.cloud.baseUrl : s.local.baseUrl).replace(/\/+$/, '');
  return {
    mode: s.mode,
    baseUrl: base,
    proxyUrl: s.proxyUrl.trim(),
    apiKey: isCloud ? (s.cloud.apiKey || '').trim() : '',
    model: s.model,
    webgpuModel: s.webgpu?.model || DEFAULT_WEBGPU_MODEL,
    numCtx: s.numCtx,
    maxIterations: s.maxIterations,
    mock: !!s.mock,
    isCloud,
    isLocal,
    isWebGPU,
  };
}

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over || {})) {
    if (
      over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) &&
      base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
    ) {
      out[k] = merge(base[k], over[k]);
    } else if (over[k] !== undefined) {
      out[k] = over[k];
    }
  }
  return out;
}