// The artifact, in a browser (specs/09-testing.md §5, REQ-102, REQ-604, REQ-708).
//
// `test/escaping.test.js` covers the render seam. This file covers the other three things that are
// only true in a browser: that the file boots from a `file://` path AND from an address with nothing
// on the console; that under `file://` the AI is absent and unreachable from every entry point
// (REQ-604, REQ-708); and that two screens the tests could otherwise never reach — the AI connection
// card and the history-compaction dialog — actually render and actually work.
//
// The last two are here because of what they cost to find. The AI configuration path threw
// `RangeError: Maximum call stack size exceeded` from `clone()` the moment it was enabled, and
// `file://` is exactly where nothing calls it, so the one place it could not be seen was the one
// place the app was tested. The compaction dialog threw `parent.appendChild is not a function` for
// its whole life, from a `body` list that was being appended to as though it were a node, and only
// reached those lines when there was a dirty working copy or an unreachable commit — the two cases
// the dialog exists for. Both were found by driving the real page, and neither is visible to a test
// that imports the modules under Node.

'use strict';

var path = require('path');
var browser = require('./browser.js');
var h = require('./harness.js');

// The shell's tab list, and what it means for the AI to be offered or not (specs/07-ui.md §1). The
// AI tab is GATED rather than styled: `TP.ui.shell` builds `#tabs` from the tabs whose gate passes,
// so under `file://` the button is not in the document at all — there is no hidden thing to unhide.
var TABS = ['itinerary', 'checklists', 'lodging', 'bookings', 'places', 'charging', 'budget', 'ai', 'settings'];

function tabsIn(page) {
  return page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('#tabs button'), function (b) {
      return b.getAttribute('data-tab');
    });
  });
}

// Click the settings tab the way a person does, so whatever the shell and the settings view do on a
// real switch is what is rendered.
async function openSettings(page) {
  return page.evaluate(async function () {
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var tab = document.querySelector('#tabs button[data-tab="settings"]');
    if (!tab) return { opened: false };
    tab.click();
    await sleep(120);
    var panel = document.getElementById('panel-settings');
    return {
      opened: true,
      rendered: !!panel && !panel.hasAttribute('hidden'),
      cards: panel ? Array.prototype.map.call(panel.querySelectorAll('.card'), function (c) {
        var head = c.querySelector('h2');
        return head ? head.textContent : '(unnamed)';
      }) : [],
    };
  });
}

