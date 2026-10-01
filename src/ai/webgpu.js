// The in-browser WebGPU transport, over @mlc-ai/web-llm (specs/07-ui.md §3.2).
//
// Loaded lazily, and only ever from a served origin: `TP.ai.transport` refuses before this module
// is reached when `aiEnabled` is false (REQ-708), so the CDN `import()` below is unreachable from
// `file://`. Whether an opaque origin could import it at all is Q-1, carried unverified — the
// design does not depend on the answer.
//
// The envelope is the same { ok, data, error } shape the Ollama client returns, so the agent loop
// does not know which of the two answered.

TP.ai.webgpu = (function () {
  'use strict';

  // CDN URL for web-llm. esm.run (jsdelivr) serves a browser-ready bundle; esm.sh emits a
  // Node-flavoured one that references `createRequire` from Node's `module` builtin, which
  // Safari's JS engine lacks. Don't pin a version: the @v1 form 404s on this CDN.
  var WEB_LLM_URL = 'https://esm.run/@mlc-ai/web-llm';

  var enginePromise = null;   // the CreateMLCEngine promise, for the model it was built for
  var loadedModelId = null;
  var progressCb = null;

  // Function-calling is a property of the model, not of web-llm. Only the Hermes line supports it
  // reliably; the others accept `tools` and quietly ignore them.
  var FUNCTION_CALLING_PREFIXES = ['Hermes-2-Pro-', 'Hermes-3-'];

  function supported() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
  }

  function isReady() { return !!(enginePromise && loadedModelId); }
  function readyModel() { return loadedModelId; }

  function describeError(e) {
    if (!e) return 'Unknown error (nothing was thrown).';
    if (e instanceof Error) return e.message || e.name || 'Error with an empty message';
    if (typeof e === 'string') return e;
    return String(e);
  }

  // web-llm (through Apache TVM) hard-requires maxStorageBuffersPerShaderStage >= 10 at runtime
  // init, before any model loads. Older Intel Macs and some integrated GPUs report 8, and there
  // is no model-side workaround. Checking up front turns a cryptic TVM stack trace into advice.
  function checkGpuLimits() {
    if (!supported()) {
      return Promise.resolve({ ok: false, error: { kind: 'webgpu', message:
        'WebGPU is not available in this browser. Use Chrome/Edge 113+, Safari 17+, or enable WebGPU in Firefox (about:config → dom.computepainter.enabled).' } });
    }
    return navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then(function (adapter) {
      if (!adapter) {
        return { ok: false, error: { kind: 'webgpu', message: 'No WebGPU adapter is available. Check that WebGPU is enabled in this browser.' } };
      }
      var limit = (adapter.limits && adapter.limits.maxStorageBuffersPerShaderStage) || 0;
      if (limit < 10) {
        return { ok: false, error: { kind: 'webgpu', message:
          'This GPU reports maxStorageBuffersPerShaderStage=' + limit + ', but web-llm requires at least 10. ' +
          'That is a known limitation on older Intel Macs and some integrated GPUs. Switch to Ollama Cloud ' +
          'or Local Ollama in Settings to use the AI planner.' } };
      }
      return { ok: true };
    }, function (e) {
      return { ok: false, error: { kind: 'webgpu', message: 'The GPU adapter could not be opened: ' + describeError(e) } };
    });
  }

  // Create or reuse the engine for the configured model. Changing the model rebuilds it.
  function getEngine(cfg) {
    var modelId = cfg.webgpuModel;
    if (!TP.ai.transport.findModel(modelId)) modelId = TP.ai.transport.DEFAULT_WEBGPU_MODEL;

    return checkGpuLimits().then(function (limits) {
      if (!limits.ok) return { error: limits.error };

      if (enginePromise && loadedModelId === modelId) {
        return enginePromise.then(function (engine) {
          return engine ? { engine: engine } : { error: { kind: 'webgpu', message: 'The model engine failed to start.' } };
        });
      }

      enginePromise = import(WEB_LLM_URL).then(function (lib) {
        var CreateMLCEngine = lib && lib.CreateMLCEngine;
        if (typeof CreateMLCEngine !== 'function') {
          throw new Error('web-llm loaded but CreateMLCEngine is missing (version mismatch?).');
        }
        return CreateMLCEngine(modelId, {
          initProgressCallback: function (p) { if (progressCb) progressCb(p); },
        });
      }).catch(function (e) {
        throw new Error('The model library could not be loaded from the CDN (' + describeError(e) +
          '). Check the network connection and that esm.run is reachable.');
      });

      return enginePromise.then(function (engine) {
        loadedModelId = modelId;
        return engine ? { engine: engine } : { error: { kind: 'webgpu', message: 'The model engine failed to start.' } };
      }, function (e) {
        enginePromise = null;
        loadedModelId = null;
        return { error: { kind: 'webgpu', message: describeError(e) } };
      });
    });
  }

  // Optional warm-up. The panel calls this before the first send so the one-time download can
  // stream progress into the transcript instead of looking like a hang.
  function warmUp(options) {
    var opts = options || {};
    progressCb = opts.onProgress || null;
    return getEngine(TP.ai.transport.config()).then(function (res) {
      progressCb = null;
      return res.engine ? { ok: true, model: loadedModelId } : { ok: false, error: res.error };
    }, function (e) {
      progressCb = null;
      return { ok: false, error: { kind: 'webgpu', message: describeError(e) } };
    });
  }

  function chat(options, cfg) {
    cfg = cfg || TP.ai.transport.config();
    if (cfg.mock) return TP.ai.mock.chat(options, cfg);

    return getEngine(cfg).then(function (res) {
      if (res.error) return { ok: false, error: res.error };
      var engine = res.engine;

      // web-llm is particular about system messages: the Hermes tool-calling path rejects a
      // user-supplied system message and inserts its own, which then trips an ordering error if
      // the original is still there; the template path rejects a system message anywhere but
      // index 0. Folding every system message into the first user message sidesteps all of it.
      var supportsTools = FUNCTION_CALLING_PREFIXES.some(function (p) {
        return String(loadedModelId || '').indexOf(p) === 0;
      });

      var req = { messages: normalizeMessages(options.messages), stream: false };
      if (options.tools && options.tools.length && supportsTools) req.tools = options.tools;

      return engine.chat.completions.create(req).then(function (data) {
        return { ok: true, data: data };
      }, function (e) {
        return { ok: false, error: { kind: 'webgpu', message: describeError(e) } };
      });
    });
  }

  // Returns a new array containing only user/assistant/tool roles.
  function normalizeMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    var systemText = messages.filter(function (m) { return m.role === 'system'; })
      .map(function (m) { return m.content; }).join('\n\n');
    var out = [];
    var merged = false;
    messages.forEach(function (m) {
      if (m.role === 'system') return;
      if (!merged && m.role === 'user' && systemText) {
        out.push({ role: 'user', content: systemText + '\n\n' + (m.content || '') });
        merged = true;
      } else {
        out.push(m);
      }
    });
    if (!merged && systemText) out.unshift({ role: 'user', content: systemText });
    return out;
  }

  function testConnection(cfg) {
    cfg = cfg || TP.ai.transport.config();
    if (!supported()) {
      return Promise.resolve({ ok: false, error: { kind: 'webgpu', message:
        'WebGPU is not available in this browser. Use Chrome/Edge 113+, Safari 17+, or enable WebGPU in Firefox (about:config → dom.computepainter.enabled).' } });
    }
    return warmUp().then(function (res) {
      if (!res.ok) return res;
      // A load is not a run. Prove inference works, not just that the weights arrived.
      return chat({ messages: [{ role: 'user', content: 'Reply with the single word: ok' }], numCtx: 2048 }, cfg);
    }).then(function (test) {
      if (!test.ok) return test;
      var content = (test.data && test.data.choices && test.data.choices[0] && test.data.choices[0].message && test.data.choices[0].message.content) || '';
      return { ok: true, model: loadedModelId, replied: content };
    });
  }

  return {
    WEB_LLM_URL: WEB_LLM_URL,
    supported: supported,
    isReady: isReady,
    readyModel: readyModel,
    warmUp: warmUp,
    chat: chat,
    testConnection: testConnection,
    checkGpuLimits: checkGpuLimits,
  };
})();
