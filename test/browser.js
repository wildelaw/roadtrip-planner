// The browser driver (specs/09-testing.md §5, REQ-805, REQ-102, REQ-604).
//
// Some of what this app promises is only true in a browser. `file://` is a different platform from
// `http://` and the whole environment gate exists for it (REQ-601–604); the render seam's escape
// guarantee (REQ-805) is a claim about a DOM, not about a string; and the boot sequence is a claim
// about what happens when a browser opens the file. A test that imported the pure modules under Node
// could confirm none of it.
//
// So this drives a real browser, and it does it with NO DEPENDENCIES — Node 24 has a global
// `WebSocket` and a `fetch`, and DevTools Protocol over them is all a headless Chrome needs. Puppeteer
// or Playwright would be a development dependency for `fetch` and `WebSocket` (PATTERN.md §5.11
// permits development dependencies, but it does not ask for ones that earn nothing).
//
// THE RUNTIME IS PART OF THE REQUIREMENT, and it is checked below rather than assumed. This file
// needs a global `WebSocket` (Node 22+; `fetch` needs only 18), and a CI that pinned Node 20 made
// every browser-driven test fail at `new WebSocket(...)` with the message "WebSocket is not defined".
// Nine tests, none of which named the runtime, the browser, or the artifact — the failure was correct
// and unreadable. `runtimeProblem` turns that into one sentence with the version in it.
//
// WHAT IT ASSERTS BY ITSELF. Every visit fails if the page raised an exception or logged an error,
// because in these files a console error is never incidental: the artifact is one file with no
// network access at boot, so an error in it is a defect the user would meet on their machine. A test
// that means to provoke an error says so with `allowProblems`.
//
// The browser is a development tool and is NOT required: a machine without one gets these files
// reported as skipped with the reason, not as passes (`test/run.js` prints it). The reason string
// lives in `reason` so every browser-driven file declares the same one.

'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var childProcess = require('child_process');

var ROOT = path.join(__dirname, '..');
// The build writes into `dist/`, which `.gitignore` ignores: the artifact is a BUILD OUTPUT, not a
// source file, and a repository that carries its own compiled result carries a second copy of the app
// that can silently disagree with `src/`.
var ARTIFACT = path.join(ROOT, 'dist', 'trip-planner.html');
var ARTIFACT_URL = 'dist/trip-planner.html';

// ---- Finding a browser ----
//
// In order: what the person said, then the caches and install locations that actually exist on the
// two platforms this is developed on, then PATH. A browser found here is a browser we can drive;
// nothing is downloaded and nothing is required.

function candidates() {
  var out = [];
  if (process.env.CHROME) out.push(process.env.CHROME);

  // The headless shell is what the puppeteer cache holds, and it is the cheapest thing to drive. It
  // has no window and no file picker — see `capabilities` below, which is what that costs us.
  var cache = path.join(os.homedir(), '.cache/puppeteer');
  ['chrome-headless-shell', 'chrome'].forEach(function (kind) {
    var dir = path.join(cache, kind);
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).sort().reverse().forEach(function (version) {
      var plat = process.platform === 'darwin'
        ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64')
        : 'linux64';
      out.push(path.join(dir, version, kind === 'chrome' ? 'chrome-' + plat : 'chrome-headless-shell-' + plat,
        kind === 'chrome' ? 'Google Chrome for Testing' : 'chrome-headless-shell'));
    });
  });

  if (process.platform === 'darwin') {
    out.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    out.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
     '/usr/bin/google-chrome-stable'].forEach(function (p) { out.push(p); });
  }
  return out;
}

function findChrome() {
  var list = candidates();
  for (var i = 0; i < list.length; i++) {
    try {
      if (list[i] && fs.statSync(list[i]).isFile()) return list[i];
    } catch (e) { /* not this one */ }
  }
  return null;
}

var CHROME = findChrome();

function available() {
  return !!(CHROME && fs.existsSync(ARTIFACT));
}

// The one reason string, so every browser-driven file says the same thing and a reader can tell
// "this machine has no browser" from "this machine has not built the artifact".
function reason() {
  if (!fs.existsSync(ARTIFACT)) return 'dist/trip-planner.html is not built — run `node build.js`';
  if (!CHROME) return 'no Chrome or Chromium found — set CHROME=/path/to/chrome to enable the browser-driven checks';
  return null;
}

// A missing global is NOT a skip. A machine with no browser reports skipped with a reason (above),
// because the browser is a development tool the suite is designed to do without; the runtime is not —
// a suite that silently skipped its browser half in CI would leave `REQ-102` (the artifact boots from
// `file://` in CI, at least in Chrome) unverified while the log stayed green, which is the exact
// outcome the workflow's own comment about skipped cross-checks warns against. So this throws.
var NEEDED_RUNTIME = 'Node 22+ (a global `WebSocket`)';

