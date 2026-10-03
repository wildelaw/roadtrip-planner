// The validator cross-check (specs/09-testing.md §6, REQ-806, REQ-807, ADR-0008).
//
// "Hand-written validators, cross-checked in the test suite only against a reference implementation
// over a corpus." This file is that cross-check, and it is a SEPARATE FILE from
// `validators.test.js` for one reason: it needs a development dependency, and `PATTERN.md` §5.11
// permits development dependencies precisely here ("the test tooling, a cross-check validator") while
// forbidding them in the artifact. Keeping it separate means the rest of the validator suite runs in
// a bare checkout with no install step, and this one declares its reason and skips.
//
// REQ-807 is why it lives here and not in the app: a runtime validator dependency would be a second
// policy origin inside a file whose whole premise is that it has one.
//
// WHAT A CROSS-CHECK CAN AND CANNOT DO. It proves the hand-written subset agrees with a full
// implementation ON THE CORPUS. `ADR-0008` names the failure this leaves open: "a thin corpus ships a
// divergence with a passing test". So the corpus is not a handful of examples — it is every
// generated trip, both formats, the maximal trip, the incumbent exporter's shape, the malformed
// cases, and the schema's own boundary conditions. A divergence found by widening the corpus is the
// cross-check working, not failing.

'use strict';

var h = require('./harness.js');

// The reference implementation. `ajv` is the standard JSON Schema implementation for JavaScript, and
// it is the right oracle for two reasons: it is independent of this app, and it is the one whose
// reading of the specification a reviewer is most likely to share.
var haveAjv = true;
var Ajv2020 = null;
try {
  Ajv2020 = require('ajv/dist/2020');
} catch (e) {
  haveAjv = false;
}

module.exports = {
  name: 'schema cross-check (REQ-806)',
  // Declared, not silent: `test/run.js` prints it, so a skipped cross-check is visible rather than
  // being mistaken for one that passed.
  skip: haveAjv ? null : 'ajv is not installed — run `npm install` to enable the reference cross-check (REQ-806)',

  tests: [
    {
      name: 'the hand-written validator agrees with a full implementation over the corpus',
      run: function () {
        var TP = h.pure().TP;
        var ajv = new Ajv2020({ allErrors: false, strict: true, allowUnionTypes: true });

        // The reference is built from the SAME vendored bytes the app inlines, so a divergence can
        // only be a divergence about meaning, never about which file was read.
        var reference = {};
        Object.keys(TP.schemas).forEach(function (key) {
          if (key === 'icalendar') return;   // not JSON Schema; iCalendar is checked structurally
          reference[key] = ajv.compile(TP.schemas[key]);
        });

        var corpus = corpusOf(TP);
        var compared = 0;
        var divergences = [];

        Object.keys(reference).forEach(function (key) {
          corpus[key].forEach(function (entry, i) {
            compared++;
            var mine = TP.validators.schema.validate(TP.schemas[key], entry.value);
            var theirs = reference[key](entry.value);
            if (mine.ok === theirs) return;
            divergences.push(key + ' #' + i + ' (' + entry.label + '): the hand-written validator says ' +
              (mine.ok ? 'valid' : 'INVALID (' + TP.validators.schema.explain(mine) + ')') +
              ', the reference says ' + (theirs ? 'valid' : 'INVALID (' + ajv.errorsText(reference[key].errors) + ')'));
          });
        });

        // The floor is not decoration: agreement over six documents is agreement about six documents.
        // 09-testing.md §6, via ADR-0008: "a thin corpus ships a divergence with a passing test".
        h.ok(compared > 150, 'the corpus is large enough to be worth calling a corpus (' + compared + ' documents compared)');
        h.equal(divergences.length, 0, divergences.join('\n  '));
      },
    },
    {
      name: 'the reference rejects the malformed cases too, so agreement is not agreement on "yes"',
      run: function () {
        var TP = h.pure().TP;
        var ajv = new Ajv2020({ allErrors: false, strict: true, allowUnionTypes: true });
        var check = ajv.compile(TP.schemas.tripData);
        var malformed = malformedCorpus();
        var accepted = [];
        malformed.forEach(function (m) {
          var mine = TP.validators.check('tripdata', m.value);
          var theirs = check(m.value);
          // Both must refuse. A validator that only ever says yes agrees with everything.
          if (mine.ok) accepted.push('the hand-written validator accepted: ' + m.why);
          if (theirs) accepted.push('the reference accepted: ' + m.why);
        });
        h.equal(accepted.length, 0, accepted.join('\n  '));
      },
    },
  ],
};

