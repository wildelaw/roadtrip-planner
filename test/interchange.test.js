// The interchange layer: the ledger, and the two mappers written against it
// (specs/09-testing.md §2 P9, P10, P11; specs/06-interchange.md).
//
// The three properties are stated in the spec as three separate claims — P9 that a `trip-data.json`
// round trip is lossless, P10 that bags survive, P11 that the ledger is executable — and they reduce
// here to ONE rule that is stronger and simpler than any of them:
//
//     every leaf path of the source is UNCHANGED after the round trip, unless the ledger
//     declares that path dropped for that format
//
// "Unchanged" covers M (the same value), F (the value the fold un-folds to) and P (verbatim) at
// once, so the rule cannot be satisfied by a mapper that quietly reclassifies a field to keep a
// test green: the classification is read from `TP.ledger`, which is the same table the export
// dialog is generated from (`REQ-512`). "Unless dropped" is the disclosure obligation, and the
// second-to-last test in this file checks that the disclosure a format reports is exactly the rows
// the ledger calls dropped.
//
// P9 and P11 are the same rule over different corpora, and both are run over a generated one rather
// than over examples. A mapper is a table of field names; the failure this file exists to catch is
// the one field nobody thought of, and an example-based test is precisely the test that misses it.
//
// What this file does NOT prove is that the ledger's CLASSIFICATIONS ARE RIGHT — only that the code
// follows them (specs/09-testing.md §8 says so in as many words). A field wrongly called dropped
// passes every test here and fails only a human reading the table.

'use strict';

var h = require('./harness.js');

// How many generated trips each property runs over. The number matters less than the seed being
// printable: a failure names the trip it was found on, and `h.generator(seed)` rebuilds it.
var SEEDS = 120;
var ICAL_SEEDS = 120;

// ---- The two formats ----

function mapper(TP, format) {
  return format === 'json' ? TP.tripdatajson : TP.ical;
}

// The instant every export in this file is taken at.
//
// `DTSTAMP` is `F` in the ledger and its fold is "the export time": `TP.ical.fromTrip` synthesizes
// it from `opts.now`, defaulting to the wall clock to the SECOND (src/interchange/ical.js:
// `var d = now ? new Date(now) : new Date()`), and writes it on every VEVENT. So two exports of one
// trip are only the same bytes if they are taken in the same second, and the fixed-point properties
// below — which are about what the mapper does with the TRIP, not about what time it is — were
// intermittently failing at seed 83 whenever the import-and-re-export in between crossed a second
// boundary. Measured over the 120-seed corpus: the `DTSTAMP` lines are the ONLY difference between
// two exports of one trip, and with the clock held still the wire fixed point holds on all 120.
//
// Pinning it is what makes the property the property it claims to be. The clock is not the thing
// under test here, and a test that depends on the wall clock is a test that fails on Tuesdays. That
// the mapper still reads a real clock when it is not handed one is covered by the `DTSTAMP` test
// further down this file, so pinning here hides nothing.
var EXPORT_TIME = '2026-01-01T00:00:00Z';

function wireOf(TP, format, trip) {
  var out = mapper(TP, format).fromTrip(trip, { now: EXPORT_TIME });
  return format === 'json' ? out : out.text;
}

// The wire as TEXT, for the fixed-point comparison: two exports of the same trip must produce the
// same bytes, and for `trip-data.json` that means the serialized form rather than the object.
function wireText(TP, format, wire) {
  return format === 'json' ? JSON.stringify(wire) : String(wire);
}

function tripOf(TP, format, wire) {
  // Cloned first: the JSON mapper is handed an object, and a mapper that mutated its input would
  // make the fixed-point assertions compare a value against a value it had already changed.
  return mapper(TP, format).toTrip(format === 'json' ? TP.model.clone(wire) : wire);
}

// ---- Comparing two payloads ----

// Every leaf path present on either side whose value differs. Leaves only: a container that appears
// or disappears whole is reported through its members, so every row in the report is a value a
// person could point at in the UI. (Comparing containers instead reports `x` and `flags` as
// differing the moment either side has one, which says nothing about what was lost.)
function differences(before, after) {
  var paths = h.leafPaths(before).concat(h.leafPaths(after));
  var seen = Object.create(null);
  var out = [];
  for (var i = 0; i < paths.length; i++) {
    var p = paths[i];
    if (seen[p]) continue;
    seen[p] = true;
    var a = h.getPath(before, p);
    var b = h.getPath(after, p);
    if (a !== b) out.push({ path: p, before: a, after: b, kind: null });
  }
  for (var j = 0; j < out.length; j++) out[j].kind = null;
  return out;
}

// The differences the ledger does NOT account for. The kind is filled in here rather than inside
// `differences` so that one function answers "what changed" and the ledger answers "is that
// allowed" — a single place where the two meet, and the place the failure message reports from.
function undeclared(TP, format, before, after) {
  var list = differences(before, after);
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var kind = TP.ledger.kindOf(list[i].path, format);
    list[i].kind = kind;
    if (kind !== TP.ledger.DROPPED) out.push(list[i]);
  }
  return out;
}

// A description of how two wires differ, for the failure message.
//
// For `trip-data.json` the wire is an object and `differences` describes it path by path. For
// iCalendar the wire is TEXT, and `differences` is useless on it: `h.leafPaths('a string')` is one
// nameless path, `h.getPath(text, '')` reads back `undefined` on both sides, and so every textual
// difference reported as the empty string. That is how the `DTSTAMP` flake above presented itself —
// as `seed 83: ` with nothing after it, twice, on an intermittent failure, which is precisely the
// shape of failure nobody can act on. So a text wire is compared line by line, and the report names
// the line numbers and both values.
function wireDifference(before, after) {
  var a = String(before).split('\r\n');
  var b = String(after).split('\r\n');
  var out = [];
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    out.push('line ' + (i + 1) + ': ' + h.truncate(JSON.stringify(a[i] === undefined ? null : a[i]), 60) +
      ' -> ' + h.truncate(JSON.stringify(b[i] === undefined ? null : b[i]), 60));
    if (out.length === 8) break;
  }
  return out.join('\n        ');
}

function describe(list) {
  return list.slice(0, 8).map(function (d) {
    return d.path + ' [' + d.kind + '] ' + h.truncate(JSON.stringify(d.before), 60) +
      ' -> ' + h.truncate(JSON.stringify(d.after), 60);
  }).join('\n        ');
}

// ---- The corpora ----

function randomTrips(TP, count) {
  var trips = [];
  for (var seed = 1; seed <= count; seed++) trips.push(h.randomTrip(TP, h.generator(seed)));
  return trips;
}

// ---- A calendar from somewhere else ----
//
// Not one this app wrote. It carries the properties the mappers have no field for — a VALARM, an
// RRULE, an ORGANIZER, a SEQUENCE, a GEO — on both a day event and an item event, and UIDs of its
// own, because that is what a calendar from a real client looks like and those UIDs are the case
// the bag exists for (REQ-515).
var FOREIGN_ICAL = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Example Corp//NONSGML CalDAV Client//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-TIMEZONE:America/Los_Angeles',
  'BEGIN:VEVENT',
  'UID:9f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8@example.invalid',
  'DTSTAMP:20260801T120000Z',
  'DTSTART;VALUE=DATE:20260901',
  'DTEND;VALUE=DATE:20260902',
  'SUMMARY:Arrival',
  'DESCRIPTION:Long drive up the coast',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Reminder',
  'TRIGGER:-PT30M',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:aa11bb22-cc33-dd44-ee55-ff6677889900@example.invalid',
  'DTSTAMP:20260801T120000Z',
  'DTSTART:20260901T090000',
  'DTEND:20260901T103000',
  'SUMMARY:Ferry crossing',
  'LOCATION:Mukilteo',
  'DESCRIPTION:Confirmation: ABC123\\nBring the printed ticket',
  'ORGANIZER;CN=Terminal:mailto:ops@example.invalid',
  'ATTENDEE;CN=Ada;PARTSTAT=ACCEPTED:mailto:ada@example.invalid',
  'RRULE:FREQ=WEEKLY;COUNT=3',
  'SEQUENCE:2',
  'STATUS:CONFIRMED',
  'GEO:47.9497;-122.3035',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n') + '\r\n';