function runtimeProblem() {
  var missing = typeof WebSocket === 'undefined' ? 'WebSocket'
    : typeof fetch === 'undefined' ? 'fetch'
    : null;
  if (!missing) return null;
  return 'this runtime has no global `' + missing + '` — the browser driver needs ' + NEEDED_RUNTIME +
    ', and this is Node ' + process.version;
}

// A browser that cannot save a file in place. `showSaveFilePicker` is absent from the headless shell
// and from every headless Chrome, so `TP.environment.canSaveInPlace` is false wherever these tests
// run and the export path takes its other branch (REQ-510, REQ-607). Recorded here so a test that
// depends on it can say so rather than assume.
var capabilities = { canSaveInPlace: false, headless: true };

// ---- The static server ----
//
// One is needed because half of what is being tested is the difference between an origin and a file,
// and because a stored document needs an origin to be stored in. It binds to loopback on a port the
// OS picks, so two test processes running at once cannot collide, and it serves the repository root.

function serve() {
  var server = http.createServer(function (req, res) {
    var name = decodeURIComponent(String(req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
    var file = path.join(ROOT, name);
    // Nothing outside the repository, and nothing that is not a file. A test server is still a server.
    if (path.relative(ROOT, file).startsWith('..') || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    var type = /\.html$/.test(file) ? 'text/html; charset=utf-8'
      : /\.js$/.test(file) ? 'text/javascript; charset=utf-8'
      : /\.css$/.test(file) ? 'text/css; charset=utf-8'
      : /\.json$/.test(file) ? 'application/json; charset=utf-8'
      : /\.ics$/.test(file) ? 'text/calendar; charset=utf-8'
      : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  return new Promise(function (resolve, reject) {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', function () {
      resolve({
        origin: 'http://127.0.0.1:' + server.address().port,
        close: function () { return new Promise(function (r) { server.close(r); }); },
      });
    });
  });
}

// ---- The page ----
//
// `visit({ file: true })` loads the artifact the way a person would — by opening the file — and
// `visit({ origin })` loads it over HTTP. Everything else is the same, which is the point: the
// artifact is one file that has to work in both.

var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function visit(options) {
  var opts = options || {};
  var url = opts.url || (opts.origin ? opts.origin + '/' + ARTIFACT_URL : 'file://' + ARTIFACT);
  var wait = opts.wait == null ? 2500 : opts.wait;
  var port = 9411 + Math.floor(Math.random() * 400);

  if (!CHROME) throw new Error('browser: ' + reason());
  var runtime = runtimeProblem();
  if (runtime) throw new Error('browser: ' + runtime);

  var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-browser-'));
  var chrome = childProcess.spawn(CHROME, [
    '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  var stderr = '';
  chrome.stderr.on('data', function (b) { stderr += b.toString(); });

  var opened = null;
  var logs = [];
  var problems = [];
  var ws = null;

  function stop() {
    try { if (ws) ws.close(); } catch (e) { /* already gone */ }
    try { chrome.kill(); } catch (e) { /* already gone */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* leave it */ }
  }

  try {
    // Wait for the debugging port, then talk to it.
    var version = null;
    for (var i = 0; i < 150 && !version; i++) {
      try {
        var r = await fetch('http://127.0.0.1:' + port + '/json/version');
        if (r.ok) version = await r.json();
      } catch (e) { /* not up yet */ }
      if (!version) await sleep(100);
    }
    if (!version) throw new Error('Chrome did not open a debugging port in 15s.\n' + stderr);

    ws = new WebSocket(version.webSocketDebuggerUrl);
    var pending = new Map();
    var nextId = 0;
    var sessionId = null;

    await new Promise(function (res, rej) { ws.onopen = res; ws.onerror = function (e) { rej(new Error('the debugging socket failed')); }; });

    ws.onmessage = function (event) {
      var m = JSON.parse(event.data);
      if (m.id && pending.has(m.id)) {
        var p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.reject(new Error(m.method + ': ' + m.error.message));
        else p.resolve(m.result);
        return;
      }
      record(m);
    };

    var send = function (method, params) {
      return new Promise(function (resolve, reject) {
        var id = ++nextId;
        pending.set(id, { resolve: resolve, reject: reject });
        ws.send(JSON.stringify(sessionId ? { id: id, method: method, params: params, sessionId: sessionId } : { id: id, method: method, params: params }));
      });
    };

    // Chrome reports the spec's `frame-ancestors` directive as an error, because a policy delivered
    // in a `<meta>` cannot carry it. The policy in the artifact is the one specs/02 §7 declares, so
    // this is expected and is not a fault in the file. Anything else that reaches the console is.
    var EXPECTED = [/frame-ancestors' is ignored when delivered via a <meta>/];
    var isExpected = function (text) {
      return EXPECTED.some(function (re) { return re.test(text || ''); });
    };

    function record(m) {
      if (m.method === 'Runtime.exceptionThrown') {
        problems.push('uncaught ' + describeException(m.params.exceptionDetails));
        return;
      }
      if (m.method === 'Log.entryAdded') {
        var entry = m.params.entry;
        logs.push('[' + entry.level + '] ' + entry.text);
        if (entry.level === 'error' && !isExpected(entry.text)) problems.push('console error: ' + entry.text);
        return;
      }
      if (m.method === 'Runtime.consoleAPICalled') {
        var text = (m.params.args || []).map(function (a) {
          return a.value !== undefined ? String(a.value) : (a.description || a.type);
        }).join(' ');
        logs.push('[console.' + m.params.type + '] ' + text);
        if (m.params.type === 'error') problems.push('console.error: ' + text);
      }
    }

    var target = await send('Target.createTarget', { url: 'about:blank' });
    var attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    sessionId = attached.sessionId;
    await send('Runtime.enable', {});
    await send('Log.enable', {});
    await send('Page.enable', {});
    await send('Page.navigate', { url: url });
    await sleep(wait);

    opened = {
      url: url,
      logs: logs,
      problems: problems,

      // Run a function in the page. The function is serialized and called with `args` spread as its
      // parameters — `evaluate(fn, [a, b])` calls `fn(a, b)` in the page. It can therefore only reach
      // what the page has (`TP`, `document`, `window`) plus whatever the test chose to hand it, and
      // cannot quietly close over a variable from the test file. That restriction is the feature: it
      // keeps a browser test honest about the fact that it is running somewhere else. `awaitPromise`
      // means the function may be async, so a test can click a button and wait for what the click
      // starts.
      //
      // Spread rather than passed as one array, because the array form reads as though it were the
      // argument: `evaluate(fn, [a, b])` looks like `fn([a, b])`, and a test written that way fails as
      // "the file is not trip data" — the array is a JSON list at the root — which says nothing about
      // the mistake.
      evaluate: async function (fn, args) {
        var result = await send('Runtime.evaluate', {
          expression: '(' + fn.toString() + ')(' + (args || []).map(jsLiteral).join(', ') + ')',
          returnByValue: true,
          awaitPromise: true,
        });
        if (result.exceptionDetails) {
          throw new Error('the page threw while evaluating: ' + describeException(result.exceptionDetails) +
            (logs.length ? '\n  console:\n    ' + logs.slice(-12).join('\n    ') : ''));
        }
        return result.result.value;
      },

      close: function () { stop(); },
    };

    if (opts.allowProblems !== true && problems.length) {
      throw new Error('the page reported ' + problems.length + ' problem(s) while loading ' + url + ':\n  ' +
        problems.join('\n  ') + (logs.length ? '\n  console:\n    ' + logs.slice(-12).join('\n    ') : ''));
    }
    return opened;
  } catch (e) {
    stop();
    throw e;
  }
}

function describeException(details) {
  if (!details) return 'an exception with no details';
  var ex = details.exception || {};
  // `details.text` is the generic "Uncaught" that Chrome puts on ANY uncaught error; what the page
  // actually said is in the exception's own description, stack and all. Taking `text` first threw the
  // message away — every uncaught error reported as `uncaught Uncaught at <url>:<line>` with no message
  // in it at all, which is the one thing a failure message must never be. (Found by the last test in
  // `test/browser.test.js`, which exists to check that a page that threw cannot pass; it could not have
  // found it without being able to read the message either.)
  if (ex.description) return String(ex.description);
  var text = details.text || ex.className || 'an exception';
  var where = details.url ? ' at ' + details.url + ':' + (details.lineNumber + 1) : '';
  return text + where;
}

// An argument, as JavaScript source. `JSON.stringify` leaves U+2028 and U+2029 as themselves, and a
// LINE SEPARATOR reaches the engine as a line terminator: inside the string literal this becomes, a
// raw one is a syntax error in the whole expression — and a syntax error here would report as "the
// page threw", the opposite of the truth. So both are written as escapes.
//
// The two characters are built from their code points rather than typed — here and in the test files
// that use them — for a dull reason worth one line: a source line holding a raw U+2028 IS a line
// separator, so the next editor, formatter or patch tool to touch this file would be entitled to
// break the line there and turn a test asset into a syntax error.
var BACKSLASH = String.fromCharCode(92);

function jsLiteral(value) {
  return JSON.stringify(value).split('').map(function (ch) {
    var code = ch.charCodeAt(0);
    if (code !== 0x2028 && code !== 0x2029) return ch;
    return BACKSLASH + 'u' + code.toString(16);
  }).join('');
}

module.exports = {
  ROOT: ROOT,
  ARTIFACT: ARTIFACT,
  ARTIFACT_URL: ARTIFACT_URL,
  CHROME: CHROME,
  capabilities: capabilities,
  available: available,
  reason: reason,
  serve: serve,
  visit: visit,
  sleep: sleep,
};