// ---- The corpus ----
//
// Grouped by which schema it is a corpus FOR, because the two schemas are validated against different
// values: the trip-data wire, and the container envelope.

function corpusOf(TP) {
  var tripData = [];
  var container = [];

  for (var seed = 1; seed <= 120; seed++) {
    var gen = h.generator(seed * 104729);
    var trip = h.randomTrip(TP, gen);
    tripData.push({ label: 'generated trip seed ' + seed, value: TP.tripdatajson.fromTrip(trip) });
  }

  tripData.push({ label: 'the maximal trip', value: TP.tripdatajson.fromTrip(h.maximalTrip(TP)) });
  // The incumbent generation of the format this app exchanges, upgraded to this one — which is the
  // state the validator is legitimately asked about (`ADR-0019`, and `readTripData`'s pipeline). The
  // file as it was WRITTEN is refused by both validators, deliberately, and is exercised in
  // `validators.test.js` rather than here: it is not a malformed document, it is an older spelling of
  // a valid one, and putting it in the malformed corpus would say the wrong thing about it.
  tripData.push({ label: 'the incumbent generation, upgraded', value: TP.tripdatajson.upgrade(incumbentFixture()).value });
  tripData.push({ label: 'an empty trip', value: TP.tripdatajson.fromTrip(TP.model.newTrip({})) });
  tripData.push({ label: 'a trip with every optional field empty', value: { trip: { title: '' }, days: [] } });
  tripData.push({ label: 'a days-only root', value: { days: [] } });
  tripData.push({ label: 'a trip with unknown fields at every level', value: {
    trip: { title: 'x', unknownTripField: [1, 2] },
    days: [{ date: '2026-01-01', unknownDayField: 'keep', items: [{ activity: 'x', unknownItemField: { a: 1 } }] }],
    unknownTopLevel: true,
  } });

  malformedCorpus().forEach(function (m) { tripData.push({ label: 'malformed: ' + m.why, value: m.value }); });

  // The container envelope. Every exported artifact's data block is a container, so the corpus is
  // built the way the app builds one rather than by hand.
  for (var s = 1; s <= 20; s++) {
    var g = h.generator(s * 7919);
    container.push({ label: 'a generated document seed ' + s, value: containerFor(TP, h.randomTrip(TP, g)) });
  }
  container.push({ label: 'a container with no commits', value: TP.container.create({ trip: TP.model.newTrip({}) }) });
  container.push({ label: 'a container with a delta commit', value: containerFor(TP, h.maximalTrip(TP), { twoCommits: true }) });
  [null, 5, 'text', [], {}, { format: '1.0.0' }, { payload: {}, history: {} },
   { format: '1.0.0', payload: {}, history: {} },
   { format: 1, payload: { trip: {} }, history: { commits: [] } },
   { format: '1.0.0', payload: { trip: {} }, history: { commits: {} } },
   { format: '1.0.0', payload: { trip: {} }, history: { commits: [{ id: 'a' }] } },
  ].forEach(function (value) {
    container.push({ label: 'a malformed container ' + JSON.stringify(value) , value: value });
  });

  return { tripData: tripData, container: container };
}

