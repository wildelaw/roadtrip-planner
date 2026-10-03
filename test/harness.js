// The test harness (specs/09-testing.md §1).
//
// The pattern splits cleanly in two, and the split is the test strategy:
//
//   * The model, serialization, hashing, the DAG, patches and reconciliation are testable
//     ENTIRELY, without a browser. They get no `document`, no `storage`, no `fetch`, and this
//     file loads them in a bare Node process to prove it.
//
//   * Artifact assembly, the DOM, boot, storage and gating are only testable in a real browser
//     on a real protocol. Those tests live in `browser.js` and drive Chrome.
//
// The program under test is the SAME BYTES the artifact runs: the fragments are concatenated
// from `src/fragments.js`, which is also the build's source of truth, so a test cannot pass
// against a program that differs from the one that ships (REQ-108, REQ-808).

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var fragments = require('../src/fragments.js');

var ROOT = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

// Where the pure program ends. Everything up to and including the export path is loadable
// without a DOM: the storage adapters touch `localStorage` only inside their methods, and the
// import/export paths touch `document` only when they are called.
var PURE_END = 'io/export.js';

function fragmentSources(endName) {
  var end = fragments.indexOf(endName);
  if (end === -1) throw new Error('the declared fragment order has no ' + endName);
  return fragments.slice(0, end + 1).map(function (relative) {
    return { relative: relative, source: fragments.sourceOf(relative, read) };
  });
}

// Load the pure prefix into a fresh realm.
//
// A fresh realm per call, not a shared one: a test that leaves state behind on `TP` would make
// the next one pass for the wrong reason.
//
// The program text is compiled ONCE per `end` and the compiled script is reused across realms. The
// text is the same bytes every time, so recompiling it per test buys nothing and costs a great deal:
// the prefix is a few hundred kilobytes, and a suite with forty tests would compile it forty times.
// Compiling it once also keeps the process from accumulating compiled code it will never use.
var compiled = Object.create(null);

function scriptFor(end) {
  if (!compiled[end]) {
    var sources = fragmentSources(end);
    var text = sources.map(function (f) { return f.source; }).join('\n');
    compiled[end] = { script: new vm.Script(fragments.PREAMBLE + text, { filename: 'test-prefix.js' }), sources: sources };
  }
  return compiled[end];
}

function pure(options) {
  var opts = options || {};
  var end = opts.end || PURE_END;
  var loaded = scriptFor(end);

  // `location` and `window` are provided because environment.js reads the protocol at load time
  // to decide what this file can do. That is its whole job, and it is the only part of the
  // prefix that needs them — nothing else in the prefix reads either.
  //
  // Timers are provided for a different reason: two fragments below the pure end genuinely use
  // them. The store's autosave is a 900 ms timer, and the mock transport sleeps to imitate a
  // service answering. Neither is a DOM or a network, so neither weakens the claim that the pure
  // half runs without a browser — but without them the fragments that use them cannot be loaded
  // at all, and `TP.store`'s commit boundary would be untestable. They are injectable so a test
  // can supply a clock of its own and make the timing exact rather than hoped for.
  var context = vm.createContext({
    TP: {},
    location: { protocol: opts.protocol || 'file:' },
    window: {},
    console: console,
    setTimeout: opts.setTimeout || setTimeout,
    clearTimeout: opts.clearTimeout || clearTimeout,
  });

  loaded.script.runInContext(context);
  context.__sources = loaded.sources;
  return context;
}

// The program text as the artifact carries it — the same concatenation the build performs,
// without the banners or the shell. Used by the static checks in `artifact.test.js`.
function programText() {
  return fragments.PREAMBLE + fragmentSources(fragments[fragments.length - 1]).map(function (f) {
    return f.source;
  }).join('\n');
}

// ---- Random generation ----
//
// A seeded generator, so a failure is reproducible from the seed it names. A property test that
// cannot be replayed is a rumour.

