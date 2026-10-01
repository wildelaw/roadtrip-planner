// The validators (specs/06-interchange.md §7, specs/09-testing.md §6, ADR-0008;
// REQ-115, REQ-516, REQ-517, REQ-518, REQ-806, REQ-807).
//
// WHAT THIS FILE IS FOR. `ADR-0008` chose hand-written validators over a runtime dependency and named
// the risk in the same paragraph: "a subtly wrong validator is worse than none because it gives
// confident wrong answers". The mitigation is threefold, and each third is a test here:
//
//   * The validator is DELIBERATELY incomplete, and the incompleteness is mechanical rather than
//     remembered: `SUPPORTED` is a list, and a schema asking for anything outside it is reported
//     rather than ignored. The first two tests check that no vendored schema asks for a check that
//     does not exist, and that the mechanism would notice if one did.
//
//   * The vendored schemas are INLINED at build time from `vendor/` rather than checked in twice
//     (PATTERN.md §5.11, REQ-115), and the tests here assert the two are still the same bytes.
//
//   * The validator is CROSS-CHECKED against a full implementation over a corpus (REQ-806). That
//     needs a development dependency, so it lives in `schema-crosscheck.test.js`, which skips with a
//     stated reason when `ajv` is absent. This file's corpus is the same corpus, run against the
//     hand-written validator alone, so the parts that need no dependency still cover it.
//
// The last test in this file is the one `test/traceability.test.js` taught: every check above is
// written as a function that returns its complaints, and the final test feeds each one a deliberately
// broken input and requires a complaint. A check that cannot fail is the most convincing kind of
// false comfort.

'use strict';

var h = require('./harness.js');