// A `trip-data.json` from somewhere else — the app's own format, written by hand or by the AI
// agent, with a field this app has no model for.
var FOREIGN_TRIPDATA = {
  trip: {
    title: 'Coastal run',
    currency: 'USD',
    plannerNote: 'booked the ferry in March',
  },
  days: [
    {
      date: '2026-09-01',
      title: 'Arrival',
      stay: 'Mukilteo Inn',
      customLegNote: 'toll bridge',
      items: [
        { activity: 'Ferry crossing', time: '09:00', tour: true, vendorCode: 'V-9' },
      ],
    },
  ],
  budget: { total: 1200 },
};

// ---- Tests ----

module.exports = {
  name: 'interchange',

  tests: [
    {
      // P9 (REQ-504, REQ-513). The wire fixed point: exporting what you just imported produces the
      // same bytes. It is the property a mapper written field-by-field fails quietly — one field
      // read but never written back, or written under a different name, shows up here as a diff on
      // the second export and nowhere else.
      name: 'P9: a trip-data.json round trip is a fixed point on the wire',
      run: function () {
        var TP = h.pure().TP;
        var trips = randomTrips(TP, SEEDS);
        var checked = 0;
        var failures = [];
        trips.forEach(function (trip, i) {
          var wire = wireOf(TP, 'json', trip);
          h.ok(wire && typeof wire === 'object', 'seed ' + (i + 1) + ': the export produced no wire');
          var again = wireOf(TP, 'json', tripOf(TP, 'json', wire));
          checked += h.leafPaths(wire).length;
          if (wireText(TP, 'json', again) !== wireText(TP, 'json', wire)) {
            var diffs = differences(wire, again);
            failures.push('seed ' + (i + 1) + ': ' + describe(diffs));
          }
        });
        // Non-vacuity. A mapper that exported nothing would be a perfect fixed point.
        h.ok(checked > 5000, 'the corpus compared only ' + checked + ' wire paths; it is not exercising the mapper');
        h.equal(failures.length, 0, failures.length + ' of ' + trips.length +
          ' trips are not a fixed point through trip-data.json:\n        ' + failures.slice(0, 4).join('\n        '));
      },
    },

    {
      // P9 (REQ-504). The loss property, over the same corpus: every leaf path the source had is
      // either exactly what it was, or a path the ledger declares dropped for this format.
      name: 'P9: every leaf path survives trip-data.json, or the ledger declares it dropped',
      run: function () {
        var TP = h.pure().TP;
        var trips = randomTrips(TP, SEEDS);
        var paths = 0;
        var dropped = 0;
        var failures = [];
        trips.forEach(function (trip, i) {
          var back = tripOf(TP, 'json', wireOf(TP, 'json', trip));
          var diffs = differences(trip, back);
          paths += h.leafPaths(trip).length;
          var bad = undeclared(TP, 'json', trip, back);
          diffs.forEach(function (d) { if (TP.ledger.kindOf(d.path, 'json') === TP.ledger.DROPPED) dropped++; });
          if (bad.length) failures.push('seed ' + (i + 1) + ': ' + describe(bad));
        });
        h.ok(paths > 5000, 'the corpus held only ' + paths + ' leaf paths; it is not exercising the model');
        // And the declared losses are not an empty set being checked against nothing: `trip.docId`
        // is dropped by this format and does differ, which is what makes the rule above a rule.
        h.ok(dropped > 0, 'no path was dropped at all, so "declared dropped" was never tested');
        h.equal(failures.length, 0, failures.length + ' of ' + trips.length +
          ' trips lost something trip-data.json does not declare:\n        ' + failures.slice(0, 4).join('\n        '));
      },
    },

    {
      // P11 (REQ-809). The same rule for the calendar, plus the two fixed points. The calendar's is
      // the harder mapper by a long way — it folds, it synthesizes UIDs and DTSTAMPs, it drops whole
      // collections — so a failure here is the more interesting one.
      name: 'P11: iCalendar keeps what the ledger calls kept, and is a fixed point on the wire and in the model',
      run: function () {
        var TP = h.pure().TP;
        var trips = randomTrips(TP, ICAL_SEEDS);
        var paths = 0;
        var wireFailures = [];
        var modelFailures = [];
        var lossFailures = [];

        trips.forEach(function (trip, i) {
          var seed = i + 1;
          var wire = wireOf(TP, 'ical', trip);
          var back = tripOf(TP, 'ical', wire);
          paths += h.leafPaths(trip).length;

          // The wire fixed point: exporting the imported trip again gives the same file.
          var again = wireOf(TP, 'ical', back);
          if (again !== wire) wireFailures.push('seed ' + seed + ':\n        ' + wireDifference(wire, again));

          // And the model fixed point: a second round trip changes nothing more. This is the
          // property that catches a mapper whose output is stable but whose import is not — an
          // import that mints a fresh id every time passes a wire comparison and fails this one.
          var back2 = tripOf(TP, 'ical', again);
          if (JSON.stringify(back2) !== JSON.stringify(back)) {
            modelFailures.push('seed ' + seed + ': ' + describe(differences(back, back2)));
          }

          var bad = undeclared(TP, 'ical', trip, back);
          if (bad.length) lossFailures.push('seed ' + seed + ': ' + describe(bad));
        });

        h.ok(paths > 5000, 'the corpus held only ' + paths + ' leaf paths; it is not exercising the model');
        h.equal(wireFailures.length, 0, wireFailures.length + ' of ' + trips.length +
          ' calendars are not a fixed point on the wire:\n        ' + wireFailures.slice(0, 3).join('\n        '));
        h.equal(modelFailures.length, 0, modelFailures.length + ' of ' + trips.length +
          ' calendars are not a fixed point in the model:\n        ' + modelFailures.slice(0, 3).join('\n        '));
        h.equal(lossFailures.length, 0, lossFailures.length + ' of ' + trips.length +
          ' calendars lost something iCalendar does not declare:\n        ' + lossFailures.slice(0, 3).join('\n        '));
      },
    },

    {
      // The same property over the trip that populates EVERY field the ledger names, which the
      // random corpus does not: `randomTrip` makes a conforming but modest trip, and a field no
      // generated trip ever sets is a field this file would otherwise never test. `maximalTrip` is
      // the same generator the completeness check uses, so a field added to the model is picked up
      // by both or by neither.
      name: 'P9 and P11: the same rule holds for a trip with every field populated',
      run: function () {
        var TP = h.pure().TP;
        var trip = h.maximalTrip(TP, 'X');
        h.ok(h.leafPaths(trip).length > 100, 'the maximal trip has only ' + h.leafPaths(trip).length + ' leaf paths');

        var report = [];
        ['json', 'ical'].forEach(function (format) {
          var back = tripOf(TP, format, wireOf(TP, format, trip));
          var bad = undeclared(TP, format, trip, back);
          if (bad.length) report.push(format + ': ' + describe(bad));
        });
        h.equal(report.length, 0, 'the maximal trip lost something the ledger does not declare:\n        ' +
          report.join('\n        '));
      },
    },

    {
      // ADR-0019. The incumbent generation of `trip-data.json`, which is the format this app already
      // exchanged with itself. Two things have to hold, and neither implies the other:
      //
      //   * nothing the file carried is LOST on the way in — the reason this is a test in THIS file
      //     rather than only in `validators.test.js`. The generation's `minSoc` and `nacsAdapter`
      //     values have no type in this generation, so the naive reading drops them silently: the
      //     mapper's `numOrUndef("100%")` is `undefined`, and the field is one the key table names, so
      //     `copyUnknown` passes over it too. The fixture is the real file's shapes, and the count of
      //     items that carried a `minSoc` is asserted rather than assumed.
      //
      //   * exporting it again is a FIXED POINT. After one import the file is this generation's, so
      //     the ordinary P9 property applies from there on — and it is what proves the `…Raw` bag
      //     members written back beside their numeric/boolean fields are exactly what a re-import
      //     reads, rather than a second spelling that accumulates.
      name: 'P9 (ADR-0019): a generation-1 trip-data.json imports without loss and is a fixed point from there on',
      run: function () {
        var TP = h.pure().TP;
        var raw = JSON.parse(h.read('test/fixtures/trip-data-generation-1.json'));

        // What the file carried, counted from the file itself: a hand-written expectation would go
        // stale the moment the fixture changed, and would not be evidence about the real file anyway.
        var carried = { itemMinSoc: 0, networkText: 0 };
        raw.days.forEach(function (d) {
          (d.items || []).forEach(function (it) { if (typeof it.minSoc === 'string') carried.itemMinSoc++; });
        });
        raw.chargingNetworks.forEach(function (n) { if (typeof n.nacsAdapter === 'string') carried.networkText++; });
        h.ok(carried.itemMinSoc > 0 && carried.networkText > 0,
          'the fixture carries no divergent value to begin with, so this test would pass on nothing');

        var up = TP.tripdatajson.upgrade(raw);
        h.equal(up.from, TP.tripdatajson.PREVIOUS_GENERATION, 'the fixture was not recognised as the previous generation');
        var trip = TP.model.normalize(TP.tripdatajson.toTrip(TP.model.clone(up.value)));

        // The generation's own spellings, in the model's terms.
        raw.days.forEach(function (d, i) {
          h.equal(trip.days[i].id, String(d.id), 'day ' + i + ' kept the number the file wrote as its id');
          h.equal(trip.days[i].chargeStops, String(d.chargeStops), 'day ' + i + ' did not take the file’s chargeStops');
        });
        raw.days.forEach(function (d, i) {
          if (d.nacs === true) h.equal(trip.days[i].nacs, 'NACS', 'a true nacs did not become the text the incumbent UI rendered');
          else if (d.nacs === false) h.equal(trip.days[i].nacs, '', 'a false nacs did not become absent');
        });

        // Nothing the file carried as prose is gone. It is in the bag — the same place a non-numeric
        // `cost` goes — so the person who wrote "54% — FLOOR for the day" still has it.
        var itemRaw = 0;
        var networkRaw = 0;
        trip.days.forEach(function (d, i) {
          d.items.forEach(function (it, j) {
            var src = raw.days[i].items[j];
            if (typeof (src && src.minSoc) === 'string') {
              var bag = TP.model.bag(it, 'tripDataJson');
              h.equal(bag && bag.minSocRaw, src.minSoc, 'the minSoc text of day ' + i + ' item ' + j + ' was not kept');
              h.equal(it.flags && it.flags.minSoc, undefined, 'a minSoc this generation cannot read was left as a number');
              itemRaw++;
            }
          });
        });
        trip.chargingNetworks.forEach(function (n, i) {
          var src = raw.chargingNetworks[i];
          if (typeof (src && src.nacsAdapter) === 'string' && !/^(true|false)$/i.test(src.nacsAdapter)) {
            h.equal(TP.model.bag(n, 'tripDataJson').nacsAdapterRaw, src.nacsAdapter, 'the nacsAdapter text of network ' + i + ' was not kept');
            networkRaw++;
          }
        });
        trip.minSocThresholds.forEach(function (t, i) {
          var src = raw.minSocThresholds[i];
          if (typeof (src && src.minSoc) === 'string') {
            h.equal(TP.model.bag(t, 'tripDataJson').minSocRaw, src.minSoc, 'the minSoc text of threshold ' + i + ' was not kept');
          }
        });
        h.equal(itemRaw, carried.itemMinSoc, 'the test counted ' + itemRaw + ' kept item values against ' + carried.itemMinSoc + ' in the file');
        h.equal(networkRaw, carried.networkText, 'the test counted ' + networkRaw + ' kept network values against ' + carried.networkText + ' in the file');

        // The fixed point, and the non-vacuity floor under it: a mapper that exported nothing at all
        // would be a perfect fixed point.
        var wire = wireOf(TP, 'json', trip);
        var again = wireOf(TP, 'json', tripOf(TP, 'json', wire));
        var leaves = h.leafPaths(wire).length;
        h.ok(leaves > 100, 'the generation-1 wire held only ' + leaves + ' leaf paths; the comparison is not exercising the mapper');
        if (wireText(TP, 'json', again) !== wireText(TP, 'json', wire)) {
          h.equal(describe(differences(wire, again)), '', 'the generation-1 import is not a fixed point on the wire');
        }

        // And the ordinary property from here on: the imported trip loses nothing the ledger does not
        // declare. `undeclared` reads the classification from the ledger, so a `…Raw` member that this
        // file forgot to write back would be reported as an undeclared loss rather than passing.
        var back = tripOf(TP, 'json', wire);
        var bad = undeclared(TP, 'json', trip, back);
        h.equal(bad.length, 0, 'the generation-1 import lost something the ledger does not declare: ' + describe(bad));
      },
    },

    {
      // REQ-512. The disclosure the export dialog shows is generated from the same table the
      // mappers are written against, so the two cannot drift. This is the test that makes that
      // sentence true rather than aspirational: it compares the three views of the same fact.
      name: 'the disclosure, the ledger and the mapper agree on what a format cannot carry',
      run: function () {
        var TP = h.pure().TP;
        ['json', 'ical'].forEach(function (format) {
          var expected = TP.ledger.forFormat(format)
            .filter(function (row) { return row.kind === TP.ledger.DROPPED; })
            .map(function (row) { return { field: row.field, note: row.note }; });
          var losses = mapper(TP, format).losses();
          h.deepEqual(losses, expected, format + ': the mapper reports a different loss list from the ledger');
          h.ok(expected.length > 0, format + ': the ledger declares nothing dropped for this format');
        });

        // And the dialog reads the mapper, not the ledger directly, so that is the pairing a user
        // actually sees.
        h.deepEqual(TP.io.export.disclosures('ical').items, TP.ical.losses(),
          'the .ics disclosure is not the ledger’s dropped list');
        h.deepEqual(TP.io.export.disclosures('tripdata').items, TP.tripdatajson.losses(),
          'the trip-data.json disclosure is not the ledger’s dropped list');

        // The sentence is shown before the file is written, so it has to say something.
        var text = TP.io.export.disclosures('ical').text;
        h.ok(text.indexOf('cannot carry') !== -1 && text.length > 100,
          'the .ics disclosure says nothing about what is lost: ' + h.truncate(text, 120));
      },
    },

    {
      // REQ-211. The document id is not trip content, and an export that carried it would let two
      // copies of one trip collide on re-import — which is a corruption the user cannot see.
      name: 'REQ-211: the document id is never written to either wire',
      run: function () {
        var TP = h.pure().TP;
        var marker = 'docid-marker-2f7c1e';
        var trip = h.maximalTrip(TP, 'X');
        trip.docId = marker;

        h.equal(wireText(TP, 'json', wireOf(TP, 'json', trip)).indexOf(marker), -1,
          'the document id reached the trip-data.json wire');
        h.equal(wireOf(TP, 'ical', trip).indexOf(marker), -1,
          'the document id reached the calendar');
        // Non-vacuity: the marker is a value the export really does hold, so its absence means
        // something. The trip's id IS exported (it is the trip's identity, not the document's).
        trip.id = marker;
        h.ok(wireText(TP, 'json', wireOf(TP, 'json', trip)).indexOf(marker) !== -1,
          'the trip id did not reach the wire either, so the check above proves nothing');
      },
    },

    {
      // The one thing the fixed-point properties above deliberately hold still, tested here so that
      // holding it still hides nothing (`EXPORT_TIME`, at the top of this file).
      //
      // `DTSTAMP` is the export time, and RFC 5545 wants a UTC stamp to the second on every VEVENT.
      // Two claims: handed an instant, the mapper writes exactly that instant on every event; handed
      // none, it reads a real clock and writes a stamp in the right shape. Without the second claim a
      // mapper that stopped writing DTSTAMP at all — or wrote a constant one — would pass the whole
      // file, and without the first the pinning above would be untested magic.
      name: 'DTSTAMP is the export time: the given instant, or a well-formed now',
      run: function () {
        var TP = h.pure().TP;
        // Two fixtures, because neither alone asks the question: `maximalTrip` populates every FIELD
        // but is one day with one item (two events), and a generated trip has several of each. The
        // point of the pair is that a stamp appears on EVERY event, so the corpus has to have more
        // than one.
        var trips = [h.maximalTrip(TP, 'X'), h.randomTrip(TP, h.generator(1))];

        var stamps = function (text) {
          return String(text).split('\r\n').filter(function (l) { return /^DTSTAMP:/.test(l); });
        };
        var eventsOf = function (trip) {
          return (trip.days || []).reduce(function (n, d) { return n + 1 + (d.items || []).length; }, 0);
        };
        var total = trips.reduce(function (n, t) { return n + eventsOf(t); }, 0);
        h.ok(total >= 5, 'the corpus holds only ' + total + ' events, too few to test a stamp on every one');

        trips.forEach(function (trip, i) {
          var events = eventsOf(trip);
          var where = 'trip ' + i + ' (' + events + ' events)';

          var pinned = stamps(TP.ical.fromTrip(trip, { now: '2026-03-04T05:06:07Z' }).text);
          h.equal(pinned.length, events, where + ': not every event carries a DTSTAMP');
          pinned.forEach(function (l) {
            h.equal(l, 'DTSTAMP:20260304T050607Z', where + ': the export ignored the instant it was given');
          });

          // The default: no `now`, so the clock is read. The bound is generous — a second of slop
          // either side — because the claim is "the export time", not "the export time to the
          // microsecond", and a test that asserted the latter would be the wall-clock flake again.
          var before = Date.now();
          var live = stamps(TP.ical.fromTrip(trip).text);
          var after = Date.now();
          h.equal(live.length, events, where + ': not every event carries a DTSTAMP when the clock is read');
          live.forEach(function (l) {
            var m = /^DTSTAMP:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(l);
            h.ok(m, where + ': the synthesized stamp is not a UTC date-time: ' + l);
            var at = Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z');
            h.ok(at >= before - 1000 && at <= after + 1000,
              where + ': the synthesized stamp is not the export time: ' + l + ' against ' +
              new Date(before).toISOString() + ' … ' + new Date(after).toISOString());
          });
        });
      },
    },

    {
      // REQ-504 + REQ-809, over a file this app did not write. `trip.startDate` is **M** for
      // `trip-data.json` in the ledger, and M is a promise: the path round-trips. The trip-level
      // dates used to be read with `isoOrNull` and nothing else, so a hand-written `"May 1, 2026"` —
      // which the schema accepts, since it says `nullableString` and no `format` — came back as no
      // date at all: a silent deletion of a field the app's own disclosure says it keeps.
      //
      // The asymmetry is deliberate and is checked here too: a day's date is structural (it is that
      // day's `DTSTART`), so an unreadable one is NOT kept as text — the export would then write a
      // malformed date. Days get an ISO date or none, trips get their own words back.
      name: 'REQ-504: a hand-written trip date survives, and a day date is never kept as text',
      run: function () {
        var TP = h.pure().TP;
        var kinds = ['startDate', 'endDate'].map(function (f) { return TP.ledger.kindOf(f, 'json'); });
        h.deepEqual(kinds, [TP.ledger.MAPPED, TP.ledger.MAPPED],
          'this test asserts the ledger says these dates are Mapped, and it no longer does');

        var wire = {
          trip: { title: 'From somewhere else', startDate: 'May 1, 2026', endDate: '2026/05/03' },
          days: [{ title: 'a day with no readable date', date: 'the second of May', items: [] }],
        };
        h.ok(TP.validators.check('tripdata', wire).ok, 'the fixture is not a file this app accepts');

        var back = TP.tripdatajson.fromTrip(TP.tripdatajson.toTrip(TP.model.clone(wire)));
        h.equal(back.trip.startDate, 'May 1, 2026', 'the trip start date was not kept as written');
        h.equal(back.trip.endDate, '2026/05/03', 'the trip end date was not kept as written');
        h.equal(back.days[0].date, undefined,
          'a day kept an unreadable date as text, which the calendar export would write as a DTSTART');

        // And the ISO path is unchanged: a timestamp is still read down to its date, and a real date
        // still derives the days beneath it. Without this half the test would pass for a mapper that
        // simply stopped interpreting dates at all.
        var iso = TP.tripdatajson.toTrip({ trip: { title: 'x', startDate: '2026-05-01T09:30:00Z', endDate: '2026-05-02' }, days: [] });
        h.equal(iso.startDate, '2026-05-01', 'an ISO timestamp is no longer read down to its date');
        h.deepEqual((iso.days || []).map(function (d) { return d.date; }), ['2026-05-01', '2026-05-02'],
          'the days were not derived from the trip dates');
      },
    },

    {
      // `trip.id`, `day.id` and `item.id` come back through the UID this app derives, which means
      // they come back through RFC 5545 TEXT escaping — and an id is allowed to contain the
      // characters that escaping is for. `trip-data.json` imposes no such restriction, so an id with
      // a comma in it is a file this app can be handed, and the calendar has to give it back as it
      // was rather than as it was escaped.
      name: 'an id that needs escaping survives a calendar unchanged',
      run: function () {
        var TP = h.pure().TP;
        var wire = {
          trip: { id: 'trip,one;2', title: 'Awkward ids', currency: 'USD' },
          days: [{
            id: 'day,one\\two',
            date: '2026-09-01',
            title: 'Arrival',
            items: [{ id: 'item,one', activity: 'Ferry', time: '09:00' }],
          }],
        };
        var trip = TP.tripdatajson.toTrip(wire);
        h.equal(trip.id, 'trip,one;2', 'the id was already mangled by the trip-data.json mapper');

        var text = TP.ical.fromTrip(trip).text;
        h.ok(text.indexOf('UID:trip\\,one\\;2/day\\,one\\\\two@trip-planner.invalid') !== -1,
          'the UID was not escaped for the calendar:\n        ' +
          text.split('\r\n').filter(function (l) { return l.indexOf('UID') === 0; }).join('\n        '));

        var back = TP.ical.toTrip(text);
        h.equal(back.id, 'trip,one;2', 'the trip id came back escaped');
        h.equal(back.days[0].id, 'day,one\\two', 'the day id came back escaped');
        h.equal(back.days[0].items[0].id, 'item,one', 'the item id came back escaped');

        // And the id is read back as OURS, so no UID is bagged for an event this app wrote — the
        // difference between reading it wrong and reading it right, visible in the model.
        h.equal(back.days[0].x, undefined, 'a UID this app wrote was kept as though it were foreign');
      },
    },

    {
      // P10 (REQ-205, REQ-515). A bag survives every export/import pair. The pair that matters is
      // the CROSSED one — an unmodelled calendar property has to survive a trip through
      // `trip-data.json`, a format that has no concept of a VALARM, because that is what exporting
      // "everything" and then continuing to work in the app actually does.
      name: 'P10: bags survive a round trip through the other format',
      run: function () {
        var TP = h.pure().TP;

        // A calendar from elsewhere, read in.
        var inTrip = TP.ical.toTrip(FOREIGN_ICAL);
        h.equal(inTrip.x.iCal['X-WR-TIMEZONE'], 'America/Los_Angeles',
          'an unmodelled calendar property did not reach the trip bag');
        var item = inTrip.days[0].items[0];
        h.ok(item, 'the foreign calendar produced no item');
        var bag = TP.model.bag(item, 'iCal');
        h.ok(bag, 'the foreign item produced no bag at all');
        ['RRULE', 'ORGANIZER', 'SEQUENCE', 'STATUS', 'GEO'].forEach(function (name) {
          h.ok(bag[name] !== undefined, name + ' was not preserved on the item');
        });
        // The VALARM was on the day event, and stays on the day: a bag is keyed to the entity it
        // came from, and moving one to the other entity would be interpretation.
        h.ok(TP.model.bag(inTrip.days[0], 'iCal').VALARM !== undefined,
          'the VALARM was not preserved on the day it was on');
        // The ORGANIZER arrived with a parameter, which is stored in its serialized form so that
        // writing it back is a copy rather than a re-serialization.
        h.ok(String(bag.ORGANIZER).indexOf('CN=Terminal') !== -1,
          'the ORGANIZER lost its CN parameter: ' + h.truncate(bag.ORGANIZER, 80));
        // The day event had a UID of its own, so the day keeps it (it is not one this app derives).
        h.ok(inTrip.days[0].x && inTrip.days[0].x.iCal && inTrip.days[0].x.iCal.UID,
          'a foreign day UID was not preserved');

        // Through `trip-data.json` and back. The calendar bag has no home in that format — it rides
        // in the carrier (`TP.model.carryOut`) — and if it did not, every VALARM in the file would
        // be gone after one export.
        var viaJson = TP.tripdatajson.toTrip(TP.tripdatajson.fromTrip(inTrip));
        var item2 = viaJson.days[0].items[0];
        h.deepEqual(TP.model.bag(item2, 'iCal'), bag,
          'the item bag did not survive trip-data.json');
        h.equal(viaJson.x.iCal['X-WR-TIMEZONE'], 'America/Los_Angeles',
          'the trip bag did not survive trip-data.json');
        h.ok(viaJson.days[0].x.iCal.UID, 'the day UID did not survive trip-data.json');

        // And out to a calendar again: the properties are back on a real event, with the file's own
        // UIDs rather than ones this app would have derived.
        var text = TP.ical.fromTrip(viaJson).text;
        ['VALARM', 'RRULE', 'ORGANIZER', 'SEQUENCE', 'STATUS', 'GEO',
          'X-WR-TIMEZONE:America/Los_Angeles',
          'UID:9f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8@example.invalid',
          'UID:aa11bb22-cc33-dd44-ee55-ff6677889900@example.invalid'].forEach(function (line) {
          h.ok(text.indexOf(line) !== -1, 'the re-exported calendar has no ' + line);
        });

        // The other direction: a trip-data.json field the model does not name rides on the entity it
        // came from (REQ-504), so an import of a file written by hand — or by the AI agent — loses
        // nothing it did not name.
        var fromJson = TP.tripdatajson.toTrip(FOREIGN_TRIPDATA);
        h.equal(TP.model.bag(fromJson, 'tripDataJson').plannerNote, 'booked the ferry in March',
          'an unmodelled trip-data.json field did not reach the trip bag');
        h.equal(TP.model.bag(fromJson.days[0], 'tripDataJson').customLegNote, 'toll bridge',
          'an unmodelled day field did not reach the day bag');
        h.equal(TP.model.bag(fromJson.days[0].items[0], 'tripDataJson').vendorCode, 'V-9',
          'an unmodelled item field did not reach the item bag');

        // And through the calendar, where those three bags are LOST — a JSON bag has no home in a
        // calendar, and that is what the ledger's iCalendar column says for each of them. The point
        // of asserting the loss rather than the preservation is that the disclosure and the code have
        // to agree: a test that expected the bag back would be expecting the app to do something the
        // dialog it shows the user says it does not.
        ['x.tripDataJson', 'days[0].x.tripDataJson', 'days[0].items[0].x.tripDataJson'].forEach(function (p) {
          h.equal(TP.ledger.kindOf(p, 'ical'), TP.ledger.DROPPED, p + ' is not disclosed as dropped on .ics');
        });
        var viaIcal = TP.ical.toTrip(TP.ical.fromTrip(fromJson).text);
        h.equal(TP.model.bag(viaIcal, 'tripDataJson'), null, 'a trip JSON bag survived a calendar');
        h.equal(TP.model.bag(viaIcal.days[0], 'tripDataJson'), null, 'a day JSON bag survived a calendar');
        h.equal(TP.model.bag(viaIcal.days[0].items[0], 'tripDataJson'), null, 'an item JSON bag survived a calendar');
        // What the calendar CAN carry from that trip, it does: the loss above is the bag, not the trip.
        h.equal(viaIcal.days[0].title, 'Arrival', 'the day did not survive the calendar');
        h.equal(viaIcal.days[0].items[0].title, 'Ferry crossing', 'the item did not survive the calendar');
        h.equal(viaIcal.title, 'Coastal run', 'the trip title did not survive the calendar');
      },
    },

    {
      // REQ-504, REQ-515. An ATTENDEE richer than the one this app writes — a participation status, a
      // role, an RSVP — says something the model has no field for, so it is kept whole on the
      // traveller and written back as it arrived. Synthesizing `CN` + `mailto:` in its place, which
      // is what the mapper did, silently dropped the rest, so the ledger's **P** for ATTENDEE was a
      // promise the export did not keep.
      name: 'REQ-515: a foreign ATTENDEE keeps the parameters the model has no field for',
      run: function () {
        var TP = h.pure().TP;

        var line = 'ATTENDEE;CN="Ann Other";PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:ann@example.invalid';
        var ics = [
          'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Elsewhere//EN',
          'BEGIN:VEVENT', 'UID:foreign-att', 'DTSTAMP:20260101T000000Z',
          'DTSTART:20260901T090000Z', 'SUMMARY:Ferry', line,
          'END:VEVENT', 'END:VCALENDAR', '',
        ].join('\r\n');

        var trip = TP.ical.toTrip(ics, { docId: 'doc-foreign-att' });
        var person = trip.travelers[0];
        h.equal(person.name, 'Ann Other', 'the ATTENDEE did not become a traveller');
        var bag = TP.model.bag(person, 'iCal');
        h.equal(bag.EMAIL, 'ann@example.invalid', 'the address did not reach the traveller');
        h.ok(bag.ATTENDEE, 'the foreign ATTENDEE was not kept whole');
        ['PARTSTAT=ACCEPTED', 'ROLE=REQ-PARTICIPANT', 'RSVP=TRUE'].forEach(function (p) {
          h.ok(String(bag.ATTENDEE).indexOf(p) !== -1, 'the ATTENDEE bag lost ' + p);
        });

        // Out to a calendar: the line is back, with its parameters, and the file is a fixed point —
        // the property that makes the re-export a copy rather than a re-interpretation.
        var text = TP.ical.fromTrip(trip, { now: EXPORT_TIME }).text;
        ['PARTSTAT=ACCEPTED', 'ROLE=REQ-PARTICIPANT', 'RSVP=TRUE'].forEach(function (p) {
          h.ok(text.indexOf(p) !== -1, 'the re-exported calendar lost ' + p);
        });
        var again = TP.ical.fromTrip(TP.ical.toTrip(text), { now: EXPORT_TIME }).text;
        h.equal(again, text, 'a calendar with a rich ATTENDEE is not a fixed point');

        // And it survives the OTHER format too: the bag is the calendar's, so it rides in the
        // carrier through `trip-data.json` (06-interchange.md §3.5).
        var viaJson = TP.tripdatajson.toTrip(TP.tripdatajson.fromTrip(trip));
        h.deepEqual(TP.model.bag(viaJson.travelers[0], 'iCal'), bag,
          'the traveller bag did not survive trip-data.json');
        h.ok(TP.ical.fromTrip(viaJson, { now: EXPORT_TIME }).text.indexOf('RSVP=TRUE') !== -1,
          'the parameters were lost on the trip-data.json leg');

        // Non-vacuity, the other way: the line THIS app writes needs no bag, because the traveller
        // already holds everything in it. A mapper that bagged every ATTENDEE would make every
        // export carry a redundant line, and every import of its own file would find a foreign one.
        var ours = [
          'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//trip-planner//Portable Versioned Document//EN',
          'BEGIN:VEVENT', 'UID:our-att', 'DTSTAMP:20260101T000000Z', 'DTSTART:20260901T090000Z',
          'SUMMARY:Ferry', 'ATTENDEE;CN="Ann Other":mailto:ann@example.invalid',
          'END:VEVENT', 'END:VCALENDAR', '',
        ].join('\r\n');
        var own = TP.ical.toTrip(ours, { docId: 'doc-own-att' });
        h.deepEqual(TP.model.bag(own.travelers[0], 'iCal'), { EMAIL: 'ann@example.invalid' },
          'a line in this app’s own shape was kept as though it were foreign, beside the traveller');
      },
    },

    {
      // REQ-205, §3.1. A traveller whose only bag is the CALENDAR's — where an `.ics` import puts the
      // address — must not take the bare-name shorthand on `trip-data.json`: the shorthand has
      // nowhere to put a carrier, so the address was gone after one trip through that file. The
      // shorthand is still used for a traveller that carries nothing, which is what keeps a file
      // that came in as names going out as names.
      name: '§3.1: a traveller carrying only the calendar’s bag is not written as a bare name',
      run: function () {
        var TP = h.pure().TP;

        var trip = TP.model.newTrip({ title: 'Travellers', docId: 'doc-trav-bag' });
        trip.travelers = [{ id: TP.uid(), name: 'Ann', type: 'adult', x: { iCal: { EMAIL: 'ann@example.invalid' } } }];
        var wire = wireOf(TP, 'json', trip);
        h.equal(typeof wire.trip.travelers[0], 'object',
          'a traveller carrying a calendar bag was written as a bare name, losing the bag');
        h.deepEqual(wire.trip.travelers[0].x, { iCal: { EMAIL: 'ann@example.invalid' } },
          'the traveller’s carrier was not written');

        var back = tripOf(TP, 'json', wire);
        h.deepEqual(TP.model.bag(back.travelers[0], 'iCal'), { EMAIL: 'ann@example.invalid' },
          'the address did not survive the trip-data.json round trip');

        // A traveller with nothing extra keeps the incumbent shape — the round trip stays a fixed
        // point rather than growing an object on the first export that nothing asked for.
        var plain = TP.model.newTrip({ title: 'Plain', docId: 'doc-plain' });
        plain.travelers = [{ id: TP.model.derivedId('person', 0, 'Ann'), name: 'Ann', type: 'adult' }];
        h.deepEqual(wireOf(TP, 'json', plain).trip.travelers, ['Ann'],
          'a traveller with nothing extra was written as an object');
      },
    },

    {
      // REQ-206. An empty bag is omitted, never emitted as `{}`. This is not tidiness: a document
      // full of empty bags fails its own fixed point (the bag is there on one leg and not the
      // other), and every export of every trip carries `x: {}` on every entity.
      name: 'REQ-206: an empty bag is absent, not an empty object',
      run: function () {
        var TP = h.pure().TP;
        var trip = TP.model.newTrip({ title: 'Nothing extra', docId: TP.uid() });
        var paths = h.leafPaths(trip);
        h.ok(paths.length > 10, 'the new trip has only ' + paths.length + ' leaf paths');
        h.equal(paths.filter(function (p) { return /(^|\.)x(\.|$)/.test(p); }).length, 0,
          'a brand new trip already has bag keys: ' + JSON.stringify(paths));

        var jsonWire = wireOf(TP, 'json', trip);
        h.equal(Object.prototype.hasOwnProperty.call(jsonWire.trip, 'x'), false,
          'the trip-data.json wire carries an empty carrier');
        h.equal(wireText(TP, 'json', jsonWire).indexOf('"x"'), -1,
          'the trip-data.json wire carries a bag somewhere: ' + h.truncate(wireText(TP, 'json', jsonWire), 200));

        var icalText = wireOf(TP, 'ical', trip);
        h.equal(/^X-(?!WR-CALNAME)/m.test(icalText), false,
          'the calendar carries a property of ours for a trip with nothing extra:\n        ' +
          h.truncate(icalText, 300));
      },
    },

    {
      // The fields a PANEL writes, rather than the fields a file carries.
      //
      // `tripdatajson` is a closed field list: it writes the fields its key tables name and nothing
      // else. So a field the UI writes straight onto a model row that no table names is destroyed on
      // export without a word. Three were — `lodging[].confirmation`, `chargingNetworks[].notes` and
      // `item.link` — and this test is the one that would have caught them, but only because the
      // corpus above now populates them. P9 could not ask the question before: `maximalTrip` and
      // `randomTrip` were written from the key tables, so the corpus and the mapper agreed because
      // they were the same list.
      //
      // The values are written the way a panel writes them, as plain properties on the row and not
      // through a bag, which is the shape `setCell` produces. These five names are the CONTRACT the
      // panels have to use; whether they actually use them is not a question this file can ask,
      // because the UI is not in the pure prefix it loads — `artifact.test.js` reads the panel specs
      // out of the built program and checks each key against these same tables. The two tests are
      // halves of one rule, which is why neither is written as if it were the whole of it.
      name: 'a field a panel writes is a field the wire carries',
      run: function () {
        var TP = h.pure().TP;
        var trip = h.maximalTrip(TP, 'X');

        // Exactly the fields the panels write, at the names they write them. A rename in the UI that
        // the wire did not follow fails here rather than in a person's file.
        trip.lodging[0].confirmation = 'ABC123';
        trip.chargingNetworks[0].nacsAdapter = true;
        trip.chargingNetworks[0].notes = 'two stalls, one broken';
        trip.expenses[0].label = 'Coffee and a pastry';
        trip.days[0].items[0].link = 'https://example.invalid/museum';
        trip = TP.model.normalize(trip, trip.docId);

        var checks = [
          ['lodging[0].confirmation', 'ABC123'],
          ['chargingNetworks[0].nacsAdapter', true],
          ['chargingNetworks[0].notes', 'two stalls, one broken'],
          ['expenses[0].label', 'Coffee and a pastry'],
          ['days[0].items[0].link', 'https://example.invalid/museum'],
        ];
        // All five survive `trip-data.json`. The calendar carries only the item's link: a lodging
        // stay, a charging network and an expense are not VEVENTs here, which is the `D` the ledger
        // already discloses for those collections — checked by P11 over the whole corpus, so it is
        // named here rather than re-asserted.
        var back = tripOf(TP, 'json', wireOf(TP, 'json', trip));
        checks.forEach(function (pair) {
          var kept = h.getPath(back, pair[0]);
          h.equal(kept, pair[1], 'trip-data.json: ' + pair[0] + ' was written as ' + JSON.stringify(pair[1]) +
            ' and came back as ' + JSON.stringify(kept));
        });
        var onCalendar = tripOf(TP, 'ical', wireOf(TP, 'ical', trip));
        h.equal(h.getPath(onCalendar, 'days[0].items[0].link'), 'https://example.invalid/museum',
          'the item link did not survive the calendar');
      },
    },

    {
      // The other half of naming a bagged field, and the reason `dropBag` exists at all.
      //
      // A document written before this generation named `lodging[].confirmation` holds that value in
      // the entity's bag — the model IS the committed payload, so the bag is in the file a person
      // already has. `emitUnknown` writes the bag AFTER the named fields, so on the first edit the
      // stale copy silently overwrites what the person just typed: the file reverts the correction
      // made to it. `fromEntity` drops the bag member once the field it stands in for is present,
      // which is the same rule `minSocRaw` and `nacsAdapterRaw` follow.
      name: 'a stale bag member does not overwrite the value a person just typed',
      run: function () {
        var TP = h.pure().TP;
        var trip = TP.model.newTrip({ title: 'Upgraded', docId: TP.uid() });
        trip.lodging = [{
          id: 'L1',
          location: 'Hotel X',
          checkIn: '2026-09-01',
          // What an older build left behind: the value it could not name, in the bag.
          x: { tripDataJson: { confirmation: 'OLD-ABC123' } },
        }];
        h.equal(trip.lodging[0].confirmation, undefined, 'the fixture already has a plain confirmation');

        // The person opens the panel and corrects it. This is what `setCell` writes.
        trip.lodging[0].confirmation = 'NEW-EDITED';
        var wire = wireOf(TP, 'json', trip);
        h.equal(wire.lodging[0].confirmation, 'NEW-EDITED',
          'the bagged value overwrote the edit: the file says ' + JSON.stringify(wire.lodging[0].confirmation) +
          ' and the person typed "NEW-EDITED"');
        h.equal(JSON.stringify(wire.lodging[0]).indexOf('OLD-ABC123'), -1,
          'the stale value is still somewhere on the wire: ' + JSON.stringify(wire.lodging[0]));

        // And with no edit at all the bagged value is still the one written, so a document that
        // predates this generation is not emptied by opening it.
        var untouched = TP.model.normalize({
          title: 'Upgraded', docId: TP.uid(),
          lodging: [{ id: 'L1', location: 'Hotel X', x: { tripDataJson: { confirmation: 'OLD-ABC123' } } }],
        }, 'doc-1');
        h.equal(wireOf(TP, 'json', untouched).lodging[0].confirmation, 'OLD-ABC123',
          'a confirmation only the bag holds was dropped rather than written back');
      },
    },

    {
      // A `URL` property is a URI and a link is free text, so the mapper writes one only when the two
      // are the same thing. This is the guard that keeps the app's own export re-importable: an
      // item whose link is prose or a `javascript:` URL must not put a URL line on the calendar for
      // this app's validator to refuse.
      name: 'item.link reaches the calendar only when it is a URL, and never becomes an invalid one',
      run: function () {
        var TP = h.pure().TP;
        var trip = h.maximalTrip(TP, 'X');
        trip.days[0].items[0].link = 'https://example.invalid/museum';
        h.ok(/^URL:https:\/\/example\.invalid\/museum$/m.test(wireOf(TP, 'ical', trip)),
          'a link that is a URL was not written as one:\n' +
          h.truncate(wireOf(TP, 'ical', trip), 600));

        ['the museum website', 'javascript:alert(1)', '', 'www.example.com'].forEach(function (link) {
          var t = h.maximalTrip(TP, 'X');
          t.days[0].items[0].link = link;
          t = TP.model.normalize(t, t.docId);
          var text = wireOf(TP, 'ical', t);
          h.equal(/^URL:/m.test(text), false,
            'the link ' + JSON.stringify(link) + ' was written into a URL property, which must be a URI');
          // The export is still a calendar this app will re-import, which is the point of declining.
          h.equal(TP.validators.check('ical', text).ok, true,
            'our own export of a trip with the link ' + JSON.stringify(link) + ' is refused by our own validator');
          // And nothing is lost: the value is still on the item and still on the JSON wire.
          h.equal(wireOf(TP, 'json', t).days[0].items[0].link, link || undefined,
            'declining the calendar lost the link from trip-data.json too');
        });
      },
    },

    {
      // REQ-809. The ledger is complete: every field path the model can emit is classified for at
      // least one of the two formats. This is the check that catches a field added to the model and
      // forgotten in the ledger — the failure mode PATTERN.md §8.1 step 3 exists to prevent — and it
      // is driven by the model rather than by a list copied into this file, so it cannot fall behind
      // the model it is checking.
      name: 'REQ-809: the ledger classifies every field path the model can emit',
      run: function () {
        var TP = h.pure().TP;
        var paths = h.leafPaths(h.maximalTrip(TP, 'X'));
        var result = TP.ledger.check(paths);
        h.equal(result.ok, true, 'the ledger says nothing about: ' + JSON.stringify(result.missing));
        h.ok(paths.length > 100, 'the maximally populated trip has only ' + paths.length + ' leaf paths');

        // Non-vacuity: the check has to be able to fail. A path no format names is exactly what it
        // is written to catch, and it must report one when handed it.
        var broken = TP.ledger.check(['days[0].items[0].notAField']);
        h.equal(broken.ok, false, 'the completeness check passed a path the ledger does not classify');
        h.deepEqual(broken.missing, ['days[0].items[0].notAField'], 'the check reported the wrong path');
      },
    },

    {
      // REQ-511. The ledger's rows are as coarse as the spec's tables — `item.flags` covers every
      // flag, `lodging[]` every field of a lodging — so `kindOf` resolves a runtime path against the
      // longest row that bounds it on a segment boundary. Without that rule the completeness check
      // could only pass if the ledger were rewritten in some other dialect, and a check that has to
      // be turned off is worse than none.
      name: 'REQ-511: a coarse ledger row classifies the paths beneath it, and only whole segments',
      run: function () {
        var TP = h.pure().TP;
        var D = TP.ledger.DROPPED;
        var M = TP.ledger.MAPPED;
        var F = TP.ledger.FOLDED;

        // Beneath a collection row.
        h.equal(TP.ledger.kindOf('lodging[0].location', 'ical'), D, 'lodging[].location');
        h.equal(TP.ledger.kindOf('lodging[0].location', 'json'), M, 'lodging[].location on the wire');
        // Beneath an object row.
        h.equal(TP.ledger.kindOf('vehicle.model', 'ical'), D, 'vehicle.model');
        h.equal(TP.ledger.kindOf('days[0].items[0].flags.minSoc', 'ical'), D, 'item.flags.minSoc');
        // Beneath a traveller, which the calendar folds.
        h.equal(TP.ledger.kindOf('travelers[0].name', 'ical'), F, 'travelers[].name');
        h.equal(TP.ledger.kindOf('travelers[0].id', 'ical'), D, 'travelers[].id is finer than the row above it');

        // A segment boundary is a boundary: `day.date` does not cover `day.datex`.
        h.equal(TP.ledger.kindOf('days[0].date', 'ical'), M, 'day.date');
        h.equal(TP.ledger.kindOf('days[0].datex', 'ical'), null, 'day.datex');
        h.equal(TP.ledger.kindOf('titles', 'json'), null, 'trip.titles');

        // The translation from runtime paths to the ledger's dialect, which is the only reason the
        // two can be compared at all.
        h.equal(TP.ledger.ledgerPath('days[0].items[3].title'), 'item.title');
        h.equal(TP.ledger.ledgerPath('days[2].stay'), 'day.stay');
        h.equal(TP.ledger.ledgerPath('travelers[1].name'), 'trip.travelers[].name');
        h.equal(TP.ledger.ledgerPath('vehicle.model'), 'trip.vehicle.model');
        h.equal(TP.ledger.ledgerPath('lodging[0].notes'), 'lodging[].notes');
        h.equal(TP.ledger.ledgerPath('title'), 'trip.title');
      },
    },

    {
      // Detection is structural, never by filename (specs/06-interchange.md §2). It is the one place
      // a hostile file gets to choose what the app thinks it is, so the interesting cases are the
      // ones that look like something they are not.
      name: 'detection is structural: a calendar is not trip data, and trip data is not a calendar',
      run: function () {
        var TP = h.pure().TP;

        h.equal(TP.io.import.detect(FOREIGN_ICAL).format, 'ical', 'a calendar was not detected');
        h.equal(TP.io.import.detect(JSON.stringify(FOREIGN_TRIPDATA, null, 2)).format, 'tripdata',
          'trip data was not detected');

        // A leading blank line or a BOM does not change what the file is.
        h.equal(TP.io.import.detect('﻿\r\n\r\n' + FOREIGN_ICAL).format, 'ical', 'a BOM defeated detection');
        h.equal(TP.tripdatajson.detect(FOREIGN_TRIPDATA), true, 'the trip-data marker was not found');
        h.equal(TP.tripdatajson.detect({ note: 'not a trip' }), false, 'any JSON object was read as trip data');
        h.equal(TP.ical.detect('SUMMARY:not a calendar'), false, 'a bare property was read as a calendar');

        // Something that is neither is refused with a reason rather than guessed at.
        var unknown = TP.io.import.detect('{"trip": 1}'.replace('{"trip": 1}', '{"hello":"world"}'));
        h.equal(unknown.format, 'unknown', 'an unrelated JSON file was accepted');
        h.ok(unknown.reason && unknown.reason.length > 0, 'the refusal gave no reason');

        // And the whole read path agrees with the detector: what `detect` calls a calendar is what
        // `parseText` reads as one, so a file cannot be classified one way and read another.
        var read = TP.io.import.parseText(FOREIGN_ICAL);
        h.equal(read.ok, true, 'the foreign calendar could not be read: ' + read.reason);
        h.equal(read.formatId, TP.ical.ID, 'the calendar was read as something else');
        var readJson = TP.io.import.parseText(JSON.stringify(FOREIGN_TRIPDATA));
        h.equal(readJson.ok, true, 'the foreign trip data could not be read: ' + readJson.reason);
        h.equal(readJson.formatId, TP.tripdatajson.ID, 'the trip data was read as something else');
      },
    },

    {
      // The negative control for everything above: the comparison these tests rest on has to be able
      // to see a difference. A `differences` that always returned nothing would make every property
      // in this file pass, and this is the test that fails when that happens.
      name: 'the comparison behind these properties can see a difference',
      run: function () {
        var TP = h.pure().TP;
        var trip = h.randomTrip(TP, h.generator(7));
        h.deepEqual(differences(trip, TP.model.clone(trip)), [], 'a payload differs from its own copy');

        var changed = TP.model.clone(trip);
        changed.days[0].items[0].title = 'something else';
        var found = differences(trip, changed);
        h.equal(found.length, 1, 'changing one field produced ' + found.length + ' differences');
        h.equal(found[0].path, 'days[0].items[0].title', 'the difference was reported at the wrong path');

        // And a field REMOVED is a difference too, which is the case a comparison written over the
        // after-side alone would miss.
        var removed = TP.model.clone(trip);
        delete removed.subtitle;
        var gone = differences(trip, removed);
        h.equal(gone.length, 1, 'removing one field produced ' + gone.length + ' differences');
        h.equal(gone[0].path, 'subtitle', 'the removal was reported at the wrong path');

        // Two different trips produce different wires: the fixed-point assertions are not comparing
        // two exports of nothing.
        var a = wireText(TP, 'json', wireOf(TP, 'json', h.randomTrip(TP, h.generator(8))));
        var b = wireText(TP, 'json', wireOf(TP, 'json', h.randomTrip(TP, h.generator(9))));
        h.ok(a !== b, 'two different trips exported to the same trip-data.json');

        // And the report a TEXT wire failure produces names the line that differs. This is the check
        // that would have turned the `DTSTAMP` flake into one line of output instead of two days of
        // it: a wire fixed-point failure on a calendar used to report `seed 83: ` and nothing else,
        // because `differences` is written for payloads and a string has no leaf paths to walk.
        var one = TP.ical.fromTrip(trip, { now: '2026-01-01T00:00:00Z' }).text;
        var two = TP.ical.fromTrip(trip, { now: '2026-01-01T00:00:01Z' }).text;
        var said = wireDifference(one, two);
        h.ok(said.length > 0, 'two calendars one second apart produced no report at all');
        h.ok(said.indexOf('DTSTAMP:20260101T000000Z') !== -1 && said.indexOf('DTSTAMP:20260101T000001Z') !== -1,
          'the report does not name both sides of the line that differs: ' + h.truncate(said, 200));
        said.split('\n        ').forEach(function (line) {
          h.ok(/^line \d+: /.test(line), 'a report line does not say where it is: ' + h.truncate(line, 80));
        });

        // A wire against itself is no difference, so the report above is not a constant string.
        h.equal(wireDifference(one, one), '', 'two identical calendars produced a difference');
      },
    },
  ],
};
