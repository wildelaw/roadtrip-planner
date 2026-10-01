// The artifact's own tests (specs/09-testing.md §8, REQ-807, REQ-808).
//
// `build.js` enforces most of what is below WHILE it writes the file, and fails the build rather than
// shipping. This file exists anyway, for two reasons:
//
//   * It reads `dist/trip-planner.html` off disk and inspects the bytes, the way a reviewer would. A check
//     written inside the builder runs over the string the builder just made; if the builder is
//     changed, skipped, or run against a stale source list, that check is still green. This one is
//     not — it fails on a missing or hand-edited artifact, which is the difference between checking
//     the program and checking the build.
//
//   * Every rule here is a FUNCTION over a string, and every one of them is then fed a deliberately
//     broken string at the end. A check that cannot fail is the most convincing kind of false
//     comfort, and this repository makes that argument in three other test files; this one has to
//     hold itself to it too. Finding the substring rule that mattered: a first draft of the
//     no-dev-tooling list banned "chai", which appears 70 times in the shipped program — inside the
//     word "chain".

'use strict';

var crypto = require('crypto');
var h = require('./harness.js');

// The artifact, split into the two things it is: the markup (everything except the program's
// contents) and the program itself. Almost every assertion below is about one of the two, and a
// rule applied to the whole file would be checking the program's comments as though they were the
// document — a comment that mentions `type="module"` is not a module script.
function parts() {
  var file = h.read('dist/trip-planner.html');
  var open = '<script id="app-script">';
  var at = file.indexOf(open);
  if (at === -1) throw new h.AssertionError('the artifact carries no program script (REQ-103)');
  var start = at + open.length;
  var end = file.indexOf('</script', start);
  if (end === -1) throw new h.AssertionError('the program script is not closed');
  return {
    file: file,
    markup: file.slice(0, start) + file.slice(end),
    program: file.slice(start, end),
  };
}