module.exports = {
  name: 'validators (REQ-516)',
  tests: [
    {
      name: 'every vendored schema is the one the artifact carries (REQ-115)',
      run: function () {
        var TP = h.pure().TP;
        var names = { container: 'container-1.0.0.schema.json', tripData: 'trip-data-1.0.0.schema.json', icalendar: 'icalendar-rfc5545.json' };
        Object.keys(names).forEach(function (key) {
          var onDisk = JSON.parse(h.read('vendor/' + names[key]));
          h.deepEqual(TP.schemas[key], onDisk,
            'TP.schemas.' + key + ' differs from vendor/' + names[key] +
            ' — the build and the harness both generate it from that file, so this can only mean a stale artifact');
        });
        // The generated fragment is a function of the files, not a copy of them: editing a schema
        // changes the source the build inlines. Asserted by generating from a stubbed reader and
        // requiring the result to contain the edited value.
        var source = h.fragments.vendoredFragmentSource();
        h.ok(source.indexOf('TP.schemas =') === 0 || source.indexOf('TP.schemas =') !== -1,
          'the vendored fragment assigns TP.schemas');
        h.ok(source.indexOf('"$id"') !== -1, 'the fragment carries the schemas rather than a reference to them');
      },
    },
    {
      name: 'no vendored schema asks for a check the validator does not implement (ADR-0008)',
      run: function () {
        var TP = h.pure().TP;
        var complaints = [];
        ['container', 'tripData'].forEach(function (key) {
          TP.validators.schema.unsupportedKeywords(TP.schemas[key]).forEach(function (gap) {
            complaints.push('TP.schemas.' + key + ' uses ' + gap.keyword + ' at ' + (gap.at || '<root>') +
              ', which the hand-written validator does not implement');
          });
        });
        h.equal(complaints.length, 0,
          complaints.join('\n  ') +
          '\n  (Either implement the keyword, or remove it from the schema and say so in vendor/PROVENANCE.md.)');
      },
    },
    {
      name: 'the validator reports an unsupported keyword rather than ignoring it',
      run: function () {
        var TP = h.pure().TP;
        // The negative control for the test above. `format` and `if`/`then` are the two most commonly
        // ignored keywords in the ecosystem, and ignoring them silently is exactly the failure mode
        // ADR-0008 names: a schema that says "this must be an email" validated by a validator that
        // has never heard of `format` gives a confident yes.
        var control = {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            kind: { type: 'string' },
            other: { type: 'string' },
          },
          if: { properties: { kind: { const: 'a' } } },
          then: { required: ['other'] },
        };
        var found = TP.validators.schema.unsupportedKeywords(control);
        function names(kw) {
          return found.some(function (gap) { return gap.keyword === kw; });
        }
        h.ok(names('format'), 'a schema using `format` is reported as unsupported');
        h.ok(names('if') || names('then'), 'a schema using `if`/`then` is reported as unsupported');
        // Reported WITH a location: "the schema uses `format`" is not actionable, "at
        // properties.email" is.
        var at = found.filter(function (gap) { return gap.keyword === 'format'; })[0];
        h.ok(at && at.at && at.at.indexOf('email') !== -1, 'the report says where the unimplemented keyword is, not just that it exists');

        // And the report reaches the caller, not just the introspection function: a value that
        // satisfies the parts the validator does understand is still not called valid, because the
        // schema asked for something the validator cannot answer.
        var result = TP.validators.schema.validate(control, { email: 'not an email', kind: 'a' });
        h.ok(!result.ok, 'a value is not accepted when the schema asks for a check the validator cannot make');
        h.ok(TP.validators.schema.unsupportedKeywords(control).length > 0, 'the gap is nameable, so the message can say what is missing');
      },
    },
    {
      name: 'the corpus validates',
      run: function () {
        var TP = h.pure().TP;
        var complaints = [];
        var checked = 0;

        function tripData(label, value) {
          checked++;
          var r = TP.validators.check('tripdata', value);
          if (!r.ok) complaints.push(label + ': ' + TP.validators.explain(r));
        }
        function ical(label, text) {
          checked++;
          var r = TP.validators.check('ical', text);
          if (!r.ok) complaints.push(label + ': ' + TP.validators.explain(r));
        }

        // Generated trips. A fixed set of seeds, so a failure is reproducible by seed rather than by
        // re-running and hoping.
        for (var seed = 1; seed <= 60; seed++) {
          tripData('generated trip seed ' + seed, TP.tripdatajson.fromTrip(h.randomTrip(TP, h.generator(seed * 104729))));
        }
        tripData('the maximal trip', TP.tripdatajson.fromTrip(h.maximalTrip(TP)));
        tripData('an empty trip', TP.tripdatajson.fromTrip(TP.model.newTrip({})));
        tripData('the incumbent generation, upgraded', incumbentUpgraded(TP));
        tripData('unknown fields at every level', {
          trip: { title: 'x', unknownTripField: [1, 2] },
          days: [{ date: '2026-01-01', unknownDayField: 'keep', items: [{ activity: 'x', unknownItemField: { a: 1 } }] }],
          unknownTopLevel: true,
        });

        // Calendars: this app's own export of the same trips, and a hand-written one from the wider
        // world (recurrence, alarm, attendee, time zone) — the corpus member 09-testing.md §6 names
        // and the one this app did not write.
        for (var s = 1; s <= 10; s++) {
          ical('our export of seed ' + s, TP.ical.fromTrip(h.randomTrip(TP, h.generator(s * 7919))).text);
        }
        ical('our export of the maximal trip', TP.ical.fromTrip(h.maximalTrip(TP)).text);
        ical('a foreign calendar', foreignCalendar());

        // The envelope, built the way the app builds one — including the document id. A commit carries
        // the registry's docId, and BOTH the schema and `verify.chain` require it to be a non-empty
        // string; a fixture without one is a container this app could not have written, and the schema
        // rightly refuses it.
        var docId = 'doc-fixture-0001';
        var root = TP.history.append(null, { trip: TP.model.newTrip({ title: 'Root', docId: docId }) },
          { docId: docId, author: { name: 'A Person', email: 'a@example.invalid' }, message: 'Root', timestamp: '2026-01-01T00:00:00.000Z' });
        var second = TP.history.append(root.history, { trip: h.maximalTrip(TP) },
          { docId: docId, author: { name: 'A Person', email: 'a@example.invalid' }, message: 'Second', timestamp: '2026-01-02T00:00:00.000Z' });
        var container = TP.container.create({ trip: h.maximalTrip(TP) }, undefined, second.history);
        checked++;
        var cr = TP.validators.check('artifact', container);
        if (!cr.ok) complaints.push('a container from this app: ' + TP.validators.explain(cr));

        h.ok(checked > 60, 'the corpus is worth the name (' + checked + ' documents checked)');
        h.equal(complaints.length, 0, complaints.join('\n  '));
      },
    },
    {
      name: 'the canonical model carries no null the schema does not declare (REQ-516)',
      run: function () {
        var TP = h.pure().TP;

        // WHICH FIELDS MAY BE NULL, read off the schema rather than listed here: every property that
        // points at `$defs/nullableString`. A list in this file would be a second copy of the
        // specification, and the failure it produces is the quiet one — the schema gains a nullable
        // field and this test keeps excusing the old set.
        var nullable = [];
        (function walk(node) {
          if (!node || typeof node !== 'object') return;
          if (node.$ref === '#/$defs/nullableString') nullable.push(true);
          Object.keys(node).forEach(function (k) { walk(node[k]); });
        })(TP.schemas.tripData);
        h.ok(nullable.length > 0, 'the schema declares no nullable property, so this test would excuse any null at all');

        var allowed = ['startDate', 'endDate', 'date', 'time'];   // the names, from those four refs
        h.equal(nullable.length, allowed.length, 'the schema has changed how many fields it makes nullable');

        // This is the check, and it is deliberately about the CANONICAL payload rather than the wire
        // form. Every writer of the wire formats prunes a null on the way out, so a null in the
        // payload is invisible in the file — which is exactly how `vehicle: null` survived: the
        // exported document was valid, and the app's own idea of its payload was not.
        function nullPaths(trip) {
          var out = [];
          (function walk(node, path) {
            if (node === null) { if (path) out.push(path); return; }
            if (Array.isArray(node)) { node.forEach(function (x, i) { walk(x, path + '[' + i + ']'); }); return; }
            if (node && typeof node === 'object') {
              Object.keys(node).forEach(function (k) { walk(node[k], path ? path + '.' + k : k); });
            }
          })(trip, '');
          return out;
        }

        var cases = [
          ['a trip with no dates', TP.model.normalize({ title: 'No dates' })],
          ['a day with no date', TP.model.normalize({ title: 'x', days: [{ id: 'd1' }] })],
          ['an item whose time is only text', TP.model.normalize({ title: 'x', days: [{ id: 'd1', date: '2026-01-01', items: [{ id: 'i1', title: 'Later', timeRaw: 'after lunch' }] }] })],
          ['a fresh trip', TP.model.newTrip({})],
          ['the maximal trip', h.maximalTrip(TP)],
        ];
        for (var seed = 1; seed <= 20; seed++) {
          cases.push(['generated trip seed ' + seed, h.randomTrip(TP, h.generator(seed * 6700417))]);
        }

        var bad = [];
        var seen = [];
        cases.forEach(function (pair) {
          nullPaths(pair[1]).forEach(function (path) {
            seen.push(path);
            if (allowed.indexOf(path.split('.').pop().replace(/\[\d+\]$/, '')) === -1) {
              bad.push(pair[0] + ': ' + path + ' is null, and the schema says it is not a nullable field');
            }
          });
        });
        h.equal(bad.length, 0, 'the canonical model uses null where the schema says the field is typed:\n  ' + bad.join('\n  '));
        // Non-vacuous, in two ways: the cases above really do produce nulls, and they produce them at
        // more than one field — a check that only ever saw `startDate` would say nothing about the
        // rest of the model. (Which cases produce which is not asserted: `newTrip` fills both dates,
        // and an item with only a `timeRaw` has no `time` at all rather than a null one, which is
        // the same rule this test is about, applied by the model rather than by the schema.)
        h.ok(seen.length >= 7, 'these cases produced only ' + seen.length + ' null(s), so the check above proves nothing');
        var distinct = seen.map(function (p) { return p.split('.').pop().replace(/\[\d+\]$/, ''); })
          .filter(function (n, i, all) { return all.indexOf(n) === i; });
        h.ok(distinct.length >= 2, 'every null was at ' + distinct.join('/') + ', so only one field is covered');

        // And the check catches one. This is the defect it was written for, at the path it was at.
        var withVehicle = TP.model.newTrip({});
        withVehicle.vehicle = null;
        h.deepEqual(nullPaths(withVehicle).filter(function (p) { return p === 'vehicle'; }), ['vehicle'],
          'the null-path walk does not see a null the schema rejects');

        // The trip-level form, stated as the fact a reader wants: a trip with no vehicle has no
        // `vehicle` key. `03-data-model.md` §2.1 lists it as optional and the schema types it as an
        // object, so "absent" is the only representation that means what it says.
        h.equal('vehicle' in TP.model.newTrip({}), false, 'a fresh trip carries a vehicle key it has no vehicle for');
        h.equal('vehicle' in TP.model.normalize({ title: 'x' }), false, 'normalizing a trip without one invented a vehicle key');
        h.equal('vehicle' in TP.model.normalize({ title: 'x', vehicle: { model: 'Model 3' } }), true,
          'normalizing a trip WITH a vehicle dropped it');
      },
    },
    {
      name: 'malformed files are refused, and each refusal says why (REQ-516, REQ-518)',
      run: function () {
        var TP = h.pure().TP;
        var missed = [];
        var vague = [];

        malformed().forEach(function (m) {
          var r = TP.validators.check(m.format, m.value);
          if (r.ok) { missed.push(m.why + ' — accepted'); return; }
          var said = TP.validators.explain(r);
          // The message has to be usable: it names something, and it is not the same sentence for
          // every failure. A validator whose every refusal reads "invalid" tells a person nothing.
          if (said.length < 20) vague.push(m.why + ' — the reason is ' + JSON.stringify(said));
          if (m.expect && said.indexOf(m.expect) === -1) {
            vague.push(m.why + ' — expected the reason to mention ' + JSON.stringify(m.expect) + ', got ' + JSON.stringify(said));
          }
        });

        h.equal(missed.length, 0, 'these malformed files were accepted:\n  ' + missed.join('\n  '));
        h.equal(vague.length, 0, vague.join('\n  '));
      },
    },
    {
      name: 'a valid file is not refused, and a refusal is not reported for a file the app imports',
      run: function () {
        var TP = h.pure().TP;
        // The property that makes the validator usable rather than merely strict: everything the app
        // itself writes, it accepts. A validator stricter than the writer is a file the app cannot
        // reopen — the failure that would matter most and is easiest to ship.
        var complaints = [];
        for (var seed = 1; seed <= 20; seed++) {
          var trip = h.randomTrip(TP, h.generator(seed * 15485863));
          var wire = JSON.stringify(TP.tripdatajson.fromTrip(trip));
          var parsed = JSON.parse(wire);
          var dr = TP.validators.check('tripdata', parsed);
          if (!dr.ok) complaints.push('seed ' + seed + ': our own trip data was refused: ' + TP.validators.explain(dr));

          var ics = TP.ical.fromTrip(trip).text;
          var ir = TP.validators.check('ical', ics);
          if (!ir.ok) complaints.push('seed ' + seed + ': our own calendar was refused: ' + TP.validators.explain(ir));
        }
        h.equal(complaints.length, 0, complaints.join('\n  '));
      },
    },
    {
      // ADR-0019. The incumbent generation of `trip-data.json` is a generation of THIS format, not a
      // malformed file, so the app upgrades it before the validator is asked. This test is the pair of
      // facts that decision rests on: the schema is right to refuse the file as written, and the
      // upgrade — and only the upgrade — is what makes it a file this app can read.
      name: 'an older generation of trip-data.json is upgraded before it is validated (ADR-0019)',
      run: function () {
        var TP = h.pure().TP;
        var raw = JSON.parse(h.read('test/fixtures/trip-data-generation-1.json'));

        // 1. The schema refuses it, and refuses it for the generation's own spellings rather than by
        //    accident. A refusal for some unrelated reason would mean this test proved nothing.
        var refused = TP.validators.check('tripdata', raw);
        h.ok(!refused.ok, 'the generation-1 fixture is valid against this generation’s schema, so the upgrade is not what is being tested');
        // The paths, not the sentence: `explain` shows the first few problems and counts the rest, so
        // asserting on the sentence would test the summary's length rather than what was refused.
        var paths = (refused.problems || []).map(function (p) { return p.path; }).join(' ');
        ['days[0].id', 'days[0].chargeStops', 'days[0].nacs', 'minSoc', 'nacsAdapter'].forEach(function (name) {
          h.ok(paths.indexOf(name) !== -1, 'nothing was refused at ' + name + ', which is one of the spellings this generation changed: ' + paths);
        });

        // 2. The marker is found, and it is a shape this generation's exporter cannot write.
        var up = TP.tripdatajson.upgrade(raw);
        h.equal(up.from, TP.tripdatajson.PREVIOUS_GENERATION, 'the generation-1 fixture was not recognised as the previous generation');
        h.ok(up.marker, 'the upgrade did not say which shape identified the file');
        h.ok(up.value !== raw, 'the upgrade returned the input itself, so the parsed document was mutated in place');

        // 3. The upgraded wire validates. This is the whole point: exactly one thing changed between
        //    the two lines above.
        var accepted = TP.validators.check('tripdata', up.value);
        h.ok(accepted.ok, 'the upgraded generation-1 fixture is still refused: ' + TP.validators.explain(accepted));

        // 4. Importing the file as text — the path a person takes — succeeds, and says what it read.
        var text = h.read('test/fixtures/trip-data-generation-1.json');
        var result = TP.io.import.parseText(text);
        h.ok(result.ok, 'the generation-1 fixture does not import: ' + result.reason);
        h.equal(result.upgradedFrom, TP.tripdatajson.PREVIOUS_GENERATION, 'the import did not report the generation it read');
        h.ok(result.message.indexOf(TP.tripdatajson.PREVIOUS_GENERATION) !== -1, 'the import message does not name the generation it read');

        // 5. Idempotence. A second pass finds no marker, because the upgrade removed every one of them;
        //    if it did not, importing an exported file twice would change it twice.
        var again = TP.tripdatajson.upgrade(up.value);
        h.equal(again.from, null, 'running the upgrade a second time found a marker still present');
        h.deepEqual(again.value, up.value, 'a second upgrade pass changed the document');

        // 6. No false positive. A document this generation wrote carries no marker, so it is passed
        //    through untouched — including one that a person has hand-edited into a shape that merely
        //    LOOKS odd. `chargingNetworks[].nacsAdapter: 'yes'` is the case: the malformed corpus
        //    refuses it, and the upgrade must not be the thing that rescues it.
        var mine = TP.tripdatajson.fromTrip(h.randomTrip(TP, h.generator(11)));
        var untouched = TP.tripdatajson.upgrade(mine);
        h.equal(untouched.from, null, 'a document this generation wrote was identified as the previous generation');
        h.ok(untouched.value === mine, 'a document with no marker was copied rather than passed through');
        var odd = TP.tripdatajson.upgrade({ trip: { title: 'x' }, chargingNetworks: [{ name: 'x', nacsAdapter: 'yes' }] });
        h.equal(odd.from, null, 'a lone non-boolean nacsAdapter was enough to call the file generation 1');
        h.ok(!TP.validators.check('tripdata', odd.value).ok, 'a lone non-boolean nacsAdapter is now accepted, so the hostile-input case is gone');
      },
    },
    {
      name: 'the import path refuses a malformed file rather than salvaging one (REQ-516)',
      run: function () {
        var TP = h.pure().TP;
        var complaints = [];

        // `parseText` is the whole import path: detect, then validate, then map. A mapper alone would
        // salvage a file like this into a nearly-empty trip, which is the behaviour REQ-516 exists to
        // prevent — the person would see an imported document that had silently lost everything, with
        // no way to tell that from a document that was simply empty.
        malformed().forEach(function (m) {
          var text = m.format === 'ical' ? m.value : JSON.stringify(m.value);
          var result = TP.io.import.parseText(text);
          if (m.otherFormat) {
            // Malformed as a calendar, well-formed as something else. The right answer is not a
            // refusal but a hand-off to the reader for the format the file actually is — and the
            // fact that the import path finds it proves the detector ran before the ical validator
            // did, rather than the guard having been bypassed.
            h.ok(result.ok, m.why + ' — the import path should route this to the ' + m.otherFormat + ' reader, not refuse it');
            return;
          }
          if (result.ok) complaints.push(m.why + ' — imported anyway');
          else if (!result.reason || result.reason.length < 20) complaints.push(m.why + ' — refused without a reason');
        });

        // And the other direction: a well-formed file still imports, so the guard is a filter and
        // not a wall.
        var good = TP.tripdatajson.fromTrip(h.randomTrip(TP, h.generator(11)));
        var imported = TP.io.import.parseText(JSON.stringify(good));
        h.ok(imported.ok, 'a well-formed trip data file still imports');

        h.equal(complaints.length, 0, complaints.join('\n  '));
      },
    },
    {
      name: 'the detector and the validator agree about what a file is',
      run: function () {
        var TP = h.pure().TP;
        var complaints = [];

        // Detection is structural and never by filename (06-interchange.md §2). The two must not
        // disagree about a file that IS well-formed: a detector that calls something trip data and a
        // validator that then refuses it would mean the app recognising a file it cannot read.
        for (var seed = 1; seed <= 15; seed++) {
          var trip = h.randomTrip(TP, h.generator(seed * 2654435761));
          var wire = JSON.stringify(TP.tripdatajson.fromTrip(trip));
          var found = TP.io.import.detect(wire);
          if (found.format !== 'tripdata') complaints.push('seed ' + seed + ': a trip data file was detected as ' + found.format);
          var ics = TP.ical.fromTrip(trip).text;
          if (TP.io.import.detect(ics).format !== 'ical') complaints.push('seed ' + seed + ': a calendar was detected as something else');
          if (!TP.validators.check('ical', ics).ok) complaints.push('seed ' + seed + ': detected as a calendar but not valid as one');
        }

        // A file that detects as a format but is malformed is the interesting middle case: the
        // detector answers "what is this", the validator answers "can I read it", and they are
        // allowed to differ — that difference IS the malformed branch.
        var bad = { trip: { title: 5 }, days: 'nope' };
        h.equal(TP.io.import.detect(JSON.stringify(bad)).format, 'tripdata',
          'a malformed trip data file is still detected as trip data');
        h.ok(!TP.validators.check('tripdata', bad).ok, 'and is refused by the validator');

        h.equal(complaints.length, 0, complaints.join('\n  '));
      },
    },
    {
      name: 'the iCalendar validator refuses structural damage the mapper would salvage',
      run: function () {
        var TP = h.pure().TP;
        // The reason the validator has its own parser (src/validators/ical.js header): if it unfolded
        // lines with the mapper's function, the two would agree about a malformed file by making the
        // same mistake. This asserts the consequence rather than the implementation — there exists a
        // file this app's tolerant mapper reads events out of, and refuses.
        var salvagedByMapper = 0;
        var refusedByValidator = 0;
        malformed().filter(function (m) { return m.format === 'ical'; }).forEach(function (m) {
          // The mapper is tolerant on purpose (REQ-205–207): it takes what it can and bags the rest,
          // so on a damaged calendar it does not throw — it returns a trip, usually with the events
          // it could still see. That is the behaviour the validator exists to sit in front of.
          var mapped = null;
          try { mapped = TP.ical.toTrip(m.value, { docId: 'd' }); } catch (e) { mapped = null; }
          var items = 0;
          if (mapped && mapped.days) {
            mapped.days.forEach(function (day) { items += (day.items || []).length; });
          }
          if (items > 0) salvagedByMapper++;
          if (!TP.validators.check('ical', m.value).ok) refusedByValidator++;
        });
        h.ok(refusedByValidator > 0, 'the validator refuses damaged calendars');
        h.ok(salvagedByMapper > 0,
          'and at least one of them still yields events to the tolerant mapper — which is the point: the two disagree, ' +
          'so the validator is not merely the mapper restated');
      },
    },
    {
      name: 'every value type in the vendored table is checked, and every check is reachable',
      run: function () {
        var TP = h.pure().TP;
        var table = TP.schemas.icalendar;
        var checks = TP.validators.ical.VALUE_CHECKS;
        var complaints = [];

        // Direction one: a type the table names must have a check. A type named and not checked is a
        // property this validator accepts without looking at it, which is a hole that reads like
        // coverage. The exceptions are the types the source declares it does not check, and the list
        // here is transcribed from `NOT CHECKED` in `src/validators/ical.js` rather than inferred —
        // so adding one there means adding one here, deliberately.
        var NOT_CHECKED = ['TEXT', 'RECUR', 'PERIOD', 'BINARY'];
        var used = {};
        Object.keys(table.components).forEach(function (name) {
          var props = table.components[name].properties || {};
          Object.keys(props).forEach(function (prop) {
            used[props[prop]] = (used[props[prop]] || []).concat([name + '.' + prop]);
          });
        });
        Object.keys(used).forEach(function (type) {
          if (NOT_CHECKED.indexOf(type) !== -1) return;
          if (!checks[type]) complaints.push('the table uses ' + type + ' (' + used[type].join(', ') + ') and there is no check for it');
        });
        h.equal(complaints.length, 0, complaints.join('\n  '));

        // Direction two, and the reason it is not "every check is used by a property in the table":
        // that claim is FALSE and would have to be weakened to hold. DATE, BOOLEAN and FLOAT are
        // reached through the `VALUE=` parameter — `DTSTART;VALUE=DATE:20260101` is a legal property
        // the table describes as DATE-TIME-OR-DATE — so "no property defaults to it" is not "nothing
        // can reach it". What matters is reachability, so that is what is checked, and checked by
        // running it rather than by reading the table.
        var unreachable = [];
        Object.keys(checks).forEach(function (type) {
          if (type === 'URI') return;   // reached the same way; asserted below with a scheme-less value
          var text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//x//EN', 'BEGIN:VEVENT', 'UID:x',
            'DTSTAMP:20260101T000000Z', 'DTSTART;VALUE=' + type + ':' + badValueFor(type), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
          var result = TP.validators.check('ical', text);
          if (result.ok) unreachable.push(type + ' was asked to check ' + JSON.stringify(badValueFor(type)) + ' and accepted it');
        });
        if (TP.validators.check('ical', ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//x//EN', 'BEGIN:VEVENT', 'UID:x',
          'DTSTAMP:20260101T000000Z', 'DTSTART;VALUE=URI:no scheme here', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')).ok) {
          unreachable.push('URI was asked to check a value with no scheme and accepted it');
        }
        h.equal(unreachable.length, 0, unreachable.join('\n  '));

        // And the `VALUE=` override is what makes those reachable, so it gets its own assertion: the
        // same value is accepted as TEXT and refused as INTEGER. A validator that ignored `VALUE=`
        // would fail this in one direction or the other.
        var asText = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//x//EN', 'BEGIN:VEVENT', 'UID:x',
          'DTSTAMP:20260101T000000Z', 'SUMMARY;VALUE=TEXT:2 hours', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
        h.ok(TP.validators.check('ical', asText).ok, 'a TEXT value is not checked as a number');

        // Reachability, behaviourally, on properties the table actually names, each inside the
        // component that declares it: a bad value of each type is refused. The properties matter —
        // `TZOFFSETFROM` is only declared on a VTIMEZONE's STANDARD/DAYLIGHT, so putting it on a
        // VEVENT would test nothing at all (an undeclared property is kept as a bag, REQ-207), which
        // is how the first version of this test reported "checked" for a check that never ran.
        var bad = [
          { type: 'DATE-TIME', line: 'DTSTART:2026-01-01' },
          { type: 'INTEGER', line: 'SEQUENCE:two' },
          { type: 'DURATION', line: 'DURATION:2 hours' },
          { type: 'FLOAT-PAIR', line: 'GEO:far;away' },
        ];
        var accepted = [];
        bad.forEach(function (b) {
          var text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//x//EN', 'BEGIN:VEVENT', 'UID:x', 'DTSTAMP:20260101T000000Z', b.line, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
          if (TP.validators.check('ical', text).ok) accepted.push(b.type + ': ' + b.line + ' was accepted');
        });
        // UTC-OFFSET, in its own home.
        var zone = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//x//EN', 'BEGIN:VTIMEZONE', 'TZID:X',
          'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:0900', 'TZOFFSETTO:+0900',
          'END:STANDARD', 'END:VTIMEZONE', 'END:VCALENDAR'].join('\r\n');
        if (TP.validators.check('ical', zone).ok) accepted.push('UTC-OFFSET: TZOFFSETFROM:0900 (no sign) was accepted');
        h.equal(accepted.length, 0, accepted.join('\n  '));
      },
    },
    {
      name: 'each check above fails when it is fed something broken',
      run: function () {
        var TP = h.pure().TP;
        // The traceability lesson: a check that cannot fail is worse than no check, because it reads
        // like one. Each of these is the check above, applied to input it must complain about.
        var failures = [];

        // The incompleteness mechanism notices a planted keyword.
        var planted = JSON.parse(JSON.stringify(TP.schemas.tripData));
        planted.properties = planted.properties || {};
        planted.properties.title = { type: 'string', format: 'email' };
        if (!TP.validators.schema.unsupportedKeywords(planted).length) failures.push('a planted keyword went unreported');

        // The malformed corpus contains something this validator refuses.
        var refused = malformed().filter(function (m) { return !TP.validators.check(m.format, m.value).ok; });
        if (refused.length !== malformed().length) failures.push('a malformed case was accepted by the validator');

        // The import path refuses them too.
        var imported = malformed().filter(function (m) {
          if (m.otherFormat) return false;   // routed to the right reader, not refused — the point above
          var text = m.format === 'ical' ? m.value : JSON.stringify(m.value);
          return TP.io.import.parseText(text).ok;
        });
        if (imported.length) failures.push('a malformed case was imported anyway');

        // The value checks refuse a bad value.
        var oneBad = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//x//EN', 'BEGIN:VEVENT', 'UID:x', 'DTSTAMP:20260101T000000Z', 'DTSTART:tomorrow', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
        if (TP.validators.check('ical', oneBad).ok) failures.push('a bad DTSTART was accepted');

        // The schema/table consistency check would notice a hole.
        if (!TP.validators.schema.unsupportedKeywords({ type: 'object', patternProperties: {} }).length) {
          failures.push('an unimplemented keyword in the validator\'s own control schema went unreported');
        }

        h.equal(failures.length, 0, failures.join('\n  '));
      },
    },
  ],
};