module.exports = {
  name: 'browser (REQ-102, REQ-604, REQ-708)',
  skip: browser.reason(),

  tests: [
    {
      name: 'the artifact boots from a file and from an address, and neither one says anything on the console (REQ-102)',
      run: async function () {
        var server = await browser.serve();
        try {
          var fromFile = await browser.visit({ url: 'file://' + browser.ARTIFACT });
          var fromHttp = await browser.visit({ origin: server.origin });

          // `visit` already fails on an uncaught exception or a console error, which is the REQ-102
          // assertion. Everything below is what has to be TRUE of a page that booted quietly, so a
          // page that silently rendered nothing cannot pass by being quiet.
          var report = async function (page) {
            return page.evaluate(function () {
              var data = document.getElementById('app-data');
              var container = null;
              try { container = JSON.parse(data.textContent); } catch (e) { container = { error: String(e) }; }
              var visiblePanels = Array.prototype.filter.call(
                document.querySelectorAll('[id^="panel-"]'),
                function (p) { return !p.hasAttribute('hidden'); });
              return {
                protocol: location.protocol,
                title: document.title,
                hasApp: typeof TP === 'object' && !!TP && !!(TP.store && TP.environment && TP.ui),
                isFile: TP.environment.isFile,
                aiEnabled: TP.environment.aiEnabled,
                prefersTextExport: TP.environment.prefersTextExport,
                // The data block is the document. It has to be there, parse, and be the format this
                // build writes — a boot that fell back to an empty document is a boot to nowhere.
                format: container.format,
                containerFormat: TP.container.FORMAT,
                schema: container.$schema,
                appHash: (container.build || {}).appHash,
                // The hash the document pins its own script with, from the policy `<meta>`.
                csp: (function () {
                  var metas = Array.prototype.filter.call(document.querySelectorAll('meta'), function (m) {
                    return /Content-Security-Policy/.test(m.getAttribute('http-equiv') || '');
                  });
                  return metas.length ? metas[0].getAttribute('content') : '';
                })(),
                containerKeys: Object.keys(container).sort(),
                headIsCommit: typeof (container.history || {}).head === 'string',
                // Two script elements and no more: the data block and the program. Nothing is
                // fetched at boot (REQ-101, REQ-807), and a third one would be the first symptom.
                scripts: document.querySelectorAll('script').length,
                tabs: Array.prototype.map.call(document.querySelectorAll('#tabs button'), function (b) {
                  return b.getAttribute('data-tab');
                }),
                visiblePanels: visiblePanels.map(function (p) { return p.id; }),
                days: (TP.store.trip().days || []).length,
              };
            });
          };

          var a = await report(fromFile);
          var b = await report(fromHttp);
          fromFile.close();
          fromHttp.close();

          // The two loads agree about everything except the three platform facts. Asserting that
          // first is what makes them a comparison: an artifact that booted differently from disk and
          // from an address is the failure mode this pair of visits exists to catch. The tab strip is
          // NOT in this list, because the AI tab is one of the facts that is allowed to differ — it is
          // checked, specifically, below.
          var shared = ['title', 'hasApp', 'format', 'containerKeys', 'headIsCommit', 'scripts',
                        'visiblePanels', 'days'];
          shared.forEach(function (key) {
            h.deepEqual(b[key], a[key],
              'the app came up differently from an address than from a file, and ' + key + ' is where it first differs');
          });

          h.ok(a.hasApp, 'the app did not come up from a file at all');
          h.equal(a.title, b.title, 'the two loads have different titles');
          h.equal(a.format, a.containerFormat, 'the data block is not in this build’s format: ' + a.format);
          h.ok(String(a.schema).indexOf(a.format) !== -1,
            'the data block names a schema that does not go with its format: ' + a.schema);
          h.equal(a.scripts, 2, 'the document has ' + a.scripts + ' script elements, not two — something is being loaded');
          // The document pins the exact script it carries: the policy hash and the build hash in the
          // data block are the same digest, so a modified program is a program the browser refuses to
          // run. (Measured, not assumed: rewriting one line of the built script makes the page fail to
          // boot with a CSP violation naming the new hash.)
          h.ok(a.appHash, 'the data block carries no build hash');
          h.ok(a.csp.indexOf(a.appHash) !== -1,
            'the content policy does not pin the script this document carries (' + a.appHash + ')');

          // The platform differences, in the one module that is allowed to know about them (REQ-601).
          h.equal(a.protocol, 'file:', 'the file:// visit is not on the file protocol, so it tested nothing');
          h.equal(a.isFile, true, 'the app does not know it was opened from a file');
          h.equal(a.aiEnabled, false, 'the AI is offered from a file:// page — the key has nowhere safe to live');
          h.equal(a.prefersTextExport, true, 'a file:// page should prefer the text export (REQ-510)');

          h.equal(b.protocol, 'http:', 'the served visit is not on http, so it tested nothing');
          h.equal(b.isFile, false, 'the app thinks a served page is a file');
          h.equal(b.aiEnabled, true, 'the AI is absent from a page that could use it');

          // The shell: one panel on screen, and the one tab the environment decides.
          h.equal(a.visiblePanels.length, 1, 'a file:// page shows ' + a.visiblePanels.length + ' panels at once');
          h.deepEqual(b.tabs.filter(function (id) { return id !== 'ai'; }), a.tabs,
            'the tab strips differ by more than the AI tab, so the environment is not the only thing deciding');
          h.equal(a.tabs.indexOf('ai'), -1, 'the AI tab is in the tab strip under file:// (REQ-604)');
          h.ok(b.tabs.indexOf('ai') !== -1, 'the AI tab is missing where the AI is available');
          b.tabs.forEach(function (id) {
            h.ok(TABS.indexOf(id) !== -1, 'the tab strip contains "' + id + '", which is not a tab');
          });
        } finally {
          await server.close();
        }
      },
    },

    {
      name: 'serving the folder and opening the root gives the shell template, which says what it is (REQ-101, REQ-102)',
      run: async function () {
        var server = await browser.serve();
        // Closed in the `finally`, like every other visit in this file. An unclosed visit leaves its
        // headless Chrome alive, and a live child keeps this process's event loop alive with it: the
        // tests would all pass and then hang until the runner's 300 s timeout killed the file,
        // leaking two Chromes and two temp profiles on the way.
        var opened = [];
        try {
          // A static server hands out `index.html` at `/`, and `index.html` is the shell template the
          // build fills in — so the likeliest way to open the app by accident is the one that gets the
          // template instead (README, "Run it"). What the template then does is refuse to run: the
          // policy pins a hash of the real program, the placeholder does not hash to it, and the
          // browser says only `script-src 'none'`. That refusal is the point of the assertions below,
          // so this visit is SUPPOSED to report problems — hence `allowProblems`, which every other
          // visit in this file exists to not need.
          var root = await browser.visit({ url: server.origin + '/', allowProblems: true });
          opened.push(root);
          var template = await root.evaluate(function () {
            var notice = document.getElementById('unbuilt-notice');
            var heading = notice ? notice.querySelector('h1') : null;
            return {
              notice: !!notice,
              heading: heading ? heading.textContent.replace(/\s+/g, ' ').trim() : '',
              text: notice ? notice.textContent.replace(/\s+/g, ' ').trim() : '',
              program: typeof window.TP,
            };
          });

          h.ok(template.notice, 'the served root renders no notice, so a person who opens it gets a ' +
            'page that runs nothing and says nothing about why');
          h.equal(template.heading, 'This is the unbuilt shell template',
            'the notice does not say what the page is');
          h.ok(template.text.indexOf('dist/trip-planner.html') !== -1,
            'the notice does not name the file that IS the application, which is the one thing ' +
            'someone who landed here needs');
          h.equal(template.program, 'undefined',
            'a program ran on the template page, so the page is not the inert placeholder the notice claims');

          // The other half, over the SAME server: the notice is authoring-only. A notice that ships
          // would sit above a working application. The artifact lives in `dist/`, which is what a
          // static server hands out at the build's own root — `browser.visit({ origin })` asks for
          // `dist/trip-planner.html` for exactly that reason.
          var app = await browser.visit({ origin: server.origin });
          opened.push(app);
          var shipped = await app.evaluate(function () {
            return { notice: !!document.getElementById('unbuilt-notice'), program: typeof window.TP };
          });
          h.equal(shipped.notice, false, 'the artifact carries the shell template\'s unbuilt notice');
          h.equal(shipped.program, 'object',
            'the artifact did not load a program, so the assertion above proves nothing about it');
        } finally {
          opened.forEach(function (page) { page.close(); });
          await server.close();
        }
      },
    },

    {
      name: 'under file:// every AI entry point refuses, and no transport is ever touched (REQ-604, REQ-708)',
      run: async function () {
        var page = await browser.visit({ url: 'file://' + browser.ARTIFACT });
        try {
          // The transports are replaced with recorders BEFORE the calls, so "it refused" and "it
          // refused without asking anyone" are separate answers. A guard that returned the refusal
          // after starting a request would pass the first and fail the second, and it is the second
          // that REQ-708 is about: under `file://` no code path reaches `fetch` or a CDN `import()`.
          var out = await page.evaluate(async function () {
            var calls = [];
            ['ollama', 'webgpu', 'mock'].forEach(function (name) {
              var transport = (TP.ai || {})[name];
              if (!transport) return;
              ['chat', 'testConnection', 'webSearch', 'webFetch'].forEach(function (method) {
                if (typeof transport[method] !== 'function') return;
                transport[method] = function () {
                  calls.push(name + '.' + method);
                  return Promise.resolve({ ok: true, error: null, messages: [], calls: calls });
                };
              });
            });

            var results = {};
            var opts = { messages: [{ role: 'user', content: 'plan my trip' }] };
            results.chat = await TP.ai.transport.chat(opts);
            results.testConnection = await TP.ai.transport.testConnection();
            results.webSearch = await TP.ai.transport.webSearch({ query: 'campgrounds' });
            results.webFetch = await TP.ai.transport.webFetch({ url: 'https://example.com' });

            // The configuration path too. It is not an entry point for a request, but it is where the
            // stack overflow lived, and a `file://` page still renders Settings.
            var settingsOk = true;
            var settingsError = null;
            try {
              TP.ai.transport.config();
              TP.ai.transport.modeLabel();
              TP.ai.transport.storedSettings();
            } catch (e) { settingsOk = false; settingsError = String(e && e.message || e); }

            var doc = TP.store.readSettings ? TP.store.readSettings() : {};
            return {
              calls: calls,
              results: Object.keys(results).map(function (k) {
                return { name: k, ok: results[k] && results[k].ok, kind: results[k] && results[k].error && results[k].error.kind,
                  message: results[k] && results[k].error && results[k].error.message };
              }),
              reason: TP.ai.transport.FILE_REASON,
              available: TP.ai.transport.available(),
              aiEnabled: TP.environment.aiEnabled,
              tabPresent: !!document.querySelector('#tabs button[data-tab="ai"]'),
              panelHidden: (function () {
                var p = document.getElementById('panel-ai');
                return !p || p.hasAttribute('hidden');
              })(),
              settingsOk: settingsOk,
              settingsError: settingsError,
              storedAi: doc.ai === undefined ? null : doc.ai,
            };
          });

          h.equal(out.available, false, 'the AI transport claims to be available under file://');
          h.equal(out.aiEnabled, false, 'the AI is enabled under file://');
          h.deepEqual(out.calls, [], 'a transport was called under file://: ' + out.calls.join(', '));

          h.equal(out.results.length, 4, 'not every entry point was exercised');
          out.results.forEach(function (r) {
            h.equal(r.ok, false, 'TP.ai.transport.' + r.name + ' did not refuse under file://');
            h.equal(r.kind, 'unavailable', 'TP.ai.transport.' + r.name + ' refused for the wrong reason');
            // The same sentence everywhere, from `FILE_REASON`: one place decides what the person is
            // told, so no two surfaces can explain the absence differently.
            h.equal(r.message, out.reason, 'TP.ai.transport.' + r.name + ' explained the refusal its own way');
          });

          h.ok(String(out.reason).indexOf('web address') !== -1, 'the refusal does not say why the AI needs an address');
          h.ok(out.settingsOk, 'the AI settings path threw under file://: ' + out.settingsError);
          h.equal(out.tabPresent, false, 'the AI tab button exists under file:// (REQ-604)');
          h.equal(out.panelHidden, true, 'the AI panel is reachable under file:// (REQ-604)');
          // And nothing was configured behind the person's back: no key, no endpoint, no mode.
          h.equal(out.storedAi, null, 'AI settings were stored on a file:// page: ' + JSON.stringify(out.storedAi));

          // The Settings screen explains the absence instead of showing a form that cannot work.
          var settings = await openSettings(page);
          h.ok(settings.opened, 'the settings tab could not be opened');
          h.ok(settings.cards.indexOf('AI planning') !== -1, 'Settings has no AI card at all under file://');
          var card = await page.evaluate(function () {
            var node = document.getElementById('ai-connection');
            if (!node) return null;
            return {
              text: node.textContent,
              inputs: node.querySelectorAll('input, select, textarea, button').length,
            };
          });
          h.ok(card, 'the AI settings card is missing under file://');
          h.ok(card.text.indexOf('web address') !== -1, 'the AI card does not explain why the AI is absent');
          h.equal(card.inputs, 0, 'the AI card offers ' + card.inputs +
            ' control(s) under file:// — a field that cannot be used is worse than no field');
        } finally {
          page.close();
        }
      },
    },

    {
      name: 'over http the AI configuration path works, and the connection card renders (the clone regression)',
      run: async function () {
        var server = await browser.serve();
        var page = await browser.visit({ origin: server.origin });
        try {
          var out = await page.evaluate(function () {
            var T = TP.ai.transport;
            var before = T.storedSettings();
            var resolved = T.config();
            var label = T.modeLabel(resolved);

            // Every string in DEFAULTS goes through `clone`. `clone` used to accept a string and
            // recurse into it — `Object.keys('webgpu')` is `['0','1',…]`, and `'w'[0]` is `'w'` again
            // — so this call is the whole regression: it overflowed the stack here and nowhere else.
            var saved = T.saveSettings({ mock: true });
            // Read back from the STORE immediately, not at the end of this function: `resetSettings`
            // below writes the defaults over it, and asking afterwards answers a different question
            // (it did, on the first run of this test, which is how this line came to be here).
            var storedAfterSave = (TP.store.readSettings().ai || {}).mock;
            var mocked = T.config();
            var mockLabel = T.modeLabel(mocked);
            var restored = T.resetSettings();
            var after = T.config();
            var storedAfterReset = (TP.store.readSettings().ai || {}).mock;

            return {
              aiEnabled: TP.environment.aiEnabled,
              mode: before.mode,
              proxyUrl: before.proxyUrl,
              webgpuModel: before.webgpu && before.webgpu.model,
              defaultModel: T.DEFAULT_WEBGPU_MODEL,
              label: label,
              cloudKey: resolved.apiKey,
              savedMock: saved.mock,
              mockedIsMock: mocked.mock,
              mockLabel: mockLabel,
              restoredMock: restored.mock,
              restoredMode: after.mode,
              // Written through the store, not just returned: a settings object that never reaches
              // storage would work until the page was reloaded and then quietly stop.
              storedMock: storedAfterSave,
              storedAfterReset: storedAfterReset,
            };
          });

          h.equal(out.aiEnabled, true, 'the AI is not available over http, so this test tested the wrong branch');
          h.equal(out.mode, 'webgpu', 'the default transport mode changed: ' + out.mode);
          h.equal(out.proxyUrl, '', 'the default proxy is not empty: ' + out.proxyUrl);
          h.equal(out.webgpuModel, out.defaultModel, 'the default WebGPU model does not match the transport list');
          h.equal(out.cloudKey, '', 'a cloud key is present in a default configuration (REQ-211)');
          h.ok(out.label && out.label.indexOf('this browser') !== -1,
            'the mode label does not name the in-browser transport: ' + out.label);
          h.equal(out.savedMock, true, 'saveSettings did not keep the value it was given');
          h.equal(out.mockedIsMock, true, 'the saved mock setting is not what config() reads back');
          h.equal(out.mockLabel, 'Mock transport (no network)', 'the mock transport is not named plainly: ' + out.mockLabel);
          h.equal(out.storedMock, true, 'the saved AI settings did not reach storage');
          h.equal(out.restoredMock, false, 'resetSettings did not put the defaults back');
          h.equal(out.storedAfterReset, false, 'resetSettings did not write the defaults to storage');
          h.equal(out.restoredMode, 'webgpu', 'resetSettings changed the mode');

          // And the card the settings screen renders over http: the real one, with its controls.
          var settings = await openSettings(page);
          h.ok(settings.opened, 'the settings tab could not be opened over http');
          h.ok(settings.cards.indexOf('AI planning') !== -1, 'Settings has no AI card over http');
          var card = await page.evaluate(function () {
            var node = document.getElementById('ai-connection');
            if (!node) return null;
            var select = node.querySelector('select');
            var test = Array.prototype.filter.call(node.querySelectorAll('button'), function (b) {
              return /Test connection/.test(b.textContent);
            })[0];
            return {
              text: node.textContent,
              selects: node.querySelectorAll('select').length,
              inputs: node.querySelectorAll('input').length,
              modes: select ? Array.prototype.map.call(select.options, function (o) { return o.value; }) : [],
              hasTestButton: !!test,
            };
          });
          h.ok(card, 'the AI connection card is missing over http');
          h.ok(card.selects >= 1, 'the connection card has no transport picker');
          h.ok(card.modes.indexOf('cloud') !== -1, 'the transport picker does not offer the cloud mode');
          h.ok(card.hasTestButton, 'the connection card has no Test connection button');
          h.ok(card.text.indexOf('Ollama') !== -1 || card.text.indexOf('browser') !== -1,
            'the connection card does not say what is answering');

          // The panel itself renders too — the tab exists, and it renders without a connection.
          var panel = await page.evaluate(async function () {
            var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
            document.querySelector('#tabs button[data-tab="ai"]').click();
            await sleep(120);
            var node = document.getElementById('panel-ai');
            return { hidden: node.hasAttribute('hidden'), planButton: /Plan this trip/.test(node.textContent),
              transcript: !!document.getElementById('ai-transcript') };
          });
          h.equal(panel.hidden, false, 'the AI panel did not open over http');
          h.ok(panel.planButton, 'the AI panel has no way to start a plan');
          h.ok(panel.transcript, 'the AI panel has no transcript area');
        } finally {
          page.close();
          await server.close();
        }
      },
    },

    {
      // REQ-701 is why this test exists. Assistant text is PARSED INTO NODES, so the page holds a
      // `<strong>` where the model wrote `**bold**` and the model's own string is nowhere in the
      // document. Selecting the bubble and copying therefore gives the rendered text — which is
      // what a person reported: "copy/paste does not retain markdown markup". The Copy button is
      // the affordance that hands over the string instead, so what is asserted here is that the
      // clipboard receives the text AS WRITTEN, and that a browser which refuses the clipboard is
      // told on rather than left looking as though it worked.
      name: 'a message copies as the markdown it was written in, and a refused clipboard says so (REQ-701)',
      run: async function () {
        var server = await browser.serve();
        var page = await browser.visit({ origin: server.origin });
        try {
          var out = await page.evaluate(async function () {
            var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

            // Seed the transcript, THEN open the tab. `seed()` memoizes per document and runs the
            // first time the AI panel renders, so a record written after the tab is opened is never
            // read at all. Two details decide whether this works: the key is the registry's
            // (`tp.app.conv.` + id, `storage/adapter.js`), and `tripId` must be the same docId the
            // panel computes (`ai-panel.js`, `docIdOf(...) || 'unsaved'`) or the conversation is
            // filtered out and the transcript is empty — which would let every assertion below pass
            // against nothing.
            var docId = TP.store.docIdOf(TP.store.container()) || 'unsaved';
            var markdown = 'Here is a **plan**.\n\n- Day one\n- Day two';
            var asked = 'Plan me **five** days.';
            localStorage.setItem('tp.app.conv.copy-1', JSON.stringify({
              id: 'copy-1',
              tripId: docId,
              createdAt: 1,
              messages: [{ role: 'user', content: asked }, { role: 'assistant', content: markdown }],
            }));
            document.querySelector('#tabs button[data-tab="ai"]').click();
            await sleep(150);

            // The clipboard, as a recorder. `navigator.clipboard` is a getter on the prototype, so it
            // is shadowed on the instance rather than assigned.
            var written = [];
            var behavior = function (text) { written.push(text); return Promise.resolve(); };
            Object.defineProperty(navigator, 'clipboard', {
              configurable: true,
              value: { writeText: function (t) { return behavior(t); } },
            });

            function buttonFor(role) {
              var row = document.querySelector('.msg--' + role);
              return row ? row.querySelector('.msg__role button') : null;
            }
            function bubbleText(role) {
              var row = document.querySelector('.msg--' + role);
              return row ? row.querySelector('.bubble').textContent : null;
            }

            var assistantBtn = buttonFor('assistant');
            var userBtn = buttonFor('user');
            var found = {
              assistant: !!assistantBtn,
              user: !!userBtn,
              label: assistantBtn ? assistantBtn.textContent : null,
              rendered: bubbleText('assistant'),
              rows: document.querySelectorAll('.msg').length,
            };

            // The negative control first, on the untouched button. `copyToClipboard` reports a refusal
            // by resolving, not rejecting, so the only thing that can tell the person it failed is
            // what the handler does with that answer.
            behavior = function () { return Promise.reject(new Error('denied')); };
            if (assistantBtn) assistantBtn.click();
            await sleep(60);
            var refused = {
              toast: document.getElementById('toasts').textContent,
              label: assistantBtn ? assistantBtn.textContent : null,
            };

            behavior = function (text) { written.push(text); return Promise.resolve(); };
            if (assistantBtn) assistantBtn.click();
            await sleep(60);
            var agent = { copied: written.slice(), label: assistantBtn ? assistantBtn.textContent : null };

            // The person's own message. They asked for a button on every message, not only on replies.
            if (userBtn) userBtn.click();
            await sleep(60);
            var mine = { copied: written.slice(), label: userBtn ? userBtn.textContent : null };

            return {
              docId: docId, markdown: markdown, asked: asked,
              found: found, refused: refused, agent: agent, mine: mine,
            };
          });

          h.equal(out.found.rows, 2, 'the seeded conversation did not render (docId ' + out.docId + ')');
          h.ok(out.found.assistant, 'the agent’s message has no copy button');
          h.ok(out.found.user, 'the person’s own message has no copy button');
          h.equal(out.found.label, 'Copy', 'the copy button is not labelled Copy');

          // The premise of the whole feature, asserted rather than assumed: the RENDERED text has
          // already lost the markup. Without this, a clipboard that happened to receive rendered
          // text would pass the assertions below, and the button would be doing nothing.
          h.equal(out.found.rendered.indexOf('**'), -1,
            'the rendered bubble still contains asterisks, so this test is not testing what it claims');

          h.equal(out.agent.copied.length, 1, 'the copy button wrote nothing to the clipboard');
          h.equal(out.agent.copied[0], out.markdown,
            'the clipboard did not receive the message as it was written');
          h.equal(out.agent.label, 'Copied', 'the button does not report that it copied');

          h.equal(out.mine.copied.length, 2, 'the person’s own message has no working copy button');
          h.equal(out.mine.copied[1], out.asked,
            'copying the person’s own message gave something other than what they wrote');

          h.ok(/refused clipboard access/.test(out.refused.toast),
            'the browser refused the clipboard and the app said nothing: ' + JSON.stringify(out.refused.toast));
          h.equal(out.refused.label, 'Copy',
            'the button claimed success after the browser refused the copy');
        } finally {
          page.close();
          await server.close();
        }
      },
    },

    {
      name: 'the artifact’s own policy admits the WebGPU transport: the module host is a script source, and WASM compiles (REQ-713)',
      run: async function () {
        // The regression this exists for: the policy named the CDN only as a `connect-src`, but a
        // dynamic `import()` is a script fetch governed by `script-src`, so the module was refused
        // before any network request and the user saw "the model library could not be loaded from
        // the CDN". The WASM half is the quieter second failure — web-llm runs on a WASM runtime,
        // and a hash-only script-src refuses to compile it.
        //
        // Served, not `file://`: there the meta policy's enforcement is Q-3-uncertain and the AI is
        // disabled anyway, so the assertion would pass vacuously. Compiling the empty module needs
        // no network, so the suite stays hermetic — this downloads no model.
        var server = await browser.serve();
        var page = await browser.visit({ origin: server.origin });
        try {
          var out = await page.evaluate(function () {
            var metas = Array.prototype.filter.call(document.querySelectorAll('meta'), function (m) {
              return /Content-Security-Policy/.test(m.getAttribute('http-equiv') || '');
            });
            var policy = metas.length ? (metas[0].getAttribute('content') || '') : '';
            var bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
            return WebAssembly.instantiate(bytes).then(function () {
              return { policy: policy, compiled: true, error: '' };
            }, function (e) {
              return { policy: policy, compiled: false, error: String((e && e.message) || e) };
            });
          });

          h.ok(/script-src [^;]*'wasm-unsafe-eval'/.test(out.policy),
            'the policy does not allow WebAssembly compilation: ' + out.policy);
          h.ok(/script-src [^;]*https:\/\/esm\.run/.test(out.policy),
            'the policy does not name the module host as a script source: ' + out.policy);
          h.ok(/script-src [^;]*https:\/\/cdn\.jsdelivr\.net/.test(out.policy),
            'the policy does not name the redirect host as a script source: ' + out.policy);
          h.ok(out.compiled,
            'WebAssembly.instantiate was refused under the artifact’s own policy: ' + out.error);
        } finally {
          page.close();
          await server.close();
        }
      },
    },

    {
      name: 'the compaction dialog keeps unreachable commits by default, and discards them only when asked twice',
      run: async function () {
        var server = await browser.serve();
        var page = await browser.visit({ origin: server.origin });
        try {
          // This is the shape the dialog could never be reached with under Node: a history with more
          // than one commit, an unreachable one, and a dirty working copy — and then the real
          // Settings panel and the real buttons.
          var out = await page.evaluate(async function () {
            var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

            // Hold the commit boundary open for the whole of this drive.
            //
            // `TP.store.edit` schedules an autosave 900 ms later, and when it fires it commits the
            // uncommitted edit — one more commit in the history. That is correct behaviour and it is
            // fatal to this test: the drive takes about that long, so whether a count read after a
            // `sleep` includes the autosave commit depends on how fast the machine is. (It was: the
            // same drive reported 5 commits where the app had made 4, and the extra one was the edit,
            // committed by the autosave, which is exactly what should happen.) Holding the boundary is
            // the app's own mechanism for this — the AI agent uses it so forty turns land as one
            // commit (`TP.store.holdCommits`, src/store.js) — so the test drives the app the way the
            // app drives itself, and every number below is exact rather than approximately right.
            TP.store.holdCommits();

            for (var i = 1; i <= 3; i++) {
              TP.store.replaceTrip('Change ' + i, TP.model.newTrip({ title: 'Trip ' + i }));
              TP.store.commit('Change ' + i);
            }
            var before = {
              commits: TP.store.commits().length,
              head: TP.store.history().head,
              ids: TP.store.commits().map(function (c) { return c.id; }),
            };

            // A commit nothing points at, built with the document's own docId so that anything the
            // integrity check has to say about it is about reachability and not about a missing field.
            var hist = TP.store.history();
            var appended = TP.history.append(hist, { trip: TP.model.clone(TP.store.trip()) }, {
              docId: TP.store.docIdOf(TP.store.container()),
              author: { name: 'Test', email: 't@example.invalid' },
              message: 'Orphan commit',
              parents: [],
              timestamp: '2026-01-01T00:00:00.000Z',
            });
            appended.history.head = before.head;
            TP.store.container().history = appended.history;
            var orphanId = appended.commit.id;

            var plan = TP.store.planCompaction();
            var withDiscard = TP.store.planCompaction({ removeOrphans: true });

            // An edit that is not committed: compaction must carry it across untouched.
            TP.store.edit('Dirty edit', function (t) { t.title = 'UNCOMMITTED'; });

            var chainWithOrphan = TP.verify.chain(TP.store.history());

            // The real screen: the settings tab, and the button the card offers.
            document.querySelector('#tabs button[data-tab="settings"]').click();
            await sleep(150);
            var panel = document.getElementById('panel-settings');
            var compactBtn = Array.prototype.filter.call(panel.querySelectorAll('button'), function (b) {
              return b.textContent.trim() === 'Compact…';
            })[0];
            if (!compactBtn) return { error: 'the settings panel has no Compact… button' };

            function dialogFacts() {
              var dialog = document.querySelector('.modal');
              if (!dialog) return null;
              var dts = Array.prototype.map.call(dialog.querySelectorAll('dt'), function (d) { return d.textContent; });
              var dds = Array.prototype.map.call(dialog.querySelectorAll('dd'), function (d) { return d.textContent; });
              return {
                title: (dialog.querySelector('h3') || {}).textContent,
                buttons: Array.prototype.map.call(dialog.querySelectorAll('button'), function (b) { return b.textContent.trim(); }),
                facts: dts.map(function (t, i) { return t + ' = ' + dds[i]; }),
                text: dialog.textContent.replace(/\s+/g, ' '),
                warns: dialog.querySelectorAll('.info--warn').length,
              };
            }

            compactBtn.click();
            await sleep(80);
            var first = dialogFacts();
            var furtherLine = /would save a further/.test(first.text);

            // The state every step below is judged by. It is read after the sleeps rather than instead
            // of them, because the commit boundary is held for this whole drive: nothing else can commit
            // while it runs, so what is here is what the button did.
            function stateNow() {
              return {
                commits: TP.store.commits().length,
                headUnchanged: TP.store.history().head === before.head,
                dirty: TP.store.isDirty(),
                title: TP.store.trip().title,
                orphanStillThere: TP.store.commits().some(function (c) { return c.id === orphanId; }),
                ids: TP.store.commits().map(function (c) { return c.id; }),
                dialogClosed: !document.querySelector('.modal'),
              };
            }

            // The default action: keep everything.
            var keep = Array.prototype.filter.call(document.querySelectorAll('.modal button'), function (b) {
              return b.textContent.trim() === 'Leave it alone';
            })[0];
            keep.click();
            await sleep(80);
            var afterKeep = stateNow();

            // Now the destructive offer, which asks again.
            compactBtn.click();
            await sleep(80);
            var second = dialogFacts();
            var discardBtn = Array.prototype.filter.call(document.querySelectorAll('.modal button'), function (b) {
              return /discard/i.test(b.textContent);
            })[0];
            discardBtn.click();
            await sleep(80);
            var confirmDialog = dialogFacts();
            var confirmButtons = confirmDialog ? confirmDialog.buttons : [];

            // Saying no has to stop it.
            var no = Array.prototype.filter.call(document.querySelectorAll('.modal button'), function (b) {
              return /^(Leave|cancel|keep)/i.test(b.textContent.trim());
            })[0];
            if (no) no.click();
            await sleep(80);
            var afterNo = stateNow();

            // And saying yes twice in a row has to do exactly what was promised. The second click
            // resolves the confirmation, whose `.then` runs as a microtask — so the read below comes
            // after a wait rather than straight after the click.
            compactBtn.click();
            await sleep(80);
            Array.prototype.filter.call(document.querySelectorAll('.modal button'), function (b) {
              return /discard/i.test(b.textContent);
            })[0].click();
            await sleep(80);
            Array.prototype.filter.call(document.querySelectorAll('.modal button'), function (b) {
              return b.textContent.trim() === 'Discard them';
            })[0].click();
            await sleep(120);
            var after = stateNow();

            var chain = TP.verify.chain(TP.store.history());
            return {
              // The document arrives with its own commits (the build writes a keyframe root), so the
              // counts below are stated against this rather than hard-coded: what matters is that the
              // dialog, the default action and the discard each agree with it.
              beforeCommits: before.commits,
              orphanInHistory: before.ids.indexOf(orphanId) === -1,
              chainWithOrphanOk: chainWithOrphan.ok,
              chainWithOrphanProblems: (chainWithOrphan.errors || []).map(function (e) { return e.problem; }),
              plan: { saved: plan.saved, unreachable: plan.unreachable.length,
                keyframesBefore: plan.keyframesBefore, keyframesAfter: plan.keyframesAfter },
              withDiscard: { saved: withDiscard.saved, removed: withDiscard.removedOrphans },
              first: first,
              furtherLine: furtherLine,
              expectedFurtherLine: (withDiscard.saved - plan.saved) > 0,
              afterKeep: afterKeep,
              second: second,
              confirmButtons: confirmButtons,
              afterNo: afterNo,
              after: after,
              // Everything above was measured at the moment of the click. This is the same history
              // once the app has been left alone for a while: the orphan has to stay gone, the chain
              // still has to hold, and the document still has to validate — an autosave or a re-render
              // that undid a compaction would show up here and nowhere else.
              settled: {
                commits: TP.store.commits().length,
                orphanStillThere: TP.store.commits().some(function (c) { return c.id === orphanId; }),
                title: TP.store.trip().title,
                chainOk: chain.ok,
                chainProblems: (chain.errors || []).map(function (e) { return e.problem; }),
                validates: TP.validators.check('artifact', TP.store.container()).ok,
                toast: Array.prototype.map.call(document.querySelectorAll('.toast'), function (t) {
                  return t.textContent.trim();
                }).join(' | '),
                dialogClosed: !document.querySelector('.modal'),
              },
            };
          });

          h.ok(!out.error, out.error || '');
          var withOrphan = out.beforeCommits + 1;   // the document's own commits, plus the orphan
          h.equal(out.orphanInHistory, true, 'the orphan commit was not the new one');
          h.equal(out.plan.unreachable, 1, 'the plan does not see exactly one unreachable commit');
          h.equal(out.withDiscard.removed, 1, 'the discard plan does not remove exactly one commit');
          h.ok(out.chainWithOrphanOk, 'an unreachable commit broke the chain: ' + out.chainWithOrphanProblems.join(', '));

          // The dialog itself: the facts, both warnings, and both offers.
          h.ok(out.first, 'the Compact… button did not open a dialog');
          h.equal(out.first.title, 'Compact this history?', 'the dialog has the wrong title');
          h.ok(out.first.facts.join(' | ').indexOf('Commits = ' + withOrphan) !== -1,
            'the dialog does not say how many commits are kept (expected ' + withOrphan + '): ' + out.first.facts.join(' | '));
          h.equal(out.first.warns, 2, 'the dialog shows ' + out.first.warns +
            ' warnings, not two — the dirty working copy and the unreachable commit');
          h.ok(out.first.text.indexOf('can no longer reach') !== -1, 'the dialog does not name the unreachable commits');
          h.ok(out.first.text.indexOf('not committed yet') !== -1, 'the dialog does not mention the uncommitted changes');
          h.ok(out.first.buttons.indexOf('Leave it alone') !== -1, 'the dialog has no way to leave the history alone');
          h.ok(out.first.buttons.some(function (b) { return /discard 1 unreachable commit/i.test(b); }),
            'the dialog does not offer to discard the unreachable commit: ' + out.first.buttons.join(' / '));
          // The second figure is the point of the line: the screen offers to discard bytes, so it has
          // to say how many. Present exactly when there are any, and never a different number from the
          // one the button would save — both come from the same plan.
          h.equal(out.furtherLine, out.expectedFurtherLine,
            'the "would save a further" line is ' + (out.furtherLine ? 'shown' : 'missing') +
            ' while the discard would save ' + (out.withDiscard.saved - out.plan.saved) + ' bytes');

          // The default action changed nothing.
          h.equal(out.afterKeep.commits, withOrphan, 'leaving the history alone changed the commit count');
          h.equal(out.afterKeep.orphanStillThere, true, 'the default action discarded the unreachable commit');
          h.equal(out.afterKeep.headUnchanged, true, 'the default action moved the head');
          h.equal(out.afterKeep.dirty, true, 'the default action committed the working copy');
          h.equal(out.afterKeep.title, 'UNCOMMITTED', 'the default action changed the trip');
          h.equal(out.afterKeep.dialogClosed, true, 'the dialog stayed open after choosing an action');

          // The second question, and its no.
          h.ok(out.confirmButtons.length, 'the discard offer did not ask a second question');
          h.ok(out.confirmButtons.some(function (b) { return b === 'Discard them'; }),
            'the second question does not name the action: ' + out.confirmButtons.join(' / '));
          h.equal(out.afterNo.commits, withOrphan, 'saying no to the second question discarded the commit anyway');
          h.equal(out.afterNo.orphanStillThere, true, 'the unreachable commit is gone after saying no');

          // And the yes: exactly one commit removed, nothing else touched.
          h.equal(out.after.commits, out.beforeCommits, 'discarding removed the wrong number of commits');
          h.equal(out.after.headUnchanged, true, 'compaction moved the head');
          h.equal(out.after.dirty, true, 'compaction committed or dropped the uncommitted changes');
          h.equal(out.after.title, 'UNCOMMITTED', 'the uncommitted working copy was lost or replaced');
          h.equal(out.after.ids.length, out.beforeCommits, 'the surviving commits do not add up to what the dialog promised');
          h.equal(out.after.orphanStillThere, false, 'the discard the person asked for twice did not happen');

          // And then the history after the app has been left to itself for a moment: the orphan stays
          // gone, the chain still holds, and the document still validates. Nothing here reads a count,
          // because the pending autosave commits the uncommitted edit during this window — which is
          // correct, and is asserted for what it is: the edit is still the trip.
          h.equal(out.settled.orphanStillThere, false, 'the unreachable commit came back after the discard');
          h.equal(out.settled.title, 'UNCOMMITTED', 'the uncommitted edit was lost somewhere after the compaction');
          h.ok(out.settled.chainOk, 'the chain does not hold after compacting: ' + out.settled.chainProblems.join(', '));
          h.ok(out.settled.validates, 'the document no longer validates after compacting');
          h.ok(/discarded/.test(out.settled.toast), 'the app did not say what it did: ' + out.settled.toast);
          h.equal(out.settled.dialogClosed, true, 'a dialog is still open at the end');
        } finally {
          page.close();
          await server.close();
        }
      },
    },

    {
      // Opening a second document used to leave the app half-armed. `TP.store.init` resets the
      // store's interactivity — boot needs that, because it inits the store BEFORE reconcile runs
      // (REQ-612) — and every swap after boot called `init` and never finished the transition. The
      // flag stayed false for the rest of the session, and the one control gated on it, Export
      // (`src/ui/shell.js`), was greyed out from the first commit after a switch, with no way back
      // short of reloading the page. The row that opened a trip and the New Trip dialog are two
      // different call sites (`TP.ui.tripList.openLocal` / `addAndOpen`), so both are driven here.
      name: 'a document opened over a running page leaves Export working (REQ-405, REQ-612)',
      run: async function () {
        var server = await browser.serve();
        var page = await browser.visit({ origin: server.origin });
        try {
          var out = await page.evaluate(async function () {
            var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

            function exportDisabled() {
              var b = document.getElementById('export-btn');
              return b ? b.disabled : null;
            }
            function modal() { return document.querySelector('.modal'); }
            function modalTitle() {
              var box = modal();
              var head = box && box.querySelector('h3');
              return head ? head.textContent : null;
            }
            function modalText() {
              var box = modal();
              return box ? box.textContent.replace(/\s+/g, ' ') : '';
            }
            function modalButton(re) {
              return Array.prototype.filter.call(document.querySelectorAll('.modal button'), function (b) {
                return re.test(b.textContent.trim());
              })[0];
            }
            function rows() {
              return Array.prototype.map.call(document.querySelectorAll('#trip-list .trip-item'), function (row) {
                return {
                  title: (row.querySelector('.trip-item__title') || {}).textContent,
                  // A row whose document has no copy in this browser says so rather than opening.
                  held: !row.classList.contains('trip-item--absent'),
                  active: row.classList.contains('trip-item--active'),
                };
              });
            }
            function openRow(title) {
              var row = Array.prototype.filter.call(document.querySelectorAll('#trip-list .trip-item'), function (r) {
                return (r.querySelector('.trip-item__title') || {}).textContent === title;
              })[0];
              if (!row) return false;
              row.click();
              return true;
            }

            // A trip made the way a person makes one: New Trip on the toolbar, Create in the dialog,
            // then a typed name — which is a real edit, so the autosave commits it and the document
            // is written to this browser. That last step is what gives the sidebar a row that can be
            // reopened at all.
            async function makeTrip(name) {
              document.getElementById('new-trip-btn').click();
              await sleep(150);
              var create = modalButton(/^create$/i);
              if (!create) return { error: 'the New trip dialog offered no Create: ' + modalTitle() };
              create.click();
              await sleep(250);

              var field = Array.prototype.filter.call(
                document.querySelectorAll('#panel-itinerary label.field'),
                function (l) {
                  var span = l.querySelector('.field-label');
                  return span && span.textContent === 'Trip name';
                })[0];
              var input = field && field.querySelector('input');
              if (!input) return { error: 'the itinerary has no Trip name field to edit' };
              input.value = name;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              await sleep(1500);   // the autosave commits 900 ms after the last edit
              return { error: null };
            }

            var report = { boot: { exportDisabled: exportDisabled(), rows: rows() } };

            report.newTrip = await makeTrip('Alpha');
            report.afterNewTrip = { exportDisabled: exportDisabled(), rows: rows() };

            report.secondTrip = await makeTrip('Beta');
            report.afterSecondTrip = { exportDisabled: exportDisabled(), rows: rows() };

            // The reported case: open a DIFFERENT document from the sidebar.
            report.openedRow = openRow('Alpha');
            await sleep(400);
            report.afterSwitch = {
              exportDisabled: exportDisabled(),
              tripTitle: TP.store.trip().title,
              dialog: modalTitle(),
              isInteractive: TP.store.isInteractive(),
              rows: rows(),
            };

            // And the button has to do what it says, not merely look enabled.
            document.getElementById('export-btn').click();
            await sleep(120);
            report.exportDialog = {
              title: modalTitle(),
              offers: Array.prototype.map.call(document.querySelectorAll('.modal button'), function (b) { return b.textContent.trim(); }),
            };

            var exportAction = modalButton(/^export$/i);
            if (exportAction) exportAction.click();
            await sleep(200);
            report.saveDialog = {
              title: modalTitle(),
              checks: Array.prototype.map.call(document.querySelectorAll('.modal li'), function (li) { return li.textContent.trim(); }),
              text: modalText(),
            };

            var save = modalButton(/choose where to save/i);
            if (save) save.click();
            await sleep(300);
            var toasts = document.getElementById('toasts');
            report.toast = toasts ? toasts.textContent.replace(/\s+/g, ' ') : '';
            return report;
          });

          // The state before anything is switched, so a failure below is about the switch.
          h.equal(out.boot.exportDisabled, false, 'Export was disabled on a freshly booted document');
          h.deepEqual(out.boot.rows.map(function (r) { return r.active; }), [true],
            'the boot document is not the row the sidebar marks as current');

          h.ok(!out.newTrip.error, 'making a trip failed: ' + out.newTrip.error);
          h.ok(!out.secondTrip.error, 'making the second trip failed: ' + out.secondTrip.error);

          // Both documents are in the sidebar, held locally, and neither is "not kept in this browser" —
          // which is what makes the row below a document that can actually be reopened (REQ-405).
          var titles = out.afterSecondTrip.rows.map(function (r) { return r.title; });
          h.ok(titles.indexOf('Alpha') !== -1 && titles.indexOf('Beta') !== -1,
            'the sidebar does not list both documents: ' + titles.join(', '));
          var alpha = out.afterSecondTrip.rows.filter(function (r) { return r.title === 'Alpha'; })[0];
          h.equal(alpha.held, true, 'the first document has no copy in this browser, so its row cannot reopen it');

          // THE REGRESSION. New Trip and the sidebar's row both call `init` on a running store; the
          // export button is gated on the flag that leaves behind.
          h.equal(out.afterNewTrip.exportDisabled, false,
            'Export was disabled after New Trip, and stayed that way for the rest of the session');
          h.equal(out.afterSecondTrip.exportDisabled, false,
            'Export was disabled after a second New Trip');

          h.equal(out.openedRow, true, 'the sidebar had no row for the first document to open');
          h.equal(out.afterSwitch.dialog, null,
            'opening the row raised a dialog instead of opening the document: ' + out.afterSwitch.dialog);
          h.equal(out.afterSwitch.tripTitle, 'Alpha', 'the row did not open the document it names');
          h.equal(out.afterSwitch.isInteractive, true, 'the store came back from a switch not interactive');
          h.equal(out.afterSwitch.exportDisabled, false,
            'Export was disabled after opening a document from the sidebar — the defect this test is for');

          // Enabled is not the same as working. The dialog, the checks and the file all have to follow.
          h.equal(out.exportDialog.title, 'Export', 'the Export button did not open the export dialog');
          h.equal(out.saveDialog.title, 'Save Alpha.html',
            'the export did not reach the save step for the opened document: ' + out.saveDialog.title);
          h.equal(out.saveDialog.checks.length, 5,
            'the assembled document was not put through its five checks: ' + out.saveDialog.checks.join(' / '));
          h.ok(out.saveDialog.checks.indexOf('The data block carries exactly this document') !== -1,
            'the checks listed are not the export’s own: ' + out.saveDialog.checks.join(' / '));
          h.ok(/Saved Alpha\.html/.test(out.toast), 'the export did not report a saved file: ' + out.toast);
        } finally {
          page.close();
          await server.close();
        }
      },
    },

    {
      name: 'the browser driver itself refuses to pass a page that threw, and says where (REQ-102)',
      run: async function () {
        // The driver is what every other test in this file and in `escaping.test.js` is built on, so
        // its one job — a page that raised something is not a page that passed — is worth a test of
        // its own. The probe is served from the repository root by the test's own static server, so
        // nothing outside this run can see it.
        var fs = require('fs');
        var probe = path.join(browser.ROOT, 'browser-driver-probe.html');
        fs.writeFileSync(probe, '<!doctype html><meta charset="utf-8"><title>probe</title>\n' +
          '<script>setTimeout(function(){ throw new Error("a defect the driver must not swallow"); }, 50);</script>\n');
        var server = await browser.serve();
        var threw = null;
        try {
          try {
            await browser.visit({ url: server.origin + '/browser-driver-probe.html', wait: 1200 });
          } catch (e) { threw = e; }
        } finally {
          await server.close();
          fs.rmSync(probe, { force: true });
        }
        h.ok(threw, 'a page that threw an uncaught error was allowed to pass');
        h.ok(/defect the driver must not swallow/.test(threw.message),
          'the driver failed for a reason that does not name the page’s error: ' + threw.message);
        h.ok(/browser-driver-probe\.html/.test(threw.message), 'the driver did not say which page it was: ' + threw.message);
      },
    },
  ],
};
