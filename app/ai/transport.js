// Transport dispatcher: routes chat() / testConnection() to the right backend based on settings.
// agent.js and tools.js import from here so they don't need to know about webgpu vs ollama.

import { aiConfig } from '../settings.js';
import * as ollama from './ollama.js';

export async function chat(options) {
  const cfg = aiConfig();
  if (cfg.mock) {
    // Mock always wins, regardless of mode (dev toggle).
    const { mockChat } = await import('./mock.js');
    return { ok: true, data: await mockChat(options) };
  }
  if (cfg.isWebGPU) {
    const { chat: gpuChat } = await import('./webgpu.js');
    return gpuChat(options);
  }
  return ollama.chat(options);
}

export async function testConnection() {
  const cfg = aiConfig();
  if (cfg.isWebGPU) {
    const { testConnection: gpuTest } = await import('./webgpu.js');
    return gpuTest();
  }
  return ollama.testConnection();
}

// Re-export ollama's web search/fetch so existing callers keep working.
// WebGPU and local modes both lack a web-search endpoint; ollama.js already returns
// the right "only available in Ollama Cloud mode" error for non-cloud modes.
export const webSearch = ollama.webSearch;
export const webFetch = ollama.webFetch;