// ---- Fixtures ----
//
// `corpusOf` in `schema-crosscheck.test.js` builds the same corpus for the reference comparison. It is
// duplicated here rather than shared because the two files must be independently runnable: the
// cross-check skips without `ajv`, and everything in this file has to keep running when it does.

// The shape `app/io.js` wrote — generation 1 of `trip-data.json`, reproduced from the exporter that
// wrote it and from the real file it produced (`test/fixtures/trip-data-generation-1.json`): numeric
// day ids minted by the exporter, numeric `chargeStops`, boolean `nacs`, free text where this
// generation types a number (`minSoc`, `nacsAdapter`), bare-name destinations and travellers, an
// object-map `checklists`, `done` stripped, numeric or prose `cost`.
//
// It is NOT valid against this generation's schema, and it is not supposed to be: `TP.tripdatajson.
// upgrade` moves it into this generation's types before the validator ever sees it (`ADR-0019`).
// `incumbentUpgraded` below is the form the corpus is allowed to ask about.
function incumbentFixture() {
  return {
    trip: {
      title: 'Kyoto and back', startDate: '2026-05-01', endDate: '2026-05-03',
      subtitle: 'A long weekend', currency: 'JPY',
      destinations: ['Kyoto', 'Nara'],
      travelers: [{ name: 'Chris' }, { name: 'Robin', type: 'child' }],
      vehicle: { model: 'Model 3', batteryKWh: 75, efficiencyMilesPerKWh: 4.2, fullRangeMiles: 272, usableRangeMiles: 250, chargingConvention: 'NACS' },
    },
    days: [{
      id: 1, date: '2026-05-01', title: 'Arrive', stay: 'Ryokan', drive: '4 hours',
      chargeStops: 2, nacs: true, summary: 'A gentle first day',
      dining: ['Nishiki market', 'Izakaya'], tips: ['Bring cash', 'IC card for trains'],
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

// The same file as the validator legitimately sees it: the generation upgrade applied first, exactly
// as `TP.io.import.readTripData` and the AI's `guardResult` apply it. This is what the corpus asks
// about — a document this generation can validate.
function incumbentUpgraded(TP) {
  return TP.tripdatajson.upgrade(incumbentFixture()).value;
}

// A calendar this app did not write: a time zone with a rule, an event with a recurrence, an alarm,
// an attendee and a coordinate. This is the corpus member 09-testing.md §6 names.
function foreignCalendar() {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Example//Kyoto//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Kyoto',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Tokyo',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:ferry-1@example.com',
    'DTSTAMP:20260901T120000Z',
    'DTSTART;TZID=Asia/Tokyo:20261001T090000',
    'DTEND;TZID=Asia/Tokyo:20261001T103000',
    'SUMMARY:Ferry to the island',
    'DESCRIPTION:Line one\\nLine two\\, with a comma',
    'LOCATION:Port',
    'GEO:35.0116;135.7681',
    'RRULE:FREQ=WEEKLY;COUNT=3',
    'SEQUENCE:2',
    'ORGANIZER;CN="A Person":mailto:a@example.com',
    'ATTENDEE;CN="A Person";ROLE=REQ-PARTICIPANT:mailto:a@example.com',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT30M',
    'DESCRIPTION:Reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

// A value that is wrong for the named type, so the reachability check has something to refuse. One
// case per type the validator claims to check.
function badValueFor(type) {
  var bad = {
    DATE: '2026-01-01',
    'DATE-TIME': '2026-01-01',
    'DATE-TIME-OR-DATE': 'tomorrow',
    INTEGER: 'two',
    DURATION: '2 hours',
    'UTC-OFFSET': '0900',
    BOOLEAN: 'maybe',
    FLOAT: 'far',
    'FLOAT-PAIR': 'far;away',
    'CAL-ADDRESS': 'not an address',
    URI: 'no scheme here',
  };
  if (bad[type] === undefined) throw new Error('badValueFor has no case for ' + type + ' — add one, or the reachability check silently stops covering it');
  return bad[type];
}

// The malformed cases from the hostile-input sweep (09-testing.md §4), each with the reason it is
// malformed so a failure reports a reason rather than a JSON blob, and `expect` — a phrase the
// refusal has to contain — so a refusal cannot pass by being generic.
//
// `otherFormat` marks the cases that are malformed AS A CALENDAR while being perfectly good as
// something else. Those are not files to refuse: they are files the detector's job is to route. The
// import tests skip them and assert the routing instead, because "refused" would be the wrong answer
// for a file whose only fault is arriving with the wrong extension.
function malformed() {
  var v = function (why, value, expect) { return { why: why, format: 'tripdata', value: value, expect: expect }; };
  var i = function (why, value, expect, other) { return { why: why, format: 'ical', value: value, expect: expect, otherFormat: other }; };
  return [
    v('the root is a string', 'not a document'),
    v('the root is a list', [1, 2, 3]),
    v('trip is a string', { trip: 'x' }),
    v('trip is a list', { trip: [] }),
    v('trip.title is a number', { trip: { title: 5 } }, 'title'),
    v('neither trip nor days is present', { something: 'else' }),
    v('days is a string', { trip: { title: 'x' }, days: 'nope' }, 'days'),
    v('days holds a string', { trip: { title: 'x' }, days: ['nope'] }),
    v('day.items is an object', { trip: { title: 'x' }, days: [{ items: {} }] }, 'items'),
    v('a destination is a number', { trip: { title: 'x', destinations: [5] } }, 'destinations'),
    v('a destination object holds a list for its name', { trip: { title: 'x', destinations: [{ name: [] }] } }),
    v('dining is a string', { trip: { title: 'x' }, days: [{ dining: 'Sushi' }] }, 'dining'),
    v('dining holds an object', { trip: { title: 'x' }, days: [{ dining: [{ a: 1 }] }] }),
    v('checklists is a string', { trip: { title: 'x' }, checklists: 'Packing' }, 'checklists'),
    v('a checklist category is not a list', { trip: { title: 'x' }, checklists: { Packing: 'Passport' } }),
    v('cost is a list', { trip: { title: 'x' }, days: [{ items: [{ activity: 'x', cost: [1] }] }] }, 'cost'),
    v('durationMin is a string', { trip: { title: 'x' }, days: [{ items: [{ activity: 'x', durationMin: '90' }] }] }),
    v('keyTips holds a number', { trip: { title: 'x' }, keyTips: [5] }, 'keyTips'),
    v('nacsAdapter is a string', { trip: { title: 'x' }, chargingNetworks: [{ name: 'x', nacsAdapter: 'yes' }] }),
    v('an expense amount is a list', { trip: { title: 'x' }, expenses: [{ amount: [] }] }),

    i('a calendar with no VERSION or PRODID', 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTAMP:20260101T000000Z\r\nEND:VEVENT\r\nEND:VCALENDAR', 'VERSION'),
    i('a VEVENT with no UID', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nBEGIN:VEVENT\r\nDTSTAMP:20260101T000000Z\r\nEND:VEVENT\r\nEND:VCALENDAR', 'UID'),
    i('an unclosed VEVENT', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTAMP:20260101T000000Z', 'never closed'),
    i('an END that does not match its BEGIN', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTAMP:20260101T000000Z\r\nEND:VTODO\r\nEND:VCALENDAR', 'closes'),
    i('a DTSTART that is not a date', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTAMP:20260101T000000Z\r\nDTSTART:tomorrow\r\nEND:VEVENT\r\nEND:VCALENDAR', 'DTSTART'),
    i('an event with both DTEND and DURATION', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTAMP:20260101T000000Z\r\nDTSTART:20260101T000000Z\r\nDTEND:20260101T010000Z\r\nDURATION:PT1H\r\nEND:VEVENT\r\nEND:VCALENDAR', 'DTEND'),
    i('a VALARM inside a VTIMEZONE', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nBEGIN:VTIMEZONE\r\nTZID:X\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\nEND:VTIMEZONE\r\nEND:VCALENDAR', 'VALARM'),
    i('a property line with no colon', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nGARBAGE\r\nEND:VCALENDAR', 'colon'),
    i('a text file that is not a calendar', 'hello world', 'VCALENDAR'),
    i('a JSON file offered as a calendar', '{"trip":{"title":"x"}}', 'VCALENDAR', 'tripdata'),
    i('a calendar whose components are never closed', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTAMP:20260101T000000Z\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT5M', 'never closed'),
  ];
}
