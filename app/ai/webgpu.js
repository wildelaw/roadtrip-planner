// In-browser WebGPU transport using @mlc-ai/web-llm. Loaded lazily only when mode === 'webgpu'.
// Exposes the same { ok, data, error } envelope as ollama.js so agent.js can use it unchanged.
//
// Function-calling: web-llm passes `tools` through to engine.chat.completions.create; supported
// models emit tool_calls in the OpenAI shape the agent loop already parses. Smaller models may
// ignore tools entirely and just return text — the agent treats no-tool-calls as "done".

import { aiConfig, WEBGPU_MODELS, DEFAULT_WEBGPU_MODEL } from '../settings.js';

let enginePromise = null;   // singleton CreateMLCEngine promise, keyed by current model
let loadedModelId = null;    // model id the current engine was built for
let progressCb = null;       // optional init-progress callback set via warmUp()

// CDN URL for web-llm. esm.run (jsdelivr) serves a browser-ready bundle; esm.sh emits a
// Node-flavored one that references `createRequire` from Node's `module` builtin, which
// Safari's JS engine lacks (web-llm PR #180). Don't pin a version: the @v1 form 404s on this CDN.
const WEB_LLM_URL = 'https://esm.run/@mlc-ai/web-llm';

function webgpuSupported() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

function knownModel(id) {
  return WEBGPU_MODELS.find((m) => m.id === id) ? id : DEFAULT_WEBGPU_MODEL;
}

// web-llm (via Apache TVM) hard-requires maxStorageBuffersPerShaderStage >= 10 at runtime init,
// before any model loads. Older Intel Macs and some integrated GPUs report 8. There is no
// model-side workaround — detect the limit up front so we can give an actionable message
// instead of a cryptic TVM stack trace.
async function checkGpuLimits() {
  if (!webgpuSupported()) {
    return { ok: false, error: { kind: 'webgpu', message: 'WebGPU is not available in this browser. Use Chrome/Edge 113+, Safari 17+, or enable WebGPU in Firefox (about:config → dom.computepainter.enabled).' } };
  }
  let adapter;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch (e) {
    return { ok: false, error: { kind: 'webgpu', message: `Failed to get a GPU adapter: ${describeError(e)}` } };
  }
  if (!adapter) {
    return { ok: false, error: { kind: 'webgpu', message: 'No WebGPU adapter available. Check that WebGPU is enabled in your browser.' } };
  }
  const limit = adapter.limits?.maxStorageBuffersPerShaderStage ?? 0;
  if (limit < 10) {
    return { ok: false, error: { kind: 'webgpu', message: `This GPU reports maxStorageBuffersPerShaderStage=${limit}, but web-llm requires ≥10. This is a known limitation on older Intel Macs and some integrated GPUs (see web-llm issue #662). Switch to Ollama Cloud or Local Ollama mode in Settings to use the AI planner.` } };
  }
  return { ok: true };
}

function describeError(e) {
  if (!e) return 'Unknown error (no exception thrown).';
  if (e instanceof Error) return e.message || e.name || 'Error with empty message';
  if (typeof e === 'string') return e;
  return String(e);
}

// Lazily create/reuse the MLCEngine for the configured model. If the model changes
// between calls, reload (re-init) the engine with the new id.
async function getEngine() {
  const cfg = aiConfig();
  const modelId = knownModel(cfg.webgpuModel);

  // Pre-flight: check the GPU meets web-llm's hard limits BEFORE we attempt a model load.
  // web-llm requires maxStorageBuffersPerShaderStage >= 10 (TVM runtime constraint, not model-size).
  const limits = await checkGpuLimits();
  if (!limits.ok) return { error: limits.error };

  if (enginePromise && loadedModelId === modelId) {
    const engine = await enginePromise;
    return engine ? { engine } : { error: { kind: 'webgpu', message: 'Engine failed to initialize.' } };
  }

  // (Re)init.
  enginePromise = (async () => {
    let lib;
    try {
      lib = await import(WEB_LLM_URL);
    } catch (e) {
      const msg = `Failed to load @mlc-ai/web-llm from CDN (${describeError(e)}). Check your network connection and that esm.sh is reachable.`;
      console.error('[webgpu]', msg, e);
      throw new Error(msg);
    }
    const CreateMLCEngine = lib.CreateMLCEngine;
    if (typeof CreateMLCEngine !== 'function') {
      throw new Error('web-llm loaded but CreateMLCEngine not found (version mismatch?).');
    }
    const engine = await CreateMLCEngine(modelId, {
      initProgressCallback: (p) => { progressCb?.(p); },
    });
    loadedModelId = modelId;
    return engine;
  })();

  try {
    const engine = await enginePromise;
    return engine ? { engine } : { error: { kind: 'webgpu', message: 'Engine failed to initialize.' } };
  } catch (e) {
    enginePromise = null;
    loadedModelId = null;
    const msg = describeError(e);
    console.error('[webgpu] engine init failed:', e);
    return { error: { kind: 'webgpu', message: msg } };
  }
}