function rng(seed) {
  var s = seed >>> 0;
  return function next() {
    // xorshift32. Not a good generator for cryptography; entirely adequate for building
    // payloads and DAGs, and deterministic from a printed seed.
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

var WORDS = ['Kyoto', 'ferry', 'pass', 'Tōkyō', 'toll', 'rain', 'café', '<b>', '&', '"quoted"',
  'a'.repeat(300), '🛣️', 'line break', 'tab\there', '  padded  ', ''];

function generator(seed) {
  var next = rng(seed);
  function pick(list) { return list[Math.floor(next() * list.length)]; }
  function int(n) { return Math.floor(next() * n); }
  function word() { return pick(WORDS); }
  return { next: next, pick: pick, int: int, word: word };
}

// ---- A conforming payload ----
//
// Built from the canonical model's own constructors, then mutated — so the generator cannot
// invent a shape the model would reject. The properties under test are about round-tripping
// values, not about validity, and a generator that produced invalid shapes would test the
// normaliser instead of the thing under test.

function randomTrip(TP, gen) {
  var trip = TP.model.newTrip({ title: gen.word() || 'Trip', docId: TP.uid() });
  trip.title = gen.word() || 'Trip';
  trip.subtitle = gen.word();
  // A value for a field that a format FOLDS into a line — `day.stay`, `day.tips[]`, `keyTips[]`.
  // Inside the fold's documented limits, so that the fold is exact rather than the assertion being
  // loose: no line break, no padding, never empty. Each fold's limits are stated in the ledger.
  function foldable() { return gen.word().replace(/[\r\n]+/g, ' ').trim() || 'text'; }
  // A value for `item.link`, which a calendar carries as a `URL` property and a `URL` must be a URI
  // (`06-interchange.md` §3.2). `foldable()` is not one: the mapper declines to write a link the
  // calendar cannot honestly carry, so a generator that put a bare word here would be handing the
  // model a value no calendar can hold and then failing the round trip on it — the same trap the
  // comment on `type` below describes. `encodeURIComponent` keeps it inside the URI grammar whatever
  // `gen.word` produces, and leaves no comma, backslash or line break for the escaping to rewrite, so
  // the value is a fixed point through both wires.
  function url() { return 'https://example.invalid/' + encodeURIComponent(foldable()); }
  var dayCount = 1 + gen.int(4);
  trip.days = [];
  for (var i = 0; i < dayCount; i++) {
    var day = {
      id: TP.uid(),
      date: '2026-09-' + String(1 + i).padStart(2, '0'),
      title: gen.word(),
      drive: gen.word(),
      // A folded field's value has to respect the fold (see `foldable` above): `day.stay` becomes a
      // `Stay: …` line of the DESCRIPTION, and `day.tips[]` a `; `-joined list on a `Tips: …` line.
      // The ledger discloses each fold's limits; a conforming payload is inside them.
      stay: gen.next() < 0.4 ? foldable() : '',
      tips: gen.next() < 0.4 ? [foldable(), foldable()] : [],
      dining: gen.next() < 0.4 ? [foldable(), foldable()] : [],
      items: [],
    };
    var itemCount = gen.int(5);
    for (var j = 0; j < itemCount; j++) {
      // No `done` here: an itinerary item has no such field. It belongs to checklist items,
      // reservations and pre-trip actions, and inventing it here would test the ledger against a
      // shape the model never produces.
      //
      // No `type` either, and for a sharper reason: `item.type` is DERIVED from the flags
      // (06-interchange.md §3.2), so the wire carries none and an import recomputes it. A generator
      // that wrote `type: 'transport'` without a charge flag would be handing the model a value no
      // format can carry and then failing the round trip on it. The flags below are the truth; the
      // normaliser derives the type from them.
      //
      // `time` is the canonical `HH:MM` form and `timeRaw` the unparsed string the wire carried.
      // The pair has to AGREE or the round trip cannot be exact: the wire has one slot for both, the
      // mapper writes the raw only when it parses to the time beside it, and `item.timeRaw` is M in
      // the ledger — so an inconsistent pair is a payload that no export could ever reproduce, and
      // generating one would be testing the generator rather than the mapper.
      var item = {
        id: TP.uid(),
        title: gen.word() || 'Item',
        notes: gen.word(),
      };
      if (gen.next() < 0.7) {
        var at = gen.pick([['09:00', null], ['09:00', '9:00 AM'], ['13:30', null], ['13:30', '1:30 PM']]);
        item.time = at[0];
        if (at[1]) item.timeRaw = at[1];
      }
      if (gen.next() < 0.5) item.cost = gen.int(400);
      if (gen.next() < 0.3) item.location = gen.word();
      if (gen.next() < 0.3) item.confirmation = foldable();
      if (gen.next() < 0.3) item.link = url();
      if (gen.next() < 0.3) item.durationMin = 15 + gen.int(120);
      if (gen.next() < 0.3) item.flags = { charge: true };
      day.items.push(item);
    }
    trip.days.push(day);
  }
  // The range has to agree with the days. On the .ics side the range is DERIVED from the events, so
  // a trip whose dates name days it does not have cannot round-trip through a calendar — and a
  // generator that made one would be testing itself. (`newTrip` starts the range at today.)
  trip.startDate = trip.days[0].date;
  trip.endDate = trip.days[trip.days.length - 1].date;
  // Populated collections, so the round trip covers more than days and items. The field names are
  // the canonical ones (`03-data-model.md` §2.1). `normalizeEntity` keeps whatever keys it is
  // handed, so a generator that invented a plausible name would round-trip its invention perfectly
  // and prove nothing about the names the mappers use.
  //
  // A KeyTip is a bare string, deliberately: `trip-data.json` defines keyTips as `string[]`. Never
  // empty, though: a calendar folds the tips into one `X-WR-CALDESC` line joined by newlines and
  // splits it back on the way in, so an empty tip is the one tip a calendar cannot distinguish from
  // a separator — and a payload whose tips cannot survive a fold is not a conforming payload.
  trip.keyTips = [foldable(), foldable()];
  // Travellers, with and without an address. The two take different routes through a calendar —
  // ATTENDEE for the addressed, a name in X-TP-TRAVELERS for the rest — and a generator that
  // only ever made one kind would leave half of that fold untested.
  //
  // The two names are DISTINCT, and that is a fold limit rather than politeness: a calendar pairs an
  // address with its holder by name, so two travellers who share a name and differ in whether they
  // have one come back paired the other way round. The ledger states that limit; a conforming
  // payload is inside it, exactly as `foldable` above keeps a folded value inside its fold.
  var firstName = foldable();
  trip.travelers = [{ id: TP.uid(), name: firstName, type: 'adult' }];
  if (gen.next() < 0.6) {
    var secondName = foldable();
    while (secondName === firstName) secondName = foldable() + '·';
    trip.travelers.push({
      id: TP.uid(),
      name: secondName,
      type: gen.pick(['adult', 'child']),
      x: { iCal: { EMAIL: 'traveler@example.invalid' } },
    });
  }
  trip.lodging = [{ id: TP.uid(), location: gen.word(), checkIn: '2026-09-01', checkOut: '2026-09-03', area: gen.word(), confirmation: foldable() }];
  trip.reservations = [{ id: TP.uid(), what: gen.word(), when: gen.word(), cost: gen.int(200), done: gen.next() < 0.5 }];
  // A NACS adapter and a note, both of which the Charging panel writes. They are here because the
  // generator is what makes `interchange.test.js`'s round-trip claim mean anything: a field the
  // corpus never sets is a field the check cannot ask about.
  trip.chargingNetworks = [{ id: TP.uid(), name: gen.word(), location: gen.word(), network: gen.word(), nacsAdapter: true, notes: foldable() }];
  trip.expenses = [{ id: TP.uid(), date: '2026-09-01', category: gen.word() || 'General', amount: gen.int(300), label: gen.word() }];
  trip.criticalAlerts = [{ id: TP.uid(), severity: gen.pick(['info', 'warn', 'critical']), title: gen.word(), text: gen.word() }];
  return TP.model.normalize(trip, trip.docId);
}

// The maximally populated trip: every field the ledger names, set to a non-empty value.
//
// This is the driver for REQ-809 (the ledger is complete) and for the escaping sweep
// (REQ-805). Both need "every field", not a representative sample — the failure mode named in
// PATTERN.md §5.9 is a single missed field, which a representative sample is exactly the test
// that misses.
//
// The field names are the canonical model's (`03-data-model.md` §2.1), not a plausible-looking
// invention. That distinction is load-bearing: `normalizeEntity` keeps whatever keys it is handed,
// and the ledger covers every path beneath a declared collection, so a trip built with invented
// names (`lodging[].name` where the model has `lodging[].location`) would satisfy the completeness
// check while proving nothing about the names the mappers actually use.
//
// Bags are populated too, in both formats: REQ-205 makes them part of the model, so a sweep that
// skipped them would not be sweeping the whole model.
function maximalTrip(TP, value) {
  var v = value === undefined ? 'X' : value;
  var trip = TP.model.newTrip({ title: v, docId: TP.uid() });
  trip.subtitle = v;
  trip.currency = 'EUR';
  trip.startDate = '2026-09-01';
  // The range has to agree with the days below. On the .ics side the range is DERIVED from the
  // events, so a trip whose endDate names a day it does not have cannot round-trip through a
  // calendar — and a maximal trip that could not round-trip would be testing the generator.
  trip.endDate = '2026-09-01';
  trip.destinations = [{ id: TP.uid(), name: v, x: { tripDataJson: { destNote: v } } }];
  trip.travelers = [{ id: TP.uid(), name: v, type: 'adult', x: { iCal: { EMAIL: v } } }];
  trip.vehicle = {
    id: TP.uid(),
    model: v,
    batteryKWh: 60,
    efficiencyMilesPerKWh: 3.5,
    fullRangeMiles: 250,
    usableRangeMiles: 220,
    chargingConvention: v,
    x: { tripDataJson: { towRating: v } },
  };
  trip.x = { tripDataJson: { plannerNote: v }, iCal: { 'X-WR-TIMEZONE': v } };
  trip.days = [{
    id: TP.uid(),
    date: '2026-09-01',
    title: v,
    stay: v,
    drive: v,
    chargeStops: v,
    nacs: v,
    summary: v,
    dining: [v],
    tips: [v],
    x: { tripDataJson: { dayNote: v }, iCal: { UID: v } },
    items: [{
      id: TP.uid(),
      type: 'activity',
      title: v,
      time: '09:00',
      // `timeRaw` is the original string the wire carried, and the mapper writes it in preference
      // to the parsed time — so a maximal trip has to set the pair consistently ('09:00' with a
      // `timeRaw` of 'X' would export 'X' and come back with no parsed time at all). The pair below
      // round-trips: the wire gets '9:00 AM', and both fields come back.
      timeRaw: '9:00 AM',
      location: v,
      cost: 12,
      currency: 'EUR',
      durationMin: 45,
      confirmation: v,
      link: 'https://example.invalid/' + encodeURIComponent(v),
      notes: v,
      flags: { charge: true, overnight: true, tour: true, warn: true, minSoc: 20, minSocCritical: true },
      x: { tripDataJson: { itemNote: v }, iCal: { VALARM: v, RRULE: v } },
    }],
  }];
  trip.lodging = [{ id: TP.uid(), location: v, checkIn: '2026-09-01', checkOut: '2026-09-02', area: v, notes: v, confirmation: v }];
  trip.reservations = [{ id: TP.uid(), what: v, when: v, duration: v, cost: 5, howToBook: v, bookBy: v, priority: v, done: true }];
  trip.noReservationNeeded = [{ id: TP.uid(), what: v, notes: v }];
  trip.preTripActions = [{ id: TP.uid(), text: v, category: v, priority: v, done: true }];
  trip.bucketList = [{ id: TP.uid(), name: v, date: '2026-09-01', dateLabel: v }];
  trip.chargingNetworks = [{ id: TP.uid(), name: v, location: v, network: v, nacsAdapter: true, notes: v }];
  trip.minSocThresholds = [{ id: TP.uid(), day: v, leg: v, minSoc: 15, reason: v, severity: 'warn' }];
  trip.locations = [{
    id: TP.uid(),
    name: v,
    icon: v,
    summary: v,
    lodging: v,
    charging: [v],
    dining: [v],
    activities: [{ id: TP.uid(), title: v }],
  }];
  trip.contacts = [{ id: TP.uid(), what: v, how: v }];
  trip.criticalAlerts = [{ id: TP.uid(), severity: 'warn', title: v, text: v }];
  // A KeyTip is a bare string, deliberately: trip-data.json defines it as `string[]`, and the one
  // entity where the model follows the wire is the one entity that must not grow an id.
  trip.keyTips = [v];
  trip.checklists = [{
    id: TP.uid(),
    category: v,
    items: [{ id: TP.uid(), text: v, done: true }],
    // No bag here. A checklist has no calendar counterpart and the wire shape is
    // `{category: string[]}`, so neither mapper can produce a checklist bag — a sweep that
    // populated one would be checking the ledger against a shape the app cannot make.
  }];
  trip.budgetEstimates = [{ id: TP.uid(), category: v, item: v, cost: 10, optional: true }];
  trip.expenses = [{ id: TP.uid(), date: '2026-09-01', category: v, amount: 3, label: v, dayId: 'day-0-2026-09-01' }];
  return TP.model.normalize(trip, trip.docId);
}

// Every leaf path in a payload, as `a.b[0].c`. Used to check that the ledger classifies
// everything the model can emit, and to drive the escaping sweep over every field.
//
// Two kinds of path are deliberately NOT reported, because neither can lose anything:
//
//   * a property whose value is `undefined` — a key the normaliser left in place which does not
//     survive serialization. Reporting it would make the ledger check fail on something no
//     format can ever see.
//   * an empty container — an empty array or object holds no value, so no format can drop what
//     is not there. Where such a position is a real field the ledger names it directly
//     (`lodging[]`), and the check reads that declaration independently of this walk.
function leafPaths(value, prefix, out) {
  var paths = out || [];
  var at = prefix || '';
  if (value === undefined) return paths;
  if (Array.isArray(value)) {
    if (!value.length) return paths;
    for (var i = 0; i < value.length; i++) leafPaths(value[i], at + '[' + i + ']', paths);
    return paths;
  }
  if (value && typeof value === 'object') {
    var keys = Object.keys(value);
    if (!keys.length) return paths;
    for (var k = 0; k < keys.length; k++) leafPaths(value[keys[k]], at ? at + '.' + keys[k] : keys[k], paths);
    return paths;
  }
  paths.push(at);
  return paths;
}

// Read one leaf path back, by the same syntax `leafPaths` emits. `undefined` for a path that is not
// there — which is the value the round-trip properties are asking about, so it has to be a value
// this returns rather than something it refuses to answer.
function getPath(root, path) {
  var segments = String(path).replace(/\[(\d+)\]/g, '.$1').split('.');
  var node = root;
  for (var i = 0; i < segments.length; i++) {
    if (node === undefined || node === null) return undefined;
    node = node[segments[i]];
  }
  return node;
}

// Set one leaf path in a payload, by the same syntax `leafPaths` emits.
function setPath(root, path, value) {
  var segments = String(path).replace(/\[(\d+)\]/g, '.$1').split('.');
  var node = root;
  for (var i = 0; i < segments.length - 1; i++) {
    node = node[segments[i]];
    if (node === undefined || node === null) return false;
  }
  var last = segments[segments.length - 1];
  if (Array.isArray(node) && /^\d+$/.test(last)) { node[Number(last)] = value; return true; }
  if (typeof node === 'object') { node[last] = value; return true; }
  return false;
}

// ---- Random histories ----
//
// P6 cannot be covered by histories the app happens to create. The app creates linear histories with
// the occasional merge; the ordering property has to hold for branching DAGs, which is the only shape
// in which "neither is an ancestor of the other" is reachable.

// One small edit to a trip, of the kind a user makes. Valid because it is applied to a normalised
// payload and re-normalised: the generator must not invent a shape the model would reject, or the
// tests would be testing the normaliser instead of the DAG.
function mutate(TP, gen, payload) {
  var next = JSON.parse(JSON.stringify(payload));
  var what = gen.int(6);
  if (what === 0) {
    next.title = gen.word() || 'Trip';
  } else if (what === 1 && next.days.length) {
    var day = next.days[gen.int(next.days.length)];
    day.title = gen.word();
  } else if (what === 2) {
    next.days.push({
      id: TP.uid(),
      date: '2026-09-' + String(1 + gen.int(28)).padStart(2, '0'),
      title: gen.word(),
      items: [{ id: TP.uid(), type: 'activity', title: gen.word() || 'Item' }],
    });
  } else if (what === 3 && next.days.length) {
    var d = next.days[gen.int(next.days.length)];
    if (d.items.length) d.items.splice(gen.int(d.items.length), 1);
  } else if (what === 4 && next.days.length) {
    var dd = next.days[gen.int(next.days.length)];
    dd.items.push({ id: TP.uid(), type: 'activity', title: gen.word() || 'Item' });
  } else {
    next.bucketList = (next.bucketList || []).concat([{ id: TP.uid(), text: gen.word() }]);
  }
  return TP.model.normalize(next, next.docId);
}

// A random DAG. Returns the history, the payload at every commit, and the commit ids in order, so a
// test can check any property over the whole set rather than over the head alone.
//
// Two invariants the generator keeps, because the properties are only meaningful over DAGs that have
// them:
//
//   * EVERY commit is reachable from `history.head`. The app never writes an orphan — every commit it
//     appends extends the head — so a generator that left one would test the file against a shape the
//     app cannot produce, and make the storage properties pass or fail for an irrelevant reason.
//
//   * The two parents of a merge are INCOMPARABLE: neither is an ancestor of the other. That is what
//     "a merge has two parents" (REQ-304) means. A generator that merged a commit with its own
//     ancestor would satisfy the parent-count check while testing nothing.
//
// The shape that satisfies both is a spine with branches forked off it, each merged back. A branch
// forks from a STRICT ancestor of the spine tip, so when it is merged the two sides have diverged.
function randomHistory(TP, gen, options) {
  var opts = options || {};
  var steps = opts.steps === undefined ? 10 : opts.steps;
  var mergeChance = opts.mergeChance === undefined ? 0.2 : opts.mergeChance;
  var forkChance = opts.forkChance === undefined ? 0.35 : opts.forkChance;
  var docId = TP.uid();
  var author = { name: 'Test Person', email: 'test@example.invalid' };
  var clock = 0;
  function stamp() {
    clock++;
    return '2026-09-29T00:00:' + String(clock % 60).padStart(2, '0') + '.' + String(clock).padStart(3, '0') + 'Z';
  }

  var history = TP.history.newHistory();
  var payloadAt = Object.create(null);
  var order = [];
  var spine = [];        // the main line, root first
  var open = [];         // branch tips not yet merged, each forked from a strict ancestor of the tip
  var lastMerge = null;  // the most recent merge commit, whose parents witness a divergence

  function commit(parents, payload, message) {
    var step = TP.history.append(history, payload, {
      docId: docId, parents: parents, author: author, timestamp: stamp(), message: message,
    });
    history = step.history;
    payloadAt[step.commit.id] = payload;
    order.push(step.commit.id);
    return step.commit;
  }

  spine.push(commit([], TP.model.newTrip({ title: 'Trip', docId: docId }), 'the first commit').id);

  for (var i = 0; i < steps; i++) {
    if (open.length && gen.next() < mergeChance) {
      var tip = open.pop();
      var tail = spine[spine.length - 1];
      var merged = commit([tail, tip], mutate(TP, gen, payloadAt[tail]), 'merge ' + i);
      lastMerge = merged;
      spine.push(merged.id);
    } else if (spine.length >= 2 && gen.next() < forkChance) {
      // A strict ancestor of the tip: `gen.int(n)` returns 0..n-1, so this never picks the tip
      // itself, and the branch cannot be an ancestor-or-descendant of the tip when it is merged.
      var from = spine[gen.int(spine.length - 1)];
      var count = 1 + gen.int(3);
      for (var k = 0; k < count; k++) {
        from = commit([from], mutate(TP, gen, payloadAt[from]), 'branch ' + i + '.' + k).id;
      }
      open.push(from);
    } else {
      var prev = spine[spine.length - 1];
      spine.push(commit([prev], mutate(TP, gen, payloadAt[prev]), 'step ' + i).id);
    }
  }

  // Merge whatever is still open, so nothing is left stranded off the head.
  while (open.length) {
    var last = open.pop();
    var end = spine[spine.length - 1];
    var finalMerge = commit([end, last], mutate(TP, gen, payloadAt[end]), 'final merge');
    lastMerge = finalMerge;
    spine.push(finalMerge.id);
  }

  // The heads offered to the merge-base property. Two commits that have diverged are exactly the two
  // sides of a merge, so a merge's parents are the pair that property is about; a history with no
  // merge has only its own head to offer.
  var heads = lastMerge ? lastMerge.parents.slice() : [history.head];

  return { history: history, payloadAt: payloadAt, order: order, heads: heads, docId: docId, author: author };
}


// ---- Assertions ----

function AssertionError(message) { this.name = 'AssertionError'; this.message = message; }
AssertionError.prototype = Object.create(Error.prototype);

function ok(value, message) {
  if (!value) throw new AssertionError(message || 'expected a truthy value');
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new AssertionError((message ? message + ': ' : '') +
      'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function deepEqual(actual, expected, message) {
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  if (a !== b) {
    throw new AssertionError((message ? message + ': ' : '') +
      'expected ' + truncate(b) + ', got ' + truncate(a));
  }
}

// Payload equality, the way the model defines it: through the canonical serializer (P1,
// REQ-305), which sorts keys at every depth.
//
// `deepEqual` above is JSON.stringify, which is stricter than the model is: it also demands the
// same key INSERTION order. That is not a property of the payload — `08-security.md`'s rule and
// P1 both say key order in memory must never change a hash — and a patch cannot preserve it
// anyway. `apply` rebuilds each object from the keys of the source and appends the keys the diff
// adds, so a patched object carries the source's order, not the target's. A test that compares
// reconstructed payloads with `deepEqual` therefore fails on payloads that are equal as values,
// which is a false alarm about a field no user can see and no hash can notice.
//
// Keep `deepEqual` for shapes whose order IS the assertion (a mapper's output, a list of ops);
// use this for anything the patch engine or the history hands back.
function samePayload(TP, actual, expected, message) {
  var a = TP.canonical.serialize(actual);
  var b = TP.canonical.serialize(expected);
  if (a !== b) {
    throw new AssertionError((message ? message + ': ' : '') +
      'canonically different — expected ' + truncate(b) + ', got ' + truncate(a));
  }
}

function throws(fn, message) {
  var threw = null;
  try { fn(); } catch (e) { threw = e; }
  if (!threw) throw new AssertionError(message || 'expected the call to throw');
  return threw;
}

function truncate(s, n) {
  var limit = n || 300;
  s = String(s);
  return s.length > limit ? s.slice(0, limit) + '…(' + s.length + ' chars)' : s;
}

module.exports = {
  ROOT: ROOT,
  PURE_END: PURE_END,
  read: read,
  pure: pure,
  programText: programText,
  fragments: fragments,
  generator: generator,
  randomTrip: randomTrip,
  maximalTrip: maximalTrip,
  mutate: mutate,
  randomHistory: randomHistory,
  leafPaths: leafPaths,
  getPath: getPath,
  setPath: setPath,
  ok: ok,
  equal: equal,
  deepEqual: deepEqual,
  samePayload: samePayload,
  throws: throws,
  truncate: truncate,
  AssertionError: AssertionError,
};
