#!/usr/bin/env node
'use strict';

// The build (specs/02-architecture.md §4).
//
//   node build.js
//
// Reads the authored fragments, inlines the stylesheet, concatenates the program, mints the
// initial container, and writes dist/trip-planner.html. No bundler, no transformation, and nothing
// to install: this file requires only Node's own modules (REQ-107), so "it builds from nothing"
// is a claim anyone can check in one command.
//
// The output goes to `dist/`, which is in `.gitignore`. The artifact is a BUILD OUTPUT: a repository
// that carries its own compiled result carries a second copy of the app, and the copy is the one
// people open — so a commit that touched src/ and forgot to rebuild would ship a file that disagrees
// with its own source, silently, to everyone. Nothing about the file changed; it is the same single
// self-contained artifact, and `node build.js` still produces it in one command from a bare checkout.
//
// It concatenates; it does not transform. The one thing it does beyond joining text is refuse to
// emit an artifact that fails any of its own checks — a build that ships a defect silently is
// worse than a build that stops, because the defect ships to every person who double-clicks the
// file (REQ-109, REQ-111, REQ-112).
//
// A note on `<` in these sources: a literal `</script` sequence inside the concatenated program
// would end the artifact's own inline script element at that byte, and everything after it would
// be parsed as markup. Every occurrence in src/ is therefore written split (`'<' + '/script'`) or
// backslash-escaped (`<\/script`), and `checkScriptText` below fails the build if one comes back.

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var fragments = require('./src/fragments.js');

var ROOT = __dirname;
var OUTPUT = path.join('dist', 'trip-planner.html');
var SHELL = 'index.html';
var STYLES = 'styles/main.css';

// The version this build stamps into the artifact and into the containers it mints. It is not
// read from anywhere else, so there is one place to change it.
var APP_VERSION = '0.2.0';

var AUTHOR = { name: 'Trip Planner', email: '' };
var ROOT_MESSAGE = 'Start this document';

// The declared AI endpoints, which become the policy's `connect-src` (specs/02 §7).
//
// A policy is static bytes, so this cannot be computed from the user's settings at runtime: it is
// the list of hosts this app can be configured to reach, fixed here. A base URL or CORS proxy a
// user types in that is not on this list cannot be covered by a static policy — that limitation
// is recorded as Q-4 in specs/10-open-questions.md, and stated in the settings UI.
var AI_ENDPOINTS = [
  'https://ollama.com',              // Ollama Cloud: chat, web_search, web_fetch
  'http://localhost:11434',          // a local Ollama, when the browser is told to allow it
  'https://esm.run',                 // where the WebGPU transport imports @mlc-ai/web-llm from
  'https://cdn.jsdelivr.net',        // where esm.run resolves to, and where its chunks live
  'https://huggingface.co',          // the model weights the WebGPU runtime downloads
  'https://raw.githubusercontent.com',
];

// The SCRIPT hosts the policy admits, which become the host part of `script-src` (specs/02 §7).
//
// A dynamic `import()` of a module is governed by `script-src` (specifically `script-src-elem`),
// NOT by `connect-src`. Listing the CDN only as a connect target is what silently broke the served
// WebGPU transport: the module fetch was refused before any network request, and the console said
// `script-src 'sha256-…'` while the policy looked, to a reader of this file, like it had already
// allowed the CDN. WebAssembly compilation is governed by `script-src` too, which is why the
// template carries the `'wasm-unsafe-eval'` keyword; without it web-llm's tvmjs runtime dies with a
// `CompileError`.
//
// This is deliberately a SEPARATE list from `AI_ENDPOINTS`. Naming a host here means "code from
// this origin may run inside our page", which is a stronger grant than "we may talk to it"; reusing
// `AI_ENDPOINTS` would hand script rights to the Ollama hosts and to huggingface.co as well. The
// build checks below that every script host is also a connect host, because the module a script
// host loads still fetches its chunks and weights over `connect-src`.
//
// `esm.run` 301s to `cdn.jsdelivr.net`, and CSP checks the redirect target, so both must be named.
var SCRIPT_ENDPOINTS = [
  'https://esm.run',
  'https://cdn.jsdelivr.net',
];