// Optional warm-up path. Call before chat() to start the download and stream progress.
// Reused by testConnection() and the AI panel on first send.
export async function warmUp({ onProgress } = {}) {
  progressCb = onProgress || null;
  try {
    const res = await getEngine();
    return res.engine ? { ok: true, model: loadedModelId } : { ok: false, error: res.error };
  } finally {
    progressCb = null;
  }
}

export function isReady() {
  return !!(enginePromise && loadedModelId);
}

// options: { messages, tools, model, numCtx }
export async function chat(options) {
  const cfg = aiConfig();
  if (cfg.mock) {
    // Defer to the mock path — transport.js handles this, but be safe if called directly.
    const { mockChat } = await import('./mock.js');
    return { ok: true, data: await mockChat(options) };
  }
  const res = await getEngine();
  if (res.error) return { ok: false, error: res.error };
  const engine = res.engine;

  // web-llm is finicky about system messages:
  //  - The Hermes tool-calling path rejects user-supplied system messages (CustomSystemPromptError)
  //    and unshifts its own, which then triggers SystemMessageOrderError if a user system message remains.
  //  - The conversation template path throws SystemMessageOrderError if a system message appears
  //    anywhere but index 0 — including after the Hermes unshift.
  //  - Non-Hermes models throw UnsupportedModelIdError if `tools` is passed.
  // Strategy: fold ALL system messages into the first user message, so the messages array contains
  // only user/assistant/tool roles. This sidesteps every system-message quirk. Strip tools for
  // non-Hermes models (they can't do function calling).
  const FUNCTION_CALLING_PREFIXES = ['Hermes-2-Pro-', 'Hermes-3-'];
  const modelId = loadedModelId || '';
  const supportsTools = FUNCTION_CALLING_PREFIXES.some((p) => modelId.startsWith(p));

  let messages = normalizeMessages(options.messages);
  let tools = undefined;
  if (options.tools?.length && supportsTools) {
    tools = options.tools;
  }

  const req = {
    messages,
    stream: false,
  };
  if (tools?.length) req.tools = tools;

  try {
    const data = await engine.chat.completions.create(req);
    return { ok: true, data };
  } catch (e) {
    console.error('[webgpu] chat failed:', e);
    return { ok: false, error: { kind: 'webgpu', message: describeError(e) } };
  }
}

// Fold all system messages into the first user message. Returns a new messages array with
// only user/assistant/tool roles. web-llm rejects system messages in various ways (see above).
function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const out = [];
  let merged = false;
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (!merged && m.role === 'user' && systemText) {
      out.push({ role: 'user', content: `${systemText}\n\n${m.content || ''}` });
      merged = true;
    } else {
      out.push(m);
    }
  }
  // If there were no user messages to merge into, prepend as a user message.
  if (!merged && systemText) {
    out.unshift({ role: 'user', content: systemText });
  }
  return out;
}

export async function testConnection() {
  if (!webgpuSupported()) {
    return { ok: false, error: { kind: 'webgpu', message: 'WebGPU is not available in this browser. Use Chrome/Edge 113+, Safari 17+, or enable WebGPU in Firefox (about:config → dom.computepainter.enabled).' } };
  }
  const res = await warmUp();
  if (!res.ok) return res;
  // Smoke-test with a tiny prompt so we know inference works, not just load.
  const test = await chat({
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    numCtx: 2048,
  });
  if (!test.ok) return test;
  const content = test.data?.choices?.[0]?.message?.content || '';
  return { ok: true, model: loadedModelId, replied: content };
}