// A document with a real history: two commits, so the second is a delta (or a keyframe, by the four
// rules) and the `delta` branch of the schema is exercised. `append` hands back a new history rather
// than writing into the one it was given, so the returns are threaded.
function containerFor(TP, trip, options) {
  var opts = options || {};
  var author = { name: 'A Person', email: 'a@example.invalid' };
  // The document id, because a container this app writes always has one: commits carry the registry's
  // docId and both the container schema and `verify.chain` require a non-empty string. A fixture
  // without one is a document this app could not produce, and both of them are right to refuse it.
  var docId = 'doc-crosscheck-0001';
  var root = { trip: TP.model.newTrip({ title: 'Root', docId: docId }) };
  var first = TP.history.append(null, root, { docId: docId, author: author, message: 'Root', timestamp: '2026-01-01T00:00:00.000Z' });
  var history = first.history;
  if (opts.twoCommits) {
    history = TP.history.append(history, { trip: trip }, { docId: docId, author: author, message: 'Second', timestamp: '2026-01-02T00:00:00.000Z' }).history;
  }
  return TP.container.create({ trip: trip }, { appVersion: '2.0.0', appHash: 'sha256-test', generatedAt: '2026-01-01T00:00:00.000Z' }, history);
}

// The shape `app/io.js` wrote — the incumbent generation of `trip-data.json`, reproduced from the
// exporter that wrote it and from the real file it produced
// (`test/fixtures/trip-data-generation-1.json`): numeric day ids minted by the exporter, numeric
// `chargeStops`, boolean `nacs`, free text where this generation types a number (`minSoc`,
// `nacsAdapter`), bare-name destinations and travellers, an object-map `checklists`, `done` stripped,
// prose `cost`, and no `trip.id`.
//
// As written it fails this generation's schema, and rightly so (`ADR-0019`). The corpus asks about
// `TP.tripdatajson.upgrade(...)` of it, which is what the import pipeline hands the validator.
function incumbentFixture() {
  return {
    trip: {
      title: 'Kyoto and back',
      startDate: '2026-05-01',
      endDate: '2026-05-03',
      subtitle: 'A long weekend',
      currency: 'JPY',
      destinations: ['Kyoto', 'Nara'],
      travelers: [{ name: 'Chris' }, { name: 'Robin', type: 'child' }],
      vehicle: { model: 'Model 3', batteryKWh: 75, efficiencyMilesPerKWh: 4.2, fullRangeMiles: 272, usableRangeMiles: 250, chargingConvention: 'NACS' },
    },
    days: [{
      id: 1,
      date: '2026-05-01',
      title: 'Arrive',
      stay: 'Ryokan',
      drive: '4 hours',
      chargeStops: 2,
      nacs: true,
      summary: 'A gentle first day',
      dining: ['Nishiki market', 'Izakaya'],
      tips: ['Bring cash', 'IC card for trains'],
      items: [{
        time: '9:00 AM', activity: 'Shinkansen', desc: 'Platform 4', location: 'Tokyo Station',
        cost: 13000, durationMin: 135, currency: 'JPY', confirmation: 'ABC123',
        charge: false, overnight: false, tour: false, warn: true, minSoc: '20% (charge at Nagoya)',
      }],
    }, { id: 2, date: '2026-05-02', items: [] }, { id: 3, date: '2026-05-03', items: [] }],
    lodging: [{ location: 'Ryokan', checkIn: '2026-05-01', checkOut: '2026-05-03', area: 'Gion', notes: 'Late check-in' }],
    reservations: [{ what: 'Ryokan', when: 'May 1', duration: '2 nights', cost: '¥42,000', howToBook: 'Online', bookBy: 'April', priority: 'high' }],
    noReservationNeeded: [{ what: 'Fushimi Inari', notes: 'Walk in' }],
    preTripActions: [{ text: 'Renew passport', category: 'Documents', priority: 'high' }],
    bucketList: [{ name: 'Fushimi Inari', date: '2026-05-02', dateLabel: 'Day 2' }],
    chargingNetworks: [
      { name: 'Supercharger', location: 'Kyoto', network: 'Tesla', nacsAdapter: true },
      { name: 'Various', location: 'Nara', network: 'Tesla / EA', nacsAdapter: 'Tesla SC: Yes' },
    ],
    minSocThresholds: [{ day: 'Day 2', leg: 'Kyoto to Nara', minSoc: '20%+', reason: 'Mountain pass', severity: 'warn' }],
    locations: [{
      name: 'Kyoto', icon: '⛩', summary: 'Old capital', lodging: 'Ryokan',
      charging: ['Supercharger'], dining: ['Nishiki'],
      activities: [{ name: 'Fushimi Inari', type: 'walk', desc: 'Torii gates' }],
      unknownLocationField: 'kept',
    }],
    contacts: [{ what: 'Ryokan', how: '+81 75 000 0000' }],
    criticalAlerts: [{ severity: 'high', title: 'Closed', text: 'Temple closed on Tuesdays' }],
    keyTips: ['Cash is still common', 'IC card for trains'],
    checklists: { Packing: ['Passport', 'Adapter'], Preparation: ['Vaccination'] },
    budgetEstimates: [{ category: 'Lodging', item: 'Ryokan', cost: 42000, optional: true }],
    expenses: [{ date: '2026-05-01', category: 'Food', amount: 2500, label: 'Dinner' }],
    unknownTopLevel: { kept: true },
  };
}

