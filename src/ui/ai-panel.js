// The AI Planner tab, and the connection card it owns in Settings
// (specs/07-ui.md §3, §4.2, §4.3).
//
// Three guards stand between a `file://` open and a network request, and this file carries two of
// them: the tab is hidden by the shell's tab filter, this panel would render an explanation if it
// were somehow reached anyway, and `TP.ai.transport` refuses below both (REQ-708). The repetition
// is the point — each one covers a way the others can be bypassed.

TP.ui = TP.ui || {};

TP.ui.aiPanel = (function () {
  'use strict';

  var R = null;
  function r() { R = R || TP.ui.render; return R; }

  var transcripts = Object.create(null);   // docId -> [{role, content, kind}]
  var running = false;

  // ---- The panel ----

  function render(root) {
    if (!TP.ai.transport.available()) {
      r().append(root, unavailableCard());
      return;
    }
    var docId = TP.store.docIdOf(TP.store.container()) || 'unsaved';
    seed(docId);

    var cfg = TP.ai.transport.config();
    var busy = running;

    var planBtn = r().button(busy ? 'Planning…' : 'Plan this trip', function () { start(null); },
      { class: 'btn btn--primary', disabled: busy });
    var sendBtn = r().button('Send', function () { send(); }, { class: 'btn btn--primary', disabled: busy });
    var input = r().el('textarea', {
      class: 'input',
      attrs: { placeholder: 'Ask the agent to plan, adjust, or research something…', rows: '2' },
      disabled: busy,
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendBtn.click(); }
    });

    function send() {
      var text = String(input.value || '').trim();
      if (!text || running) return;
      input.value = '';
      start(text);
    }

    var host = r().el('div', { class: 'ai__transcript', id: 'ai-transcript' });

    r().append(root, r().el('div', { class: 'ai' }, [
      r().el('div', { class: 'ai__head' }, [
        planBtn,
        r().button('View itinerary', function () { TP.ui.shell.setTab('itinerary'); }, { class: 'btn' }),
        r().el('span', { class: 'subtle ml-auto', text: TP.ai.transport.modeLabel(cfg) }),
      ]),
      r().el('div', { class: 'ai__note' }, [
        r().el('span', { class: 'subtle', text: 'Everything the agent writes lands in your trip, and the whole run becomes one commit you can undo or revert.' }),
      ]),
      host,
      r().el('div', { class: 'ai__composer' }, [input, sendBtn]),
    ]));

    renderTranscript(host, docId);
  }

  // Defence in depth (§4.3): if a stale tab state or a future bug reaches this panel, it explains
  // rather than offering a composer that cannot work.
  function unavailableCard() {
    return r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [r().el('h2', { text: 'AI planning' })]),
      callout(),
    ]);
  }

  // REQ-605, verbatim. The three things this copy does on purpose: it names the browser behaviour,
  // it gives the security reason, and it says what is NOT lost — the third is what stops a user
  // concluding the app is a broken version of the one they read about.
  function callout() {
    return r().el('div', { class: 'info info--warn' }, [
      r().el('strong', { text: 'AI planning needs a web address.' }),
      r().el('div', { text: 'This planner is running from a file on your disk, where the browser gives it no web identity — so it cannot reach an AI service, and it will not store a service key somewhere any other local file could read it.' }),
      r().el('div', { text: 'Open the same planner from http(s):// instead and the AI tab appears. Everything else — your itinerary, budget, bookings, checklists, history, import and export — works exactly as it does here, from the file on your disk.' }),
    ]);
  }

  // ---- The transcript ----

  function seed(docId) {
    if (transcripts[docId]) return;
    transcripts[docId] = [];
    var convos = TP.ai.agent.conversationsFor(docId);
    if (!convos.length) return;
    var last = convos[convos.length - 1];
    transcripts[docId] = (last.messages || [])
      .filter(function (m) { return m.role === 'user' || m.role === 'assistant' || m.role === 'system'; })
      .map(function (m) { return { role: m.role, content: m.content, kind: m.role === 'system' ? 'system' : undefined }; });
  }

  function transcriptOf(docId) {
    if (!transcripts[docId]) transcripts[docId] = [];
    return transcripts[docId];
  }

  function push(docId, entry) {
    transcriptOf(docId).push(entry);
    var host = r().byId('ai-transcript');
    if (host) renderTranscript(host, docId);
  }

  function renderTranscript(host, docId) {
    if (!host) return;
    var rows = transcriptOf(docId);
    if (!rows.length) {
      r().mount(host, [r().el('div', { class: 'empty' }, [
        r().el('p', { text: 'Ask the agent to plan this trip, or press “Plan this trip”. It researches with web search where that is available in the current mode, then writes items straight into your itinerary.' }),
      ])]);
      return;
    }
    r().mount(host, rows.map(messageNode));
    host.scrollTop = host.scrollHeight;
  }

  // Copy a message as it was WRITTEN, not as it was rendered.
  //
  // Assistant text reaches the page as DOM (REQ-701) — a `<strong>` where the model wrote `**bold**`,
  // an `<a>` where it wrote `[label](url)` — so selecting the bubble and copying gives the rendered
  // text, with the markup gone and a link's target with it. `m.content` is still the markdown the
  // model sent, and this is what hands that over instead.
  //
  // Both parties' messages carry the button. A prompt is worth being able to lift back out, and it
  // copies exactly what was typed, so the same control is correct for both.
  function copyButton(content) {
    return r().button('Copy', function (e) { copy(e.currentTarget, content); }, {
      class: 'btn btn--ghost btn--sm ml-auto',
      attrs: { 'aria-label': 'Copy this message', title: 'Copy this message as markdown' },
    });
  }

  // The label line above a bubble, with the copy button at its right edge.
  function roleRow(label, content) {
    return r().el('div', { class: 'msg__role' }, [
      r().el('span', { text: label }),
      copyButton(content),
    ]);
  }

  // `copyToClipboard` resolves rather than rejecting, including when the browser refuses — and what
  // it resolves to is a sentence saying what to do by hand, so that is shown rather than swallowed.
  // Success is reported on the button itself, where the person is already looking; a toast would be
  // a second report of one action. (`trip-editor.js` toasts on both, but its copy lives in a dialog
  // that closes, so there a toast is the only place left to say it.)
  //
  // The transient label is per-render: `renderTranscript` rebuilds every row on each push, so a
  // `Copied` can be replaced by a fresh `Copy` while a run is still going. That is the correct end
  // state, and the timer left over from the old button then writes to a node no longer in the
  // document, which does nothing.
  function copy(button, content) {
    var text = content == null ? '' : String(content);
    return TP.io.export.copyToClipboard(text).then(function (res) {
      if (!res.ok) { TP.ui.toast.warn(res.reason); return res; }
      r().mount(button, 'Copied');
      setTimeout(function () { r().mount(button, 'Copy'); }, 1200);
      return res;
    });
  }

  function messageNode(m) {
    if (m.kind === 'tool' || m.role === 'tool') {
      return r().el('div', { class: 'toolline', text: m.content });
    }
    if (m.kind === 'system' || m.role === 'system') {
      return r().el('div', { class: 'toolline toolline--note', text: m.content });
    }
    if (m.role === 'user') {
      return r().el('div', { class: 'msg msg--user' }, [
        roleRow('You', m.content),
        r().el('div', { class: 'bubble', text: m.content }),
      ]);
    }
    // Assistant text is markdown, and it becomes NODES — never a string that turns into markup.
    return r().el('div', { class: 'msg msg--assistant' }, [
      roleRow('Agent', m.content),
      r().el('div', { class: 'bubble' }, [r().markdown(m.content || '')]),
    ]);
  }

  // ---- Running ----

  function start(instruction) {
    if (running) return null;
    var cfg = TP.ai.transport.config();
    var docId = TP.store.docIdOf(TP.store.container()) || 'unsaved';

    if (!cfg.mock && cfg.isCloud && !cfg.apiKey) {
      TP.ui.toast.warn('Add an Ollama Cloud API key in Settings first.');
      TP.ui.shell.setTab('settings');
      return null;
    }

    running = true;
    var text = instruction || 'Plan this trip: research with web search where it helps, then write a day-by-day itinerary into the app.';
    push(docId, { role: 'user', content: text });
    TP.ui.shell.renderActive();

    // WebGPU downloads the model on first use, which takes minutes. Streaming progress into the
    // transcript is the difference between "slow" and "hung".
    var warm = (cfg.isWebGPU && !cfg.mock)
      ? warmUp(docId)
      : Promise.resolve();

    return warm.then(function (ready) {
      if (ready === false) return null;
      return TP.ai.agent.runAgent(text, {
        onMessage: function (m) {
          if (!m.content) return;
          push(docId, { role: m.role, content: m.content, kind: m.role === 'system' ? 'system' : undefined });
        },
        onTool: function (t) { push(docId, { role: 'tool', kind: 'tool', content: t.label }); },
        onCitations: function (urls) {
          push(docId, { role: 'tool', kind: 'tool', content: 'Sources: ' + urls.slice(0, 8).join('  ') });
        },
        onError: function (err) {
          TP.ui.toast.error(TP.ai.transport.describeError(err));
          push(docId, { role: 'tool', kind: 'tool', content: 'Stopped: ' + TP.ai.transport.describeError(err) });
        },
        onDone: function (summary) {
          if (summary.changed) {
            TP.ui.toast.ok('Done. The trip has the agent’s changes, in one commit you can undo.');
            TP.ui.shell.renderAll();
            TP.ui.shell.setTab('itinerary');
          } else {
            TP.ui.toast.info('The agent finished without changing the trip.');
          }
        },
      });
    }).then(function (result) {
      running = false;
      TP.ui.shell.renderActive();
      void warm;
      return result;
    }, function (e) {
      running = false;
      TP.ui.toast.error('The agent stopped unexpectedly: ' + ((e && e.message) || e));
      TP.ui.shell.renderActive();
      return null;
    });
  }

  function warmUp(docId) {
    if (TP.ai.webgpu.isReady()) return Promise.resolve(true);
    push(docId, { role: 'tool', kind: 'tool', content: 'Downloading the model (one time)…' });
    var last = null;
    return TP.ai.webgpu.warmUp({
      onProgress: function (p) {
        var pct = (p && typeof p.progress === 'number') ? Math.round(p.progress * 100) + '%' : '';
        // Progress arrives many times a second; only announce it when the number moves.
        if (pct === last) return;
        last = pct;
        push(docId, { role: 'tool', kind: 'tool', content: ('Loading the model… ' + (pct || (p && p.text) || '')).trim() });
      },
    }).then(function (res) {
      if (res.ok) {
        push(docId, { role: 'tool', kind: 'tool', content: 'Model ready.' });
        return true;
      }
      TP.ui.toast.error(TP.ai.transport.describeError(res.error));
      push(docId, { role: 'tool', kind: 'tool', content: 'Stopped: ' + TP.ai.transport.describeError(res.error) });
      return false;
    });
  }

  // ---- The Settings card ----

  // REQ-604: under `file://` the connection card, Test connection and the CORS proxy are all
  // absent, and the explanatory callout stands in their place. Rendering one INSTEAD of the other
  // is the same guarantee the display toggle gave, with one less piece of state to get wrong.
  function settingsCard() {
    if (!TP.ai.transport.available()) {
      return r().el('div', { class: 'card', id: 'ai-connection' }, [
        r().el('div', { class: 'card__head' }, [r().el('h2', { text: 'AI planning' })]),
        callout(),
      ]);
    }
    return connectionCard();
  }

  function connectionCard() {
    var s = TP.ai.transport.storedSettings();
    var DEFAULTS = TP.ai.transport.DEFAULTS;
    var MODELS = TP.ai.transport.WEBGPU_MODELS;

    var mode = r().el('select', { class: 'input', id: 'set-mode' }, [
      r().el('option', { value: 'webgpu', text: 'In this browser (WebGPU — no key, no chat leaves the machine)' }),
      r().el('option', { value: 'cloud', text: 'Ollama Cloud (API key, web search available)' }),
      r().el('option', { value: 'local', text: 'Local Ollama (no key, no web search)' }),
    ]);
    mode.value = s.mode;

    var webgpuModel = r().el('select', { class: 'input', id: 'set-webgpu-model' },
      MODELS.map(function (m) {
        return r().el('option', { value: m.id, text: m.label + ' — ' + m.size + ' · tools: ' + m.tools });
      }));
    webgpuModel.value = (s.webgpu && s.webgpu.model) || DEFAULTS.webgpu.model;

    var cloudBase = r().el('input', { class: 'input', type: 'text', value: s.cloud.baseUrl });
    var apiKey = r().el('input', { class: 'input', type: 'password', value: s.cloud.apiKey, attrs: { autocomplete: 'off', placeholder: 'ollama.com API key' } });
    var keyToggle = r().button('Show', function () {
      var shown = apiKey.type === 'text';
      apiKey.type = shown ? 'password' : 'text';
      keyToggle.textContent = shown ? 'Show' : 'Hide';
    }, { class: 'btn btn--sm' });
    var keyClear = r().button('Clear', function () { apiKey.value = ''; }, { class: 'btn btn--sm btn--danger' });

    var localBase = r().el('input', { class: 'input', type: 'text', value: s.local.baseUrl });
    var proxy = r().el('input', { class: 'input', type: 'text', value: s.proxyUrl, attrs: { placeholder: 'http://localhost:8080/' } });
    var model = r().el('input', { class: 'input', type: 'text', value: s.model });
    var numCtx = r().el('input', { class: 'input', type: 'number', value: String(s.numCtx), attrs: { min: '4096', step: '1024' } });
    var maxIter = r().el('input', { class: 'input', type: 'number', value: String(s.maxIterations), attrs: { min: '1', max: '40' } });
    var mock = r().el('input', { type: 'checkbox', checked: !!s.mock });

    var webgpuBlock = r().el('div', {}, [
      r().el('div', { class: 'field' }, [r().el('label', { text: 'WebGPU model' }), webgpuModel]),
      r().el('p', { class: 'subtle', text: 'Downloads from the model CDN on first use, one time, and is cached after. Needs WebGPU: Chrome/Edge 113+, Safari 17+, or Firefox with dom.computepainter.enabled. Hermes-3 3B has by far the best tool-calling for the agent loop; the smallest models can only plan from what they already know.' }),
    ]);

    var cloudBlock = r().el('div', {}, [
      r().el('div', { class: 'field' }, [r().el('label', { text: 'Cloud base URL' }), cloudBase]),
      r().el('div', { class: 'field' }, [
        r().el('label', { text: 'API key' }),
        r().el('div', { class: 'flex gap' }, [apiKey, keyToggle, keyClear]),
        r().el('p', { class: 'subtle mb0', text: 'Create a key at ollama.com/settings/keys. It is kept in this browser only, and it is never written into a document — a key inside a file you might send someone would be a key given away. Note that a key stored here is readable by anything else served from this address.' }),
      ]),
    ]);

    var localBlock = r().el('div', {}, [
      r().el('div', { class: 'field' }, [r().el('label', { text: 'Local base URL' }), localBase]),
      r().el('div', { class: 'info', text: 'Browsers block this by default. Start Ollama with OLLAMA_ORIGINS=* OLLAMA_HOST=0.0.0.0 ollama serve to allow it. Local Ollama has no web-search endpoint, so the agent plans from its own knowledge.' }),
    ]);

    function reflectMode() {
      r().show(webgpuBlock, mode.value === 'webgpu');
      r().show(cloudBlock, mode.value === 'cloud');
      r().show(localBlock, mode.value === 'local');
    }
    mode.addEventListener('change', reflectMode);
    reflectMode();

    var testBtn = r().button('Test connection', function () { test(testBtn); }, { class: 'btn' });

    function collect() {
      return {
        mode: mode.value,
        webgpu: { model: webgpuModel.value || DEFAULTS.webgpu.model },
        cloud: { apiKey: String(apiKey.value || '').trim(), baseUrl: String(cloudBase.value || '').trim() || DEFAULTS.cloud.baseUrl },
        local: { baseUrl: String(localBase.value || '').trim() || DEFAULTS.local.baseUrl },
        proxyUrl: String(proxy.value || '').trim(),
        model: String(model.value || '').trim() || DEFAULTS.model,
        numCtx: clampInt(numCtx.value, 4096, 200000, DEFAULTS.numCtx),
        maxIterations: clampInt(maxIter.value, 1, 40, DEFAULTS.maxIterations),
        mock: !!mock.checked,
      };
    }

    return r().el('div', { class: 'card', id: 'ai-connection' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'AI planning' }),
        r().el('span', { class: 'subtle', text: TP.ai.transport.modeLabel() }),
      ]),
      r().el('div', { class: 'field' }, [r().el('label', { text: 'Mode' }), mode]),
      webgpuBlock,
      cloudBlock,
      localBlock,
      r().el('div', { class: 'field' }, [
        r().el('label', {}, [r().el('span', { text: 'CORS proxy URL ' }), r().el('span', { class: 'subtle', text: '(optional)' })]),
        proxy,
        r().el('p', { class: 'subtle mb0', text: 'If cloud or local calls are blocked by the browser, prefix every request with this address — a local cors-anywhere, or your own relay. The declared policy admits the shipped endpoints only, so a custom address here may be blocked by it.' }),
      ]),
      r().el('div', { class: 'row' }, [
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Model' }), model]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Context window' }), numCtx]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Most agent turns' }), maxIter]),
      ]),
      r().el('label', { class: 'flex gap' }, [
        mock,
        r().el('span', { text: 'Mock transport — scripted answers, no network and no spend' }),
      ]),
      r().el('hr'),
      r().el('div', { class: 'flex gap' }, [
        r().button('Save settings', function () {
          TP.ai.transport.saveSettings(collect());
          TP.ui.toast.ok('Saved. These live in this browser only.');
          TP.ui.shell.renderActive();
        }, { class: 'btn btn--primary' }),
        testBtn,
        r().button('Reset to defaults', function () {
          TP.ui.modal.confirm({
            title: 'Reset the AI settings?',
            body: r().el('p', { text: 'Mode, endpoints, key and model go back to their defaults. Your trips are not affected.' }),
            confirmLabel: 'Reset them',
          }).then(function (yes) {
            if (!yes) return;
            TP.ai.transport.resetSettings();
            TP.ui.toast.info('Settings reset.');
            TP.ui.shell.renderActive();
          });
        }, { class: 'btn btn--danger' }),
      ]),
      r().el('p', { class: 'subtle mt mb0', text: 'A service key is stored in this browser and never in a document. Conversations with the agent are kept locally too, and never travel inside the file.' }),
    ]);
  }

  function test(btn) {
    btn.disabled = true;
    btn.textContent = 'Testing…';
    TP.ai.transport.testConnection().then(function (res) {
      btn.disabled = false;
      btn.textContent = 'Test connection';
      if (res.ok) TP.ui.toast.ok('Answered by ' + TP.ai.transport.modeLabel() + '.');
      else TP.ui.modal.notice({
        title: 'The connection test failed',
        body: r().el('div', { class: 'info info--danger', text: TP.ai.transport.describeError(res.error) }),
      });
    }, function (e) {
      btn.disabled = false;
      btn.textContent = 'Test connection';
      TP.ui.toast.error('The test failed: ' + ((e && e.message) || e));
    });
  }

  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  return {
    render: render,
    settingsCard: settingsCard,
    callout: callout,
    unavailableCard: unavailableCard,
    isRunning: function () { return running; },
  };
})();
