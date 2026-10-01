// The Ollama HTTP client (specs/07-ui.md §3.2).
//
// Cloud: https://ollama.com — Bearer key, web search available.
// Local: http://localhost:11434 — no key, no web search.
// An optional CORS proxy prefix can be put in front of either.
//
// Every call goes through request(), which classifies failures into a typed error rather than
// letting a rejected promise reach the UI as "TypeError: Failed to fetch". The classification is
// the whole value here: a CORS block and a bad key are the same exception and need completely
// different advice.

TP.ai.ollama = (function () {
  'use strict';

  function resolveUrl(path, cfg) {
    var base = String(cfg.baseUrl || '').replace(/\/+$/, '');
    var url = base + path;
    if (!cfg.proxyUrl) return url;
    return String(cfg.proxyUrl).replace(/\/+$/, '') + url;
  }

  function headers(cfg, json) {
    var h = {};
    if (json !== false) h['Content-Type'] = 'application/json';
    if (cfg.apiKey) h['Authorization'] = 'Bearer ' + cfg.apiKey;
    return h;
  }

  // Returns { ok:true, data } | { ok:false, error:{kind, status?, message, hint?} }.
  function request(path, body, cfg, options) {
    var opts = options || {};
    var url = resolveUrl(path, cfg);
    return fetch(url, {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify(body),
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        return safeText(res).then(function (message) {
          // Ollama local also answers 403 for an origin it will not serve. The wording is what
          // tells the two apart, and they need opposite advice.
          if (res.status === 403 && /origin|cors/i.test(message)) {
            return { ok: false, error: { kind: 'cors', status: 403, message: message, hint: corsHint(cfg) } };
          }
          return { ok: false, error: { kind: 'auth', status: res.status, message: message } };
        });
      }
      if (res.status === 404) {
        return safeText(res).then(function (message) {
          return { ok: false, error: { kind: 'http', status: 404, message: message || 'Not found (check the base URL and the model name).' } };
        });
      }
      if (!res.ok) {
        return safeText(res).then(function (message) {
          return { ok: false, error: { kind: 'http', status: res.status, message: message } };
        });
      }
      if (opts.allowEmpty && res.status === 204) return { ok: true, data: null };
      return res.json().then(function (data) { return { ok: true, data: data }; },
        function () { return { ok: true, data: null }; });
    }, function (e) {
      // A fetch() that REJECTS — rather than answering with a non-2xx — is the CORS/network
      // signature. There is no status to read; the advice is the only useful output.
      return { ok: false, error: { kind: 'network', message: (e && e.message) || 'Failed to fetch', hint: corsHint(cfg) } };
    });
  }

  function safeText(res) {
    return res.text().then(function (t) { return String(t).slice(0, 600); }, function () { return ''; });
  }

  function corsHint(cfg) {
    if (cfg.mode === 'local') {
      return 'Start Ollama with: OLLAMA_ORIGINS=* OLLAMA_HOST=0.0.0.0 ollama serve';
    }
    return 'The browser may be blocked by CORS. Set a proxy URL in Settings, or route through your own relay.';
  }

  // ---- Chat (OpenAI-compatible) ----
  // options: { messages, tools, model, numCtx }
  function chat(options, cfg) {
    var body = {
      model: options.model || cfg.model,
      messages: options.messages,
      stream: false,
      // num_ctx travels through Ollama's own options object; both the /v1 and native paths read it.
      options: { num_ctx: options.numCtx || cfg.numCtx },
    };
    if (options.tools && options.tools.length) body.tools = options.tools;
    return request('/v1/chat/completions', body, cfg);
  }

  // ---- Web search and fetch (cloud only) ----

  function webSearch(options, cfg) {
    if (!cfg.isCloud) {
      return Promise.resolve({ ok: false, error: { kind: 'http', status: 0, message: 'Web search is only available in Ollama Cloud mode.' } });
    }
    var max = Math.min(10, options.maxResults || 5);
    return request('/api/web_search', { query: options.query, max_results: max }, cfg).then(function (res) {
      if (res.ok) res.data = truncateResults(res.data);
      return res;
    });
  }

  function webFetch(options, cfg) {
    if (!cfg.isCloud) {
      return Promise.resolve({ ok: false, error: { kind: 'http', status: 0, message: 'Web fetch is only available in Ollama Cloud mode.' } });
    }
    return request('/api/web_fetch', { url: options.url }, cfg).then(function (res) {
      if (res.ok && res.data && res.data.content) {
        res.data.content = TP.format.truncate(res.data.content, 8000);
      }
      return res;
    });
  }

  function truncateResults(data) {
    var results = (data && Array.isArray(data.results)) ? data.results : [];
    return {
      results: results.slice(0, 10).map(function (r) {
        return { title: r.title, url: r.url, content: TP.format.truncate(r.content, 2000) };
      }),
    };
  }

  // ---- Connection probe ----

  function testConnection(cfg) {
    if (cfg.mode === 'cloud' && !cfg.apiKey) {
      return Promise.resolve({ ok: false, error: { kind: 'auth', status: 0, message: 'No API key is set. Add one in Settings.' } });
    }
    return chat({
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      numCtx: 4096,
    }, cfg).then(function (res) {
      if (!res.ok) return res;
      var content = (res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content) || '';
      return { ok: true, model: cfg.model, replied: content };
    });
  }

  return {
    chat: chat,
    webSearch: webSearch,
    webFetch: webFetch,
    testConnection: testConnection,
    resolveUrl: resolveUrl,
    corsHint: corsHint,
  };
})();