// The malformed cases from the hostile-input sweep (09-testing.md §4). Each names the reason it is
// malformed, so a failure reports a reason rather than a JSON blob.
function malformedCorpus() {
  return [
    { why: 'the root is a string', value: 'not a document' },
    { why: 'the root is a list', value: [1, 2, 3] },
    { why: 'days is a string', value: { trip: { title: 'x' }, days: 'nope' } },
    { why: 'days holds a string', value: { trip: { title: 'x' }, days: ['nope'] } },
    { why: 'trip.title is a number', value: { trip: { title: 5 } } },
    { why: 'trip is a list', value: { trip: [] } },
    { why: 'day.items is an object', value: { trip: { title: 'x' }, days: [{ items: {} }] } },
    { why: 'a destination is a number', value: { trip: { title: 'x', destinations: [5] } } },
    { why: 'a destination object holds a list for its name', value: { trip: { title: 'x', destinations: [{ name: [] }] } } },
    { why: 'dining is a string', value: { trip: { title: 'x' }, days: [{ dining: 'Sushi' }] } },
    { why: 'dining holds an object', value: { trip: { title: 'x' }, days: [{ dining: [{ a: 1 }] }] } },
    { why: 'checklists is a string', value: { trip: { title: 'x' }, checklists: 'Packing' } },
    { why: 'a checklist category is not a list', value: { trip: { title: 'x' }, checklists: { Packing: 'Passport' } } },
    { why: 'cost is a list', value: { trip: { title: 'x' }, days: [{ items: [{ activity: 'x', cost: [1] }] }] } },
    { why: 'durationMin is a string', value: { trip: { title: 'x' }, days: [{ items: [{ activity: 'x', durationMin: '90' }] }] } },
    // The fields this generation named. Until they were in the schema they were unknown properties,
    // which it accepts by design, so a value of any TYPE at all was fine — and these are the cases
    // that say the schema now has an opinion about them and the hand-written validator agrees.
    { why: 'a lodging confirmation is a number', value: { trip: { title: 'x' }, lodging: [{ location: 'x', confirmation: 42 }] } },
    { why: 'an item link is a number', value: { trip: { title: 'x' }, days: [{ items: [{ activity: 'x', link: 42 }] }] } },
    { why: 'a charging network note is a list', value: { trip: { title: 'x' }, chargingNetworks: [{ name: 'x', notes: ['a'] }] } },
    { why: 'keyTips holds a number', value: { trip: { title: 'x' }, keyTips: [5] } },
    { why: 'nacsAdapter is a string', value: { trip: { title: 'x' }, chargingNetworks: [{ name: 'x', nacsAdapter: 'yes' }] } },
    { why: 'an expense amount is a list', value: { trip: { title: 'x' }, expenses: [{ amount: [] }] } },
    { why: 'neither trip nor days is present', value: { something: 'else' } },
    { why: 'trip is a string', value: { trip: 'x' } },
  ];
}
