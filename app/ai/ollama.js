// Ollama HTTP client. Cloud: https://ollama.com (Bearer key, web search available).
// Local: http://localhost:11434 (no key, no web search). Optional CORS proxy prefix.
//
// All calls go through request() which classifies failures into a typed error so the
// UI can give actionable CORS / auth / network guidance.

import { aiConfig } from '../settings.js';
import { truncate } from '../utils/format.js';
import { mockChat, mockWebSearch, mockWebFetch } from './mock.js';

function resolveUrl(path) {
  const cfg = aiConfig();
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const url = base + path;
  return cfg.proxyUrl ? cfg.proxyUrl.replace(/\/+$/, '') + url : url;
}

function headers(json = true) {
  const cfg = aiConfig();
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  if (cfg.apiKey) h['Authorization'] = `Bearer ${cfg.apiKey}`;
  return h;
}

// Core request with typed error classification.
// Returns { ok:true, data } | { ok:false, error:{kind, status, message} }.
async function request(path, body, { allowEmpty = false } = {}) {
  const cfg = aiConfig();
  if (cfg.mock && path.includes('/v1/chat/completions')) {
    return { ok: true, data: await mockChat(body) };
  }
  let res;
  try {
    res = await fetch(resolveUrl(path), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
  } catch (e) {
    // A fetch() that rejects (not a non-2xx response) is the CORS/network signature.
    return { ok: false, error: { kind: 'network', message: e?.message || 'Failed to fetch', hint: corsHint(cfg) } };
  }

  if (res.status === 401 || res.status === 403) {
    const message = await safeText(res);
    return { ok: false, error: { kind: 'auth', status: res.status, message } };
  }
  if (res.status === 404) {
    const message = await safeText(res);
    return { ok: false, error: { kind: 'http', status: 404, message: message || 'Not found (check base URL and model name).' } };
  }
  if (!res.ok) {
    const message = await safeText(res);
    // Ollama local returns 403 for CORS-blocked origins too.
    if (res.status === 403 && /origin|cors/i.test(message)) {
      return { ok: false, error: { kind: 'cors', status: 403, message, hint: corsHint(cfg) } };
    }
    return { ok: false, error: { kind: 'http', status: res.status, message } };
  }

  if (allowEmpty && res.status === 204) return { ok: true, data: null };
  let data;
  try { data = await res.json(); }
  catch { data = null; }
  return { ok: true, data };
}

async function safeText(res) {
  try { return (await res.text()).slice(0, 600); } catch { return ''; }
}

function corsHint(cfg) {
  if (cfg.mode === 'local') return 'Start Ollama with OLLAMA_ORIGINS=* OLLAMA_HOST=0.0.0.0 ollama serve.';
  return 'Browser may be blocked by CORS. Set a proxy URL in Settings, or route through your own relay.';
}

// ---- Chat (OpenAI-compatible) ----
// options: { messages, tools, model, numCtx, stream:false }
export async function chat(options) {
  const cfg = aiConfig();
  const body = {
    model: options.model || cfg.model,
    messages: options.messages,
    stream: false,
  };
  if (options.tools?.length) body.tools = options.tools;
  // Pass num_ctx through Ollama options (works on both /v1 and native-ish params).
  body.options = { num_ctx: options.numCtx || cfg.numCtx };
  const res = await request('/v1/chat/completions', body);
  return res;
}

// ---- Web search / web fetch (cloud only) ----
export async function webSearch({ query, maxResults = 5 }) {
  const cfg = aiConfig();
  if (cfg.mock) return { ok: true, data: await mockWebSearch({ query }) };
  if (!cfg.isCloud) {
    return { ok: false, error: { kind: 'http', status: 0, message: 'Web search is only available in Ollama Cloud mode.' } };
  }
  const res = await request('/api/web_search', { query, max_results: Math.min(10, maxResults) });
  if (res.ok) res.data = truncateResults(res.data);
  return res;
}

export async function webFetch({ url }) {
  const cfg = aiConfig();
  if (cfg.mock) return { ok: true, data: await mockWebFetch({ url }) };
  if (!cfg.isCloud) {
    return { ok: false, error: { kind: 'http', status: 0, message: 'Web fetch is only available in Ollama Cloud mode.' } };
  }
  const res = await request('/api/web_fetch', { url });
  if (res.ok && res.data?.content) res.data.content = truncate(res.data.content, 8000);
  return res;
}

function truncateResults(data) {
  const results = Array.isArray(data?.results) ? data.results : [];
  return {
    results: results.slice(0, 10).map((r) => ({
      title: r.title,
      url: r.url,
      content: truncate(r.content, 2000),
    })),
  };
}

// ---- Connection probe ----
export async function testConnection() {
  const cfg = aiConfig();
  if (cfg.mode === 'cloud' && !cfg.apiKey) {
    return { ok: false, error: { kind: 'auth', status: 0, message: 'No API key set. Add one in Settings.' } };
  }
  const res = await chat({
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    numCtx: 4096,
  });
  if (!res.ok) return res;
  const content = res.data?.choices?.[0]?.message?.content || '';
  return { ok: true, model: cfg.model, replied: content };
}