function csp(markup) {
  var m = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(markup);
  if (!m) throw new h.AssertionError('the artifact carries no content policy (REQ-105)');
  return m[1];
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

// ---- The rules, as functions, so they can be fed something broken ----

// REQ-101, REQ-103, REQ-113: one file, and nothing in it that could be fetched. Each of these is a
// separate way for the document to need something it does not have, and under `file://` the browser
// has no way to get it.
var externalRules = [
  { name: 'an external stylesheet', pattern: /<link\b/i },
  { name: 'a script or image source', pattern: /\ssrc\s*=/i },
  { name: 'an @import in the stylesheet', pattern: /@import/i },
  { name: 'a url(...) in the stylesheet', pattern: /url\s*\(/i },
  { name: 'a module script', pattern: /\stype\s*=\s*["']module["']/i },
  { name: 'an inline event handler', pattern: /\son[a-z]+\s*=\s*["']/i },
  { name: 'an inline style attribute', pattern: /\sstyle\s*=/i },
];

function externalComplaints(markup) {
  return externalRules.filter(function (rule) { return rule.pattern.test(markup); })
    .map(function (rule) { return 'the markup carries ' + rule.name; });
}

// REQ-106, REQ-703: nothing that turns data into code or markup. The list is the same one the
// builder sweeps and for the same reason, but it is applied here to the shipped bytes.
var forbiddenRules = [
  { name: '.innerHTML', pattern: /\.innerHTML\b/ },
  { name: '.insertAdjacentHTML', pattern: /\.insertAdjacentHTML\b/ },
  { name: 'document.write', pattern: /document\s*\.\s*write\b/ },
  { name: 'eval(', pattern: /[^.\w]eval\s*\(/ },
  { name: 'new Function', pattern: /\bnew\s+Function\s*\(/ },
  { name: 'createContextualFragment', pattern: /createContextualFragment\b/ },
];

function forbiddenComplaints(program) {
  var out = [];
  forbiddenRules.forEach(function (rule) {
    if (rule.pattern.test(program)) out.push('the program contains ' + rule.name);
  });

  // `.outerHTML` is the one construct with an allowlist, and the allowlist is one call site in one
  // place rather than "one somewhere": the export path serializing a document the app built from a
  // fixed template. Anywhere else it is a way for data to become markup.
  var at = program.indexOf('.outerHTML');
  var uses = count(program, '.outerHTML');
  if (uses !== 1) {
    out.push('the program uses .outerHTML ' + uses + ' times, and exactly one call site is allowed');
  } else {
    var section = program.lastIndexOf('/* ---', at);
    var name = section === -1 ? '' : program.slice(section, program.indexOf('--- */', section));
    if (name.indexOf('io/export.js') === -1) {
      out.push('the one .outerHTML is not the export path\'s, but in ' + (name.replace(/[/*-]/g, '').trim() || 'an unnamed section'));
    }
  }
  return out;
}

// REQ-807: no test tooling, no development dependency, nothing that only exists in this repository.
// Only markers that cannot appear in shipped code by accident: an earlier draft banned "chai" and
// matched the word "chain" seventy times.
var DEV_MARKERS = ['require(', 'module.exports', '__dirname', 'process.', 'node:',
                   'puppeteer', 'playwright', 'mocha', 'ajv', 'jsdom'];

function devComplaints(program) {
  return DEV_MARKERS.filter(function (marker) { return program.indexOf(marker) !== -1; })
    .map(function (marker) { return 'the program contains "' + marker + '", which belongs to the test tooling'; });
}

// REQ-109, and the same rule `build.js` applies to its own output: a `{{name}}` that survived the
// substitution. The shape matters, and finding that out cost a false positive — see the call site.
function placeholderComplaints(text) {
  var m = text.match(/\{\{[^}]*\}\}/);
  return m ? ['the artifact contains ' + m[0]] : [];
}

// The shell's one authoring-only region. `index.html` is what a static server serves at `/`, so the
// notice explaining the unbuilt template is written in the template and removed by the build — and
// both halves are asserted, because the failure is silent in both directions: a notice that ships
// sits above a working application, and a notice that is deleted takes the explanation with it and
// leaves the next person with two content-policy errors and no page.
var UNBUILT_MARK = 'id="unbuilt-notice"';
var REGION_OPEN = '<!-- build:authoring-only -->';
var REGION_CLOSE = '<!-- /build:authoring-only -->';

function authoringOnlyComplaints(file) {
  var out = [];
  if (file.indexOf(UNBUILT_MARK) !== -1) {
    out.push('the artifact carries the shell template\'s unbuilt notice');
  }
  if (file.indexOf('build:authoring-only') !== -1) {
    out.push('the artifact carries an authoring-only marker');
  }
  return out;
}

module.exports = {
  name: 'artifact (REQ-807, REQ-808)',

  tests: [
    {
      name: 'one self-contained file: no external reference of any kind, and a policy that forbids one (REQ-101, REQ-103, REQ-105, REQ-113)',
      run: function () {
        var p = parts();

        h.deepEqual(externalComplaints(p.markup), [], 'the markup is not self-contained:\n        ' +
          externalComplaints(p.markup).join('\n        '));

        // Two script elements and one stylesheet, counted over the markup rather than the file. Over
        // the whole file this would count the program's own comments, which mention `<script` when
        // they explain what the import path looks for.
        h.equal(count(p.markup, '<script'), 2, 'the document has ' + count(p.markup, '<script') +
          ' script elements, not two — the inert data block and the program (REQ-103, REQ-104)');
        h.equal(count(p.markup, '<style'), 1, 'the document has ' + count(p.markup, '<style') + ' style elements, not one');

        // The data block is inert JSON, and it is the document (REQ-104, REQ-209).
        var block = /<script type="application\/json" id="app-data">([\s\S]*?)<\/script>/.exec(p.markup);
        h.ok(block, 'the artifact carries no data block');
        var container = JSON.parse(block[1]);
        h.equal(container.format, '1.0.0', 'the data block is not in this build’s container format');
        h.ok(container.payload && typeof container.payload === 'object', 'the data block has no payload');
        h.ok(container.history && typeof container.history.head === 'string', 'the data block has no history head');

        // REQ-115: the schemas are validated from the VENDORED copies, inlined at build time — so the
        // schema's own `$id` has to be in the shipped bytes, and the host that id names must not be
        // reachable. A validator that would have to fetch its schema does not work offline, and this
        // app only ever works offline.
        ['container-1.0.0.schema.json', 'trip-data-1.0.0.schema.json', 'icalendar-rfc5545.json'].forEach(function (name) {
          var schema = JSON.parse(h.read('vendor/' + name));
          h.ok(p.program.indexOf(schema.$id) !== -1,
            'the schema ' + name + ' is not inlined in the artifact, so validation would need to fetch it');
        });
        h.ok(csp(p.markup).indexOf('trip-planner.invalid') === -1,
          'the policy would let the document fetch the schema host, which is not where its schemas come from');

        // The policy itself: default-deny, both hashes pinned, and the connections named one by one.
        var policy = csp(p.markup);
        h.ok(/default-src 'none'/.test(policy), 'the policy does not default to denying everything');
        h.ok(/script-src 'sha256-[A-Za-z0-9+/=]+'/.test(policy), 'the policy does not pin the script by hash');
        h.ok(/style-src 'sha256-[A-Za-z0-9+/=]+'/.test(policy), 'the policy does not pin the stylesheet by hash');
        h.ok(/img-src data:/.test(policy), 'the policy does not allow inline images, which the app draws with');
        h.ok(/connect-src /.test(policy), 'the policy names no reachable endpoint at all, so the AI could never work');
        h.ok(/form-action 'none'/.test(policy), 'the policy allows form submissions');
        h.ok(/base-uri 'none'/.test(policy), 'the policy allows a base URI, which would rewrite every relative reference');
        h.ok(/frame-ancestors 'none'/.test(policy), 'the policy allows the document to be framed');
        // The policy must precede the first script, or it governs nothing (REQ-105).
        h.ok(p.file.indexOf('Content-Security-Policy') < p.file.indexOf('<script'),
          'the policy comes after the first script, so it was not in force when that script ran');
      },
    },

    {
      name: 'the shipped program is the declared fragments, verbatim and in order, and the declared hash is over those bytes (REQ-110, REQ-111, REQ-808)',
      run: function () {
        var p = parts();
        var fragments = h.fragments;

        // REQ-808: one declared order, consumed by both the build and the harness. Here it is checked
        // as the artifact states it: each fragment's banner, then its bytes, in the declared order.
        var expectedBanners = fragments.map(function (relative) { return 'src/' + relative; });
        var banners = (p.program.match(/\/\* -{4,} ([^ ]+) -{4,} \*\//g) || [])
          .map(function (b) { return /\* -{4,} ([^ ]+) -{4,} \*/.exec(b)[1]; });
        h.deepEqual(banners.slice(1), expectedBanners,
          'the program does not carry the declared fragments, in order, one banner each');
        h.equal(banners[0], 'preamble', 'the program does not begin with the preamble (REQ-108)');

        // REQ-110: the program is concatenated, never transformed — a minifier would make the shipped
        // code unauditable, which is the whole point of the app travelling with its source. So every
        // fragment's bytes appear in the artifact EXACTLY as they are on disk, in order.
        var cursor = 0;
        fragments.forEach(function (relative) {
          var source = fragments.sourceOf(relative, h.read);
          var at = p.program.indexOf(source, cursor);
          h.ok(at !== -1, 'src/' + relative + ' does not appear verbatim in the artifact after the fragments before it');
          cursor = at + source.length;
        });

        // REQ-111: the hash is over the FINAL bytes, and it is declared twice — in the data block's
        // build metadata and in the policy that pins the script. All three have to be the same digest,
        // or the document does not vouch for the program it carries. (This is also the mechanism that
        // was measured: editing one line of the built script makes the browser refuse to run it.)
        var digest = 'sha256-' + crypto.createHash('sha256').update(p.program, 'utf8').digest('base64');
        var declared = /<meta name="app-hash" content="([^"]+)"/.exec(p.markup);
        h.ok(declared, 'the artifact declares no app hash (REQ-111)');
        h.equal(declared[1], digest, 'the declared app hash is not the hash of the program the file carries');
        h.ok(csp(p.markup).indexOf(digest) !== -1,
          'the policy does not pin the program the file carries: ' + digest);
        h.equal(containerBuild(p).appHash, digest, 'the data block and the meta tag disagree about the app hash');
      },
    },

    {
      name: 'nothing that turns data into code or markup ships, and the one allowed .outerHTML is the export path\'s (REQ-106, REQ-701, REQ-703)',
      run: function () {
        var p = parts();
        h.deepEqual(forbiddenComplaints(p.program), [], 'the shipped program is not clean:\n        ' +
          forbiddenComplaints(p.program).join('\n        '));

        // The allowlist is where it is, not merely one in number: the export path serializes a document
        // it built itself from a fixed template, and that is the only node-to-markup conversion the
        // app is allowed to make.
        var at = p.program.indexOf('.outerHTML');
        var section = p.program.lastIndexOf('/* ---', at);
        h.ok(p.program.slice(section, p.program.indexOf('--- */', section)).indexOf('io/export.js') !== -1,
          'the one .outerHTML is not in the export path');

        // Every rule above, fed something that breaks it. This is the part that makes the rest worth
        // reading: a rule that had quietly stopped matching would pass every assertion above and fail
        // here.
        forbiddenRules.forEach(function (rule) {
          var complaints = forbiddenComplaints(sampleFor(rule.name));
          h.ok(complaints.length > 0, 'the rule for ' + rule.name + ' did not fire on a string that contains it');
        });
        // And the three shapes of the outerHTML rule: none, two, and one in the wrong place.
        h.ok(forbiddenComplaints('x = 1;').some(function (c) { return /outerHTML/.test(c); }),
          'a program with no .outerHTML at all was accepted, so the rule is not counting');
        h.ok(forbiddenComplaints('/* --- src/io/export.js --- */\na.outerHTML;\nb.outerHTML;\n/* --- x --- */')
          .some(function (c) { return /2 times/.test(c); }),
          'two uses of .outerHTML were accepted');
        h.ok(forbiddenComplaints('/* --- src/ui/render.js --- */\na.outerHTML;\n/* --- x --- */')
          .some(function (c) { return /export path/.test(c); }),
          'the allowed .outerHTML was accepted outside the export path');
        h.deepEqual(forbiddenComplaints('/* --- src/io/export.js --- */\na.outerHTML;\n/* --- x --- */'), [],
          'the export path\'s own .outerHTML was rejected');
      },
    },

    {
      name: 'no test tooling and no development dependency ships, and no placeholder survives the build (REQ-109, REQ-807)',
      run: function () {
        var p = parts();
        h.deepEqual(devComplaints(p.program), [], 'the artifact carries the test tooling:\n        ' +
          devComplaints(p.program).join('\n        '));

        // And each marker would be noticed: the same rule over a program that had one.
        DEV_MARKERS.forEach(function (marker) {
          h.ok(devComplaints('var x = 1; ' + marker + ' thing;').length > 0,
            'the rule for "' + marker + '" does not fire, so the empty result above means nothing');
        });
        // …but not on the shipped program's own words. "chai" is inside "chain", which the app says
        // seventy times; this is why the list is markers and not words.
        h.deepEqual(devComplaints('var chain = TP.verify.chain(container.history);'), [],
          'the dev-tooling rule fires on ordinary shipped code');

        // REQ-109: an unresolved placeholder is a silent failure — the file looks finished and says
        // `{{appHash}}` where the hash should be. The rule is the build's own, and it is a SHAPE rather
        // than a pair of braces: the first draft of this test counted `}}`, and the shipped program has
        // exactly one, closing the nested object in a comment about schemas (`{"properties": {"type":
        // {...}}}`). A placeholder is `{{name}}`.
        h.deepEqual(placeholderComplaints(p.file), [], 'a build placeholder survived into the artifact');

        // And it would be caught, and would not fire on the code that produced the false positive above.
        h.ok(placeholderComplaints('var x = {{appHash}};').length > 0,
          'the placeholder rule did not fire on {{appHash}}, so the empty result above means nothing');
        h.ok(placeholderComplaints('/* {{concatenatedJS}} */').length > 0,
          'the placeholder rule did not fire on a placeholder inside a comment, which is where one hides');
        h.deepEqual(placeholderComplaints('// declares a field: {"properties": {"type": {...}}}\nvar chain = 1;'), [],
          'the placeholder rule fires on ordinary shipped code');
      },
    },

    {
      name: 'the shell\'s unbuilt notice is authoring-only: it explains index.html when it is served, and ships nowhere (REQ-101, REQ-109)',
      run: function () {
        var p = parts();
        h.deepEqual(authoringOnlyComplaints(p.file), [], 'the artifact is not clean:\n        ' +
          authoringOnlyComplaints(p.file).join('\n        '));

        // The other half of the rule, and the half that a future edit is likelier to break: the
        // notice is still IN the template. `index.html` is the directory index a static server hands
        // out at `/` (README, "Run it"), so a person who serves the folder and opens the root gets
        // this file — and without the notice, nothing on the page says so.
        var template = h.read('index.html');
        h.ok(template.indexOf(UNBUILT_MARK) !== -1,
          'index.html no longer carries the unbuilt notice. Serving the folder and opening the root ' +
          'then gives a page that runs nothing and reports only a content-policy error');
        h.equal(count(template, REGION_OPEN), 1, 'index.html has ' + count(template, REGION_OPEN) +
          ' opening authoring-only markers, not one');
        h.equal(count(template, REGION_CLOSE), 1, 'index.html has ' + count(template, REGION_CLOSE) +
          ' closing authoring-only markers, not one — the build fails on an unpaired one rather than ' +
          'shipping the region');

        // And it would be caught, in the artifact and in the template, or the assertions above mean
        // nothing. The bare marker is checked too: it is what an unpaired region leaves behind.
        h.ok(authoringOnlyComplaints('<div id="unbuilt-notice"><h1>The template</h1></div>').length > 0,
          'the authoring-only rule did not fire on a file containing the notice');
        h.ok(authoringOnlyComplaints('<!-- ' + 'build:authoring-only' + ' -->').length > 0,
          'the authoring-only rule did not fire on a file containing a bare marker');
        h.deepEqual(authoringOnlyComplaints('<body>\n  <div id="app"></div>\n</body>'), [],
          'the authoring-only rule fires on an ordinary shell');
      },
    },
  ],
};

// A string that breaks one rule, for the non-vacuity pass.
function sampleFor(name) {
  var samples = {
    '.innerHTML': 'node.innerHTML = value;',
    '.insertAdjacentHTML': 'node.insertAdjacentHTML("beforeend", value);',
    'document.write': 'document.write("<p>hi</p>");',
    'eval(': 'eval(value);',
    'new Function': 'var f = new Function("return 1");',
    'createContextualFragment': 'range.createContextualFragment(html);',
  };
  return samples[name] || '';
}

// The build metadata in the data block, which is the app's own record of what it was built from.
function containerBuild(p) {
  var block = /<script type="application\/json" id="app-data">([\s\S]*?)<\/script>/.exec(p.markup);
  return JSON.parse(block[1]).build || {};
}
