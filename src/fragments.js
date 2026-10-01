// The declared fragment order.
//
// This file is the SINGLE SOURCE for both the build and the test harness, so the two cannot
// drift (REQ-108, REQ-808). It is the only file under src/ that is CommonJS rather than a
// browser fragment — it never enters the artifact.
//
// The order is topological: a fragment may only use names defined ABOVE it at load time.
// Function bodies may reference anything, because they are evaluated later.
//
// Source: specs/02-architecture.md §3.

'use strict';

module.exports = [
  'environment.js',
  'core/sha256.js',
  'core/serialize.js',
  'utils/id.js',
  'utils/dates.js',
  'utils/format.js',
  'core/container.js',
  'core/patch.js',
  'core/history.js',
  'core/merge.js',
  'core/verify.js',
  'model/trip.js',
  'validators/vendored.js',
  'validators/schema.js',
  'validators/ical.js',
  'validators/index.js',
  'interchange/ledger.js',
  'interchange/tripdatajson.js',
  'interchange/ical.js',
  'storage/adapter.js',
  'storage/localstorage.js',
  'storage/memory.js',
  'storage/null.js',
  'storage/registry.js',
  'io/import.js',
  'io/export.js',
  'store.js',
  'ui/render.js',
  'ui/shell.js',
  'ui/trip-list.js',
  'ui/trip-editor.js',
  'ui/itinerary-day.js',
  'ui/checklists.js',
  'ui/lodging.js',
  'ui/bookings.js',
  'ui/places.js',
  'ui/charging.js',
  'ui/budget.js',
  'ui/history.js',
  'ui/reconcile.js',
  'ui/settings-view.js',
  'ui/ai-panel.js',
  'ui/toast.js',
  'ui/modal.js',
  'ai/transport.js',
  'ai/ollama.js',
  'ai/webgpu.js',
  'ai/agent.js',
  'ai/tools.js',
  'ai/prompt.js',
  'ai/mock.js',
  'boot.js',
];

// The line the program needs before any fragment runs: the one namespace every fragment
// attaches to. It is not a fragment because it has no behaviour to order — it is the floor the
// order stands on — but it IS shared, for the same reason the order is: the artifact and the
// test harness must not disagree about what the program's first line is (REQ-108, REQ-808).
module.exports.PREAMBLE = 'var TP = {};\n';

// The pure subset the build loads to mint the initial container. It is the contiguous prefix
// of the declared order ending at the canonical model, so the build evaluates the same bytes
// the artifact will (REQ-108) rather than a parallel copy.
module.exports.BUILD_PREFIX_END = 'model/trip.js';

// Fragments that execute something at load time and therefore must not run in the test
// harness's sandbox.
module.exports.SIDE_EFFECTING = ['boot.js'];

// ---- The vendored schemas ----
//
// `PATTERN.md` §5.11 and `REQ-115`: vendor external schemas at build time and inline them, so
// validation works offline and a schema update is a deliberate act. `vendor/` holds the schemas;
// this turns them into a FRAGMENT rather than letting the build read them separately, because the
// build and the test harness must validate against the same bytes (REQ-108, REQ-808) — and the one
// way to guarantee that is for the bytes to come from one function both of them call.
//
// So there is no checked-in copy of the schemas under `src/`. A copy is a second thing to update,
// and the failure it produces is the quiet one: a reviewer reads `vendor/`, the artifact validates
// with something else.
var fs = require('fs');
var path = require('path');

var VENDOR_ROOT = path.join(__dirname, '..', 'vendor');
var VENDORED_FRAGMENT = 'validators/vendored.js';

// The files, under the names the fragment gives them. The key is the name the validators use; the
// file is the one `PROVENANCE.md` documents.
var VENDORED_FILES = {
  container: 'container-1.0.0.schema.json',
  tripData: 'trip-data-1.0.0.schema.json',
  icalendar: 'icalendar-rfc5545.json',
};

var vendoredCache = null;

function vendoredSources() {
  if (vendoredCache) return vendoredCache;
  var out = {};
  Object.keys(VENDORED_FILES).forEach(function (name) {
    var file = path.join(VENDOR_ROOT, VENDORED_FILES[name]);
    if (!fs.existsSync(file)) {
      throw new Error('Missing vendored schema: ' + VENDORED_FILES[name] +
        ' (the build inlines it, so it is required; see vendor/PROVENANCE.md)');
    }
    var text = fs.readFileSync(file, 'utf8');
    // Parsed here, not by the consumer, so a malformed schema fails at assembly rather than
    // becoming a validator that silently believes nothing.
    try {
      out[name] = JSON.parse(text);
    } catch (e) {
      throw new Error('vendor/' + VENDORED_FILES[name] + ' is not valid JSON: ' + e.message);
    }
  });
  vendoredCache = out;
  return out;
}

// The fragment's source: the vendored schemas as a literal on `TP.schemas`, which the validator
// fragments below it in the order read. JSON is a subset of JavaScript, and the two characters
// that would break that (U+2028, U+2029) are escaped rather than assumed absent.
function vendoredFragmentSource() {
  var json = JSON.stringify(vendoredSources(), null, 2);
  // JSON is a subset of JavaScript except for two line terminators, which end a line inside a
  // string literal. Written by character code rather than as escapes in this file, because a
  // literal one here is a line terminator in THIS source too.
  var separators = [String.fromCharCode(0x2028), String.fromCharCode(0x2029)];
  for (var i = 0; i < separators.length; i++) {
    json = json.split(separators[i]).join('\\u202' + (8 + i));
  }
  return '// Generated from vendor/ by src/fragments.js. Do not edit here — edit the schema and\n' +
    '// PROVENANCE.md, and both the build and the test harness pick the change up.\n' +
    'TP.schemas = ' + json + ';\n';
}

// Where a fragment's source comes from. Normal fragments are files under `src/`; the vendored one
// is generated. Both consumers call this, so neither can be the only one that knows.
function sourceOf(relative, reader) {
  if (relative === VENDORED_FRAGMENT) return vendoredFragmentSource();
  return reader(path.join('src', relative));
}

module.exports.VENDORED_FRAGMENT = VENDORED_FRAGMENT;
module.exports.VENDORED_FILES = VENDORED_FILES;
module.exports.vendoredSources = vendoredSources;
module.exports.vendoredFragmentSource = vendoredFragmentSource;
module.exports.sourceOf = sourceOf;