// ---- Small helpers ----

function BuildError(message) {
  this.name = 'BuildError';
  this.message = message;
}
BuildError.prototype = Object.create(Error.prototype);

function fail(message) { throw new BuildError(message); }

function read(relative) {
  var file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) fail('Missing file: ' + relative + ' (the build needs it at ' + file + ')');
  return fs.readFileSync(file, 'utf8');
}

function count(haystack, needle) {
  var n = 0;
  var at = 0;
  for (;;) {
    at = haystack.indexOf(needle, at);
    if (at === -1) return n;
    n++;
    at += needle.length;
  }
}

// Text inserted into an HTML text node or a double-quoted attribute value. Our own values are
// tame, but the trip title is user data the moment the container is real, and "the value happened
// to be safe today" is not a rule.
function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(value) {
  return escapeHtmlText(value).replace(/"/g, '&quot;');
}

function kib(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }

// ---- The program text ----

// A banner before each fragment. The artifact is meant to be readable by the person who opens it,
// and the banners give the static checks something to attribute a finding to: "this sequence is
// in io/export.js" is a different statement from "this sequence is somewhere in the program".
function banner(relative) {
  return '\n/* ------------------------------ src/' + relative + ' ------------------------------ */\n';
}

function programText() {
  // The namespace first, from the same constant the test harness uses, so "what is the program's
  // first line" has one answer (REQ-108).
  var parts = ['/* ------------------------------ preamble ------------------------------ */\n' +
    fragments.PREAMBLE];
  fragments.forEach(function (relative) {
    var source = fragments.sourceOf(relative, read);
    // Each fragment is checked on its own first, so a syntax error is reported against the file
    // that has it rather than against a 300 KB concatenation.
    try {
      new vm.Script(source, { filename: 'src/' + relative });
    } catch (e) {
      fail('src/' + relative + ' does not parse: ' + e.message);
    }
    checkShadowedHelpers(relative, source);
    parts.push(banner(relative) + source.replace(/\s*$/, '') + '\n');
  });
  var text = parts.join('');

  try {
    new vm.Script(text, { filename: 'program' });
  } catch (e) {
    fail('The concatenated program does not parse: ' + e.message +
      '\n  This is usually one fragment ending with an expression that the next one continues.');
  }
  return text;
}

// The one sequence that cannot survive being written into an inline script element.
function checkScriptText(text) {
  if (count(text, '</script') > 0) {
    fail('The program contains a literal "</script" sequence, which would end the artifact\'s own ' +
      'script element. Write it split (\'<\' + \'/script\') or escaped (<\\/script) — see the note at the top of this file.');
  }
  if (count(text, '<!--') > 0) {
    fail('The program contains "<!--", which switches the HTML parser into a comment-like state ' +
      'inside script data. Script text may not carry it.');
  }
}

// ---- Shadowed helpers ----
//
// A parameter named after a helper the same fragment calls shadows it, and the call then fails at
// runtime with "text is not a function" on input that is otherwise perfectly readable. That is not
// hypothetical: src/interchange/ical.js shipped `function toTrip(text, …)` while calling its own
// `text()` unescaper, so every calendar the app exported was one it could not read back. A missing
// call is a missing call — the only reliable fix is a different name.
//
// The check is deliberately narrow: it reports a parameter only when the SAME function body calls
// that name. A parameter that merely shares a name with a helper it never calls is untidy, not
// broken, and flagging those would make the check something to work around.
function checkShadowedHelpers(relative, source) {
  // Top-level declarations inside a fragment sit at two spaces (inside the module IIFE).
  var decl = /^  function ([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/gm;
  var declarations = [];
  var m;
  while ((m = decl.exec(source)) !== null) {
    declarations.push({ name: m[1], params: m[2], start: m.index, bodyStart: decl.lastIndex });
  }
  var topLevel = {};
  declarations.forEach(function (d) { topLevel[d.name] = true; });

  for (var i = 0; i < declarations.length; i++) {
    var d = declarations[i];
    // The body runs to the next top-level declaration, which is close enough: everything after it
    // belongs to another function, and a call there is that function's business.
    var end = i + 1 < declarations.length ? declarations[i + 1].start : source.length;
    var body = source.slice(d.bodyStart, end);
    var params = d.params.split(',').map(function (p) { return p.trim().split(/[=\s]/)[0]; })
      .filter(function (p) { return p && topLevel[p]; });
    params.forEach(function (p) {
      if (new RegExp('(^|[^\\w$.])' + p.replace(/\$/g, '\\$') + '\\s*\\(').test(body)) {
        fail('src/' + relative + ': the parameter "' + p + '" of ' + d.name + ' shadows the fragment\'s ' +
          'own ' + p + '() helper, and ' + d.name + ' calls ' + p + '() — so the call would fail at ' +
          'runtime. Give the parameter a different name.');
      }
    });
  }
}

// ---- The pure prefix, in a sandbox ----

// The build mints the initial container by RUNNING the same bytes the artifact will run, so the
// container it writes and the containers the app writes come from one implementation (REQ-108).
// fragments.BUILD_PREFIX_END names the last fragment of the pure subset; nothing in it touches the
// DOM or storage, and the two platform reads it does make (`location`, `window`) are satisfied by
// the stubs below — enough for `environment.js` to answer, not enough to mislead anything else.
function sandbox() {
  var prefixEnd = fragments.indexOf(fragments.BUILD_PREFIX_END);
  if (prefixEnd === -1) fail('BUILD_PREFIX_END names a fragment that is not in the declared order');
  var prefix = fragments.slice(0, prefixEnd + 1);

  var context = vm.createContext({
    TP: {},
    location: { protocol: 'file:' },
    window: {},
    console: console,
  });

  vm.runInContext(fragments.PREAMBLE + prefix.map(function (relative) {
    return read(path.join('src', relative));
  }).join('\n'), context, { filename: 'build-prefix.js' });

  return context;
}

// Minted in the sandbox and returned as strings, so no object crosses the realm boundary.
var MINT = [
  '(function () {',
  "  'use strict';",
  '  var input = BUILD_INPUT;',
  '',
  '  // The hand-written SHA-256 is checked against the published NIST vectors before it is used',
  '  // to compute anything that ships (REQ-307, ADR-0004). A hand-written hash that is wrong is',
  '  // wrong silently, everywhere, forever — so it is checked here as well as in the tests.',
  '  TP.sha256.verifyVectors();',
  '',
  '  var docId = TP.uid();',
  '  var trip = TP.model.newTrip({ docId: docId });',
  '  var payload = { trip: trip };',
  '',
  '  // The shipped file is what "+ New Trip" produces: a new document with a root commit. Minting',
  '  // it through TP.history.append rather than by hand means the artifact\'s first commit is made',
  '  // by exactly the code that makes every other one.',
  '  var appended = TP.history.append(TP.history.newHistory(), payload, {',
  '    docId: docId,',
  '    author: { name: input.author.name, email: input.author.email },',
  '    timestamp: input.generatedAt,',
  '    message: input.message,',
  '  });',
  '',
  '  var container = TP.container.create(payload, {',
  '    appVersion: input.appVersion,',
  '    appHash: input.appHash,',
  '    generatedAt: input.generatedAt,',
  '  }, appended.history);',
  '',
  '  // Two checks on the thing just minted, before it is embedded in anything.',
  '  var chain = TP.verify.chain(container.history);',
  '  var blockText = TP.container.toBlockText(container);',
  '  var readBack = TP.container.parseBlock(blockText);',
  '  var roundTrip = false;',
  '  try {',
  '    roundTrip = TP.canonical.serialize(readBack) === TP.canonical.serialize(container);',
  '  } catch (e) { roundTrip = false; }',
  '',
  '  globalThis.BUILD_RESULT = {',
  '    chainOk: chain.ok,',
  '    chainChecked: chain.checked,',
  '    chainErrors: chain.errors.map(function (e) { return e.problem; }),',
  '    roundTrip: roundTrip,',
  '    blockText: blockText,',
  '    blockChars: blockText.length,',
  '    limits: { maxSourceChars: TP.container.LIMITS.maxSourceChars, maxBytes: TP.container.LIMITS.maxBytes },',
  '    docId: docId,',
  '    commitId: appended.commit.id,',
  '    commitStorage: appended.decision && appended.decision.kind,',
  '    tripTitle: TP.model.tripTitle(trip),',
  '  };',
  '})();',
].join('\n');

function mintContainer(context, appHash) {
  var generatedAt = new Date().toISOString();
  context.BUILD_INPUT = {
    appHash: appHash,
    appVersion: APP_VERSION,
    generatedAt: generatedAt,
    author: AUTHOR,
    message: ROOT_MESSAGE,
  };
  vm.runInContext(MINT, context, { filename: 'build-mint.js' });

  var result = context.BUILD_RESULT;
  if (!result) fail('The initial container was not produced (the build mint produced no result).');
  if (!result.roundTrip) {
    fail('The initial container did not survive a write and a read back, so the build stopped ' +
      'rather than shipping a data block that cannot be read.');
  }
  if (!result.chainOk) {
    fail('The initial container\'s history does not hold together: ' + result.chainErrors.join('; '));
  }
  result.generatedAt = generatedAt;
  return result;
}

// ---- Authoring-only regions ----

// `index.html` is also what a static server hands out at `/` (README, "Run it"), so the likeliest
// way to see this file is by accident: serve the folder, open the root, and get the shell template
// rather than the application. What happens then is the template working as designed and completely
// silent about it — the policy pins a hash of the real program, the placeholder does not hash to
// it, so the browser refuses to run it and says only `script-src 'none'`.
//
// The notice this removes is the part that is not silent. It is the shell's only authoring-only
// region, and it must not ship: in the artifact it would sit above a working application saying the
// application is not there.
var AUTHORING_ONLY = /[^\S\n]*<!-- build:authoring-only -->[\s\S]*?<!-- \/build:authoring-only -->\n?/g;

function stripAuthoringOnly(markup) {
  return markup.replace(AUTHORING_ONLY, '');
}

// ---- The shell template ----

function shellTemplate() {
  var markup = stripAuthoringOnly(read(SHELL));

  // An unpaired marker means the region was NOT removed, and the notice went into the artifact with
  // it. The markers are the only two places the name appears, so the name is the check.
  if (markup.indexOf('build:authoring-only') !== -1) {
    fail('index.html has an unpaired `build:authoring-only` marker, so the authoring-only region ' +
      'was left in place and the notice inside it would ship.');
  }

  // Static checks on the shell markup, run before substitution so a finding names the template
  // rather than a megabyte of assembled artifact.
  var inlineStyle = markup.match(/\sstyle\s*=/i);
  if (inlineStyle) {
    fail('index.html carries a `style="..."` attribute. The artifact pins style-src to a hash, ' +
      'and a hash-pinned policy blocks inline style attributes silently — the page would render ' +
      'unstyled with nothing reporting why. Use a class, or set properties through the CSSOM.');
  }
  var inlineHandler = markup.match(/\son[a-z]+\s*=\s*["']/i);
  if (inlineHandler) {
    fail('index.html carries an inline event handler (' + inlineHandler[0].trim() + '). Inline ' +
      'handlers are not covered by a hash-pinned policy and are forbidden (REQ-106).');
  }
  if (/\stype\s*=\s*["']module["']/i.test(markup)) {
    fail('index.html asks for a module script. Under `file://` the page has an opaque origin and ' +
      'module loading is CORS-blocked, so the app would not start (REQ-103).');
  }
  if (/\ssrc\s*=/i.test(markup)) {
    fail('index.html refers to an external script. The artifact has no external references of any ' +
      'kind, so that it works offline from a file (ADR-0002).');
  }
  if (count(markup, '<script') !== 2) {
    fail('index.html should carry exactly two script elements — the inert data block and the ' +
      'program — and carries ' + count(markup, '<script') + '.');
  }

  return markup;
}

function stylesheet() {
  var css = read(STYLES);
  if (count(css, '</style') > 0) fail('styles/main.css contains "</style", which would end the inlined stylesheet early.');
  if (/@import/i.test(css)) fail('styles/main.css uses @import. The artifact has no external references of any kind (ADR-0002).');
  if (/url\s*\(/i.test(css)) {
    fail('styles/main.css uses url(...). Nothing may be fetched at runtime — the artifact has no ' +
      'external references, so an image or font must be a data: URI (ADR-0002).');
  }
  return css;
}

// ---- Substitution ----

// One pass, and any token left over afterwards fails the build (REQ-109). A shipped `{{TOKEN}}` is
// a defect that ships: it is invisible in review, present in every copy, and the file still opens.
function substitute(template, values) {
  var seen = Object.create(null);
  var out = template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, function (whole, name) {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      fail('The template asks for {{' + name + '}}, and the build has no value for it. The build ' +
        'refuses to write a placeholder into an artifact.');
    }
    seen[name] = (seen[name] || 0) + 1;
    return values[name];
  });

  var leftover = out.match(/\{\{[^}]*\}\}/);
  if (leftover) {
    fail('The assembled artifact still contains ' + leftover[0] + '. That is a placeholder the ' +
      'template misspelled, or one a substituted value put back.');
  }

  var required = ['styles', 'escapedJSON', 'concatenatedJS', 'tripTitle', 'appVersion', 'appHash',
    'policyHash', 'styleHash', 'aiEndpoints', 'scriptEndpoints'];
  required.forEach(function (name) {
    if (!seen[name]) {
      fail('The template never uses {{' + name + '}}, so the artifact would be missing it. A ' +
        'placeholder that quietly stops being used is how a build stops doing its job.');
    }
  });

  return out;
}

// ---- Static checks on the artifact ----

// The forbidden-API sweep (REQ-106, REQ-703). It runs over the built artifact rather than the
// sources, because the artifact is what ships and a source grep can be defeated by a string the
// concatenation joins.
//
// `outerHTML` has an allowlist of exactly one call site: the export path serializes a document the
// app itself built from a fixed template. Anything else that turns a node into markup text is a
// way for data to become code.
function checkForbiddenApis(artifact) {
  var banned = [
    { name: '.innerHTML', pattern: /\.innerHTML\b/ },
    { name: '.insertAdjacentHTML', pattern: /\.insertAdjacentHTML\b/ },
    { name: 'document.write', pattern: /document\s*\.\s*write\b/ },
    { name: 'eval(', pattern: /[^.\w]eval\s*\(/ },
    { name: 'new Function', pattern: /\bnew\s+Function\s*\(/ },
    { name: 'createContextualFragment', pattern: /createContextualFragment\b/ },
  ];
  banned.forEach(function (rule) {
    if (rule.pattern.test(artifact)) {
      fail('The artifact contains ' + rule.name + '. Nothing that turns data into code or markup ' +
        'may ship (REQ-106, REQ-701).');
    }
  });

  var outer = artifact.match(/\.outerHTML\b/g) || [];
  if (outer.length !== 1) {
    fail('The artifact contains ' + outer.length + ' uses of .outerHTML, and exactly one is ' +
      'allowed: the export path\'s serialization of a document the app built itself.');
  }
  var at = artifact.indexOf('.outerHTML');
  var before = artifact.lastIndexOf('/* ---', at);
  var section = before === -1 ? '(unknown)' : artifact.slice(before, artifact.indexOf('--- */', before));
  if (section.indexOf('io/export.js') === -1) {
    fail('The one allowed .outerHTML is not the export path\'s — it appears in ' + section.replace(/[/*-]/g, '').trim() +
      '. The allowlist is one call site in one place, not "one somewhere".');
  }
}

// The shell must not offer what this environment cannot do before the program has had a chance to
// say so (REQ-603, REQ-604). These are the pre-script surface, and they are asserted here because
// they are exactly the sort of thing an edit silently drops.
function checkShellMarkup(artifact) {
  var aiTab = artifact.match(/<button[^>]*data-tab="ai"[^>]*>/i);
  if (!aiTab) fail('The artifact has no AI tab button at all.');
  if (!/\shidden(\s|>)/.test(aiTab[0])) {
    fail('The AI tab does not ship hidden. Under `file://` it must not be offered before any ' +
      'script runs (REQ-603).');
  }
  var dataBlock = artifact.indexOf('id="app-data"');
  var program = artifact.indexOf('id="app-script"');
  var policy = artifact.indexOf('Content-Security-Policy');
  if (policy === -1) fail('The artifact carries no content policy.');
  if (policy > artifact.indexOf('<script')) {
    fail('The content policy does not precede the first script, so it governs nothing (REQ-105).');
  }
  if (dataBlock === -1) fail('The artifact carries no data block (REQ-104).');
  if (program === -1) fail('The artifact carries no program script (REQ-103).');
  if (dataBlock > program) fail('The data block must precede the program.');

  // The authoring-only region was stripped from the template above; this asserts it over the bytes
  // actually written, for the same reason the two hashes are re-read from the artifact rather than
  // trusted.
  if (artifact.indexOf('id="unbuilt-notice"') !== -1) {
    fail('The artifact carries the shell template\'s unbuilt notice. It is authoring-only: ' +
      '`index.html` is what a static server serves at `/`, and the notice is there to explain the ' +
      'template to whoever lands on it. In the artifact it would sit above a working application.');
  }
}

function scriptTextOf(artifact) {
  var open = artifact.indexOf('id="app-script"');
  if (open === -1) fail('No program script to read.');
  var start = artifact.indexOf('>', open) + 1;
  var end = artifact.indexOf('</script', start);
  if (end === -1) fail('The program script is not closed.');
  return artifact.slice(start, end);
}

// ---- Main ----

function main() {
  console.log('Building ' + OUTPUT + ' from ' + fragments.length + ' fragments…');

  var program = programText();
  checkScriptText(program);

  var css = stylesheet();
  var template = shellTemplate();

  var context = sandbox();
  var appHash = context.TP.sha256.base64(program);
  var styleHash = context.TP.sha256.base64(css);

  var minted = mintContainer(context, 'sha256-' + appHash);
  checkScriptText(minted.blockText);

  var artifact = substitute(template, {
    styles: css,
    escapedJSON: minted.blockText,
    concatenatedJS: program,
    tripTitle: escapeHtmlText(minted.tripTitle),
    appVersion: escapeHtmlAttr(APP_VERSION),
    appHash: escapeHtmlAttr(appHash),
    policyHash: escapeHtmlAttr(appHash),
    styleHash: escapeHtmlAttr(styleHash),
    aiEndpoints: escapeHtmlAttr(AI_ENDPOINTS.join(' ')),
    scriptEndpoints: escapeHtmlAttr(SCRIPT_ENDPOINTS.join(' ')),
  });

  checkForbiddenApis(artifact);
  checkShellMarkup(artifact);

  // Two hashes claim to describe the program: the declaration in `meta[name=app-hash]`, which the
  // export path re-checks against the running text, and the policy's `script-src`, which decides
  // whether the program is allowed to run at all. A mismatch in either is silent — the file still
  // opens — so both are verified against the bytes actually written.
  var runningHash = 'sha256-' + context.TP.sha256.base64(scriptTextOf(artifact));
  if (artifact.indexOf('name="app-hash" content="' + runningHash + '"') === -1) {
    fail('The declared app hash does not match the program in the artifact.');
  }
  // A script host that is not also a connect host is almost certainly a mistake: the module it
  // loads fetches its chunks and weights over `connect-src` (specs/02 §7).
  SCRIPT_ENDPOINTS.forEach(function (origin) {
    if (AI_ENDPOINTS.indexOf(origin) === -1) {
      fail('SCRIPT_ENDPOINTS names ' + origin + ', which is not in AI_ENDPOINTS. A module loaded ' +
        'from a script host still needs that host reachable over connect-src.');
    }
  });

  // The script-src is not just the hash any more: a dynamic import() is governed by script-src, and
  // web-llm's WASM runtime needs 'wasm-unsafe-eval' (specs/02 §7, REQ-713, ADR-0020). A policy with
  // the hash but without these is unable to load the served AI at all, and it fails silently — the
  // module import just rejects. So the build compares the whole directive to the bytes it declared.
  var expectedScriptSrc = "script-src 'sha256-" + appHash + "' 'wasm-unsafe-eval' " +
    SCRIPT_ENDPOINTS.join(' ');
  if (artifact.indexOf(expectedScriptSrc) === -1) {
    fail('The policy\'s script-src is not the one this build declares. A dynamic import() of the ' +
      'WebGPU module is governed by script-src (not connect-src), and WebAssembly.instantiate needs ' +
      "'wasm-unsafe-eval'; without all of it the served AI cannot load. Expected:\n\n  " +
      expectedScriptSrc);
  }
  if (artifact.indexOf("style-src 'sha256-" + styleHash + "'") === -1) {
    fail('The policy\'s style-src does not pin the stylesheet in the artifact, so the page would ' +
      'render unstyled.');
  }

  // The app must be able to read back a file it wrote. Import refuses a source above
  // `maxSourceChars`, and this document plus the largest data block it is allowed to carry is
  // the biggest file it can produce — so if those two ever meet, every export becomes
  // unopenable and the failure shows up in the user's hands rather than here (REQ-404).
  var largest = artifact.length + minted.limits.maxBytes;
  if (largest > minted.limits.maxSourceChars) {
    fail('This document plus the largest data block it may carry comes to ' +
      largest.toLocaleString() + ' characters, more than the ' +
      minted.limits.maxSourceChars.toLocaleString() + ' that Import will read. Every exported ' +
      'file would be unopenable. Raise `maxSourceChars` in src/core/container.js, or the artifact ' +
      'will not be able to read what it writes.');
  }

  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUTPUT), artifact, 'utf8');

  console.log('  fragments      ' + fragments.length + ' (' + kib(program.length) + ' of program)');
  console.log('  stylesheet     ' + kib(css.length));
  console.log('  data block     ' + kib(minted.blockChars) + ' (' + minted.blockText.length + ' chars)');
  console.log('  document       ' + kib(artifact.length) + ' → ' + OUTPUT);
  console.log('  app hash       ' + runningHash);
  console.log('  style hash     sha256-' + styleHash);
  console.log('  container      ' + minted.commitStorage + ' root commit ' + minted.commitId.slice(0, 19) +
    '… (chain intact, ' + minted.chainChecked + ' commit)');
  console.log('  policy         script-src  ' + SCRIPT_ENDPOINTS.join(' ') + " 'wasm-unsafe-eval'");
  console.log('                 connect-src ' + AI_ENDPOINTS.join(' '));
  console.log('Done.');
}

try {
  main();
} catch (e) {
  if (e instanceof BuildError) {
    console.error('\nThe build stopped:\n\n  ' + e.message + '\n');
    console.error('Nothing was written. ' + OUTPUT + ' is unchanged.');
    process.exit(1);
  }
  throw e;
}
