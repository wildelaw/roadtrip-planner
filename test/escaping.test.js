// The escaping property (specs/09-testing.md §5, REQ-805, REQ-608).
//
//     Imported text is DATA. It is never markup, never a URL, never an attribute value that becomes
//     a second attribute, and never a script.
//
// This is the one promise in the app that a Node test cannot check, because it is a promise about a
// DOM: the modules that hold the text are pure and would pass a string comparison happily while the
// render seam next to them wrote it into the document as markup. So it is checked in a real browser,
// through the real import path, with the real views — and the assertions are made about the document
// that resulted, not about the string that went in.
//
// The file's own honesty checks are as important as its assertions. Each hostile case is also
// asserted to have ARRIVED (`textContent` contains it, the trip holds it), because a check that the
// document contains no `<img>` passes beautifully when the import failed and nothing was rendered at
// all. And the same payload is round-tripped back out through `trip-data.json`, because an app that
// escaped HTML into its data to make the DOM safe would be corrupting the document to protect the
// view — the escaping must happen at the seam and nowhere else.

'use strict';

var h = require('./harness.js');
var browser = require('./browser.js');

// The corpus. Every one of these is a string a person could type into a field, or that a file handed
// to the app could carry, and every one of them is harmless as text.
var HOSTILE = [
  '<img src=x onerror="window.__pwned=1">',
  '<svg onload="window.__pwned=2"></svg>',
  '<script>window.__pwned=3</script>',
  '</textarea><iframe src="data:text/html,<script>window.__pwned=4</script>"></iframe>',
  '" onmouseover="window.__pwned=5" x="',
  "' onfocus='window.__pwned=6' x='",
  '"><body onload="window.__pwned=7">',
  '&lt;img src=x onerror=window.__pwned=8&gt;',
  'javascript:window.__pwned=9',
  '<a href="javascript:window.__pwned=10">click</a>',
  '<!--<img src=x onerror=window.__pwned=11>-->',
  '${window.__pwned=12}',
  '{{constructor.constructor("window.__pwned=13")()}}',
  '`${window.__pwned=14}`',
  // Built from code points rather than typed, because a raw U+2028 in a source line is a line
  // separator and would break this file the next time anything formatted it (see test/browser.js).
  String.fromCharCode(0x2028) + 'window.__pwned=15' + String.fromCharCode(0x2029),
  '𝔘𝔫𝔦𝔠𝔬𝔡𝔢 👨👩👧👦 é́́ \u0000\u001b[31m',
];

// Where the text goes, one place per surface the app renders: the trip header, a day, an item's
// title and description, a location, a checklist line, a lodging row, a reservation, and — the one
// people forget — the ids, which end up in ATTRIBUTES and in URL fragments rather than in text.
// `id` is not in this list because the model assigns ids; the ids that matter here are the wire's,
// which the mapper keeps when a file supplies them (see `TRIPDATA_ID_KEYS` below).
function hostileTrip() {
  var mark = function (i) { return HOSTILE[i % HOSTILE.length]; };
  var trip = {
    trip: {
      title: mark(0),
      subtitle: mark(1),
      currency: mark(2),
      destinations: [mark(3), { name: mark(4) }],
      travelers: [{ name: mark(5) }, { name: mark(6), type: 'child' }],
      vehicle: { model: mark(7), chargingConvention: 'NACS' },
    },
    days: [{
      date: '2026-05-01',
      title: mark(8),
      stay: mark(9),
      drive: mark(10),
      chargeStops: mark(11),
      nacs: mark(12),
      summary: mark(13),
      dining: [mark(14), mark(15)],
      tips: [mark(16), mark(0)],
      items: [
        { time: '09:00', activity: mark(1), desc: mark(2), location: mark(3), confirmation: mark(4), tour: true },
        { time: '14:00', activity: mark(5), desc: mark(6), cost: 12, vendorCode: mark(7) },
      ],
    }, { date: '2026-05-02', title: mark(8), items: [] }],
    lodging: [{ location: mark(9), checkIn: '2026-05-01', area: mark(10), notes: mark(11) }],
    reservations: [{ what: mark(12), when: 'May 1', howToBook: mark(13) }],
    noReservationNeeded: [{ what: mark(14), notes: mark(15) }],
    preTripActions: [{ text: mark(16), category: mark(0) }],
    bucketList: [{ name: mark(1), dateLabel: mark(2) }],
    chargingNetworks: [{ name: mark(3), location: mark(4), network: mark(5) }],
    minSocThresholds: [{ day: 'Day 1', leg: mark(6), minSoc: 20, reason: mark(7) }],
    locations: [{ name: mark(8), summary: mark(9), lodging: mark(10), activities: [{ name: mark(11), desc: mark(12) }] }],
    contacts: [{ what: mark(13), how: mark(14) }],
    criticalAlerts: [{ severity: 'high', title: mark(15), text: mark(16) }],
    keyTips: [mark(0), mark(1)],
    checklists: { Packing: [mark(2), mark(3)], Preparation: [mark(4)] },
    budgetEstimates: [{ category: mark(5), item: mark(6), cost: 100, optional: true }],
    expenses: [{ date: '2026-05-01', category: mark(7), amount: 5, label: mark(8) }],
  };
  // Ids too, because they are rendered into attributes rather than into text, and a value that
  // closes a quoted attribute is the failure mode a text-only test cannot see.
  trip.trip.id = 'trip" onmouseover="window.__pwned=16';
  trip.days[0].id = 'day<svg onload="window.__pwned=17">';
  trip.days[0].items[0].id = "item' onfocus='window.__pwned=18";
  return trip;
}

// The page-side work, in one place because both tests below use it. Written as a function to be
// serialized into the page (see `test/browser.js`), so it closes over nothing.
var IN_PAGE_IMPORT = async function (trip, filename) {
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var out = {};
  var file = new File([JSON.stringify(trip)], filename, { type: 'application/json' });
  var result = await TP.io.import.readFile(file);
  out.format = result.format;
  out.ok = !!result.ok;
  if (!result.ok) { out.reason = result.reason; return out; }

  // The confirmation dialog is the FIRST place this text is rendered — `describe` puts the trip's
  // title in it — so the document is inspected before anything is accepted, and then again after.
  TP.ui.reconcile.acceptImport(result);
  await sleep(80);
  var dialog = document.querySelector('.modal');
  out.dialogShown = !!dialog;
  out.dialogText = dialog ? dialog.textContent : '';
  out.whileOpen = inspect();

  var open = null;
  if (dialog) {
    open = Array.prototype.slice.call(dialog.querySelectorAll('button'))
      .filter(function (b) { return /Open it on its own/.test(b.textContent); })[0];
  }
  out.foundOpenButton = !!open;
  if (open) open.click();
  await sleep(150);

  // Every surface in the shell, so the text passes through as many seams as the app has. The tab
  // buttons are CLICKED rather than switched by a call into the shell: the point is to render the
  // panels the way a person does, and a call to an internal function would test a path that no
  // person takes.
  var tabs = document.querySelectorAll('#tabs button');
  out.tabsRendered = tabs.length;
  for (var t = 0; t < tabs.length; t++) tabs[t].click();
  await sleep(150);

  out.afterImport = inspect();
  out.tripTitles = (TP.store.trip().days || []).map(function (d) { return d.title; });
  out.heldTitle = TP.store.trip().title;
  out.heldItemId = TP.store.trip().days[0].items[0].id;
  out.heldDayId = TP.store.trip().days[0].id;
  // Proved here, in the same page, against the same function the assertions above used, so the
  // evidence that the check can fail travels with the check that passed.
  out.detector = detectorCanary();
  return out;

  // Everything suspicious the given subtree contains, described so a failure can be acted on. This
  // is the whole detector, and `inspect` below is only this plus the payload marker — so the canary
  // further down can run the SAME function against markup that was deliberately parsed and prove
  // that it still fires.
  function badIn(root) {
    var bad = [];

    // Elements this app never builds, in any panel, in any state — every selector below is here for
    // that reason and is checked against what the app renders: `img`/`iframe`/`object`/`embed`
    // appear in no view (the artifact is self-contained and draws its few icons with `svg`), and no
    // view writes an `on*` attribute, because `render.el` takes handlers through `addEventListener`.
    //
    // Deliberately NOT the wider list this started as — `img, svg, script, style, body, textarea` —
    // which reported the app's own AI prompt box as injected content: `elements created from
    // imported text: 1 (textarea)`, on the first run. The shell really does contain a `<textarea>`
    // (it is the prompt field in a rendered panel, and this test clicks every tab), so the wider net
    // caught the app, not the payload. A detector that lights up on the app's own markup is worse
    // than no detector: it is a failure with no fix, and it watches a number that is not the one
    // that matters — it would have been just as happy, and just as red, whether the payload injected
    // an element or not. `svg` went with it because the app does build those; a hostile `<svg
    // onload=…>` is still caught, by its `[onload]` attribute.
    var DANGEROUS = 'img, iframe, object, embed, script, style, a[href^="javascript:"], a[href^="data:"], ' +
      '[onerror], [onload], [onmouseover], [onfocus], [onclick], [oninput], [onstart], [onanimationstart]';
    var found = root.querySelectorAll(DANGEROUS);
    if (found.length) {
      bad.push('elements created from imported text: ' + found.length + ' (' +
        Array.prototype.slice.call(found, 0, 4).map(function (e) { return e.tagName.toLowerCase(); }).join(', ') + ')');
    }

    // An event-handler ATTRIBUTE is an injection too, and it is the half the selector above cannot
    // be complete about: a payload that ends up on an element the app is allowed to build — a
    // `<body onload=…>`, an attribute on the app's own `<div>` — is still a handler, and this sweep
    // looks at every attribute of every element rather than at a list of tag names.
    var handlers = 0;
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var attrs = all[i].attributes;
      for (var j = 0; j < attrs.length; j++) if (/^on/i.test(attrs[j].name)) handlers++;
    }
    if (handlers) bad.push('event-handler attributes: ' + handlers);

    return bad;
  }

  // What the document now contains. `pwned` is the marker every payload would set if it were ever
  // executed, and `bad` is the other half: markup that is never clicked is still markup, and the
  // next person's click is not this test's.
  function inspect() {
    var root = document.getElementById('app') || document.body;
    return {
      pwned: typeof window.__pwned === 'undefined' ? null : window.__pwned,
      bad: badIn(root),
      text: root.textContent,
      html: root.innerHTML,
    };
  }

  // The detector, run against a node built by PARSING markup and against one built from the same
  // characters as text. This is what keeps the assertions above from being vacuous: if `badIn` ever
  // stopped looking at anything — a selector typo, an early return — it would report nothing on both
  // of these, and this says so, instead of the test quietly passing while the seam is wide open.
  //
  // `innerHTML` appears in this file here and nowhere else, on a detached node this function made
  // and throws away. Nothing it produces is ever inserted anywhere, and the app never sees it: a
  // test that proves a detector works has to hand it something unsafe, and the safe way to do that
  // is a canary that is not in the document.
  function detectorCanary() {
    var parsed = document.createElement('div');
    parsed.innerHTML = '<img src=x onerror="1"><a href="javascript:1">x</a>';
    var literal = document.createElement('div');
    literal.appendChild(document.createTextNode('<img src=x onerror="1">'));
    var out = { onMarkup: badIn(parsed).length, onText: badIn(literal).length };
    parsed.remove();
    literal.remove();
    return out;
  }
};

module.exports = {
  name: 'escaping (REQ-805)',
  skip: browser.reason(),

  tests: [
    {
      name: 'text from an imported file is rendered as text, and never as markup',
      run: async function () {
        var server = await browser.serve();
        var page = await browser.visit({ origin: server.origin });
        try {
          var trip = hostileTrip();
          // The filename is a string from outside the app too, and it is shown to the person.
          var name = HOSTILE[0] + '.json';
          var out = await page.evaluate(IN_PAGE_IMPORT, [trip, name]);

          h.ok(out.ok, 'the hostile file was not read as trip data: ' + (out.reason || 'no reason given'));
          h.equal(out.format, 'tripdata', 'the hostile file was not even detected as trip data');

          // The id went into the model intact. This is the one assertion here that is about the app's
          // DATA rather than about the document, and it is first because it needs no rendering to be
          // meaningful: a sanitizing importer would fail it while the document looked perfect.
          h.equal(out.heldItemId, "item' onfocus='window.__pwned=18", 'the item id was not kept as it came in');

          // The safety assertions come before the "did it arrive" ones ON PURPOSE. Both catch a
          // broken render seam, but only these say what went wrong: with `text:` going through
          // `innerHTML` — the defect this test exists for — the payload arrives as an `<img>` element
          // instead of as characters, so a check for the characters fails first and reports "the
          // hostile text is not in the rendered document", which reads like the text went missing
          // rather than like markup was created. Checked in this order, the same artifact reports
          // `elements created from imported text: 1 (img)`.
          h.equal(out.whileOpen.pwned, null, 'a payload executed while the confirmation dialog was open');
          h.deepEqual(out.whileOpen.bad, [], 'the dialog body was not safe:\n        ' + out.whileOpen.bad.join('\n        '));
          h.equal(out.afterImport.pwned, null, 'a payload executed in the document after the import');
          h.deepEqual(out.afterImport.bad, [], 'the imported text reached the document as markup:\n        ' +
            out.afterImport.bad.join('\n        '));

          // Those say "nothing was found", which is only worth something if the detector would have
          // found something: the canary is the same detector on markup that was parsed, and it has to
          // report a problem, while the same characters as text report none.
          h.ok(out.detector.onMarkup > 0,
            'the detector reported no problem on markup built by parsing — the checks above prove nothing');
          h.equal(out.detector.onText, 0,
            'the detector reported a problem on ordinary text, so the checks above would fail on a safe document');

          // And last, that it arrived as text at all. Without these the whole file passes on a
          // document with nothing in it.
          h.ok(out.heldTitle.indexOf('<img') === 0, 'the trip title did not survive the import: ' + h.truncate(out.heldTitle, 80));
          h.ok(out.afterImport.text.indexOf('<img src=x onerror="window.__pwned=1">') !== -1,
            'the hostile text is not in the rendered document at all, so nothing above is being tested');
          h.ok(out.dialogText.indexOf('<img') !== -1, 'the confirmation dialog did not show the title as text');

          // The ids again, from the other side: they went into the model intact (above) and never out
          // into an attribute that could break out of its quotes. A value that closed an attribute
          // would leave the document looking untouched to every check above this one.
          h.ok(out.afterImport.html.indexOf('onmouseover="window.__pwned=16"') === -1,
            'a trip id closed its attribute and became a handler');
          h.ok(out.afterImport.html.indexOf('<svg onload') === -1, 'a day id became markup');
        } finally {
          page.close();
          await server.close();
        }
      },
    },

    {
      name: 'hostile text is not escaped into the data: it round-trips out through trip-data.json',
      run: async function () {
        var server = await browser.serve();
        var page = await browser.visit({ origin: server.origin });
        try {
          var out = await page.evaluate(async function (trip) {
            // Import through the same path as the test above, then export the trip the app now holds
            // and compare the two. An app that sanitized by HTML-escaping would pass every DOM check
            // above and corrupt every document it touched.
            var file = new File([JSON.stringify(trip)], 'hostile.json', { type: 'application/json' });
            var result = await TP.io.import.readFile(file);
            if (!result.ok) return { ok: false, reason: result.reason };
            TP.store.init(TP.container.create({ trip: result.trip },
              { appVersion: 'test', appHash: '', generatedAt: '2026-01-01T00:00:00.000Z' }), TP.storage.create('memory'));

            var wire = TP.tripdatajson.fromTrip(TP.store.trip());
            var back = TP.tripdatajson.toTrip(TP.model.clone(wire));
            return {
              ok: true,
              wireTitle: wire.trip.title,
              backTitle: back.title,
              wireDayId: wire.days[0].id,
              backDayId: back.days[0].id,
              wireItemId: wire.days[0].items[0].id,
              backItemId: back.days[0].items[0].id,
              wireDay: wire.days[0].title,
              backDay: back.days[0].title,
            };
          }, [hostileTrip()]);

          h.ok(out.ok, 'the hostile file was not read: ' + (out.reason || ''));
          // Byte for byte, not merely "contains no &lt;": a title written as `&lt;img …&gt;` would
          // pass a markup check and be a different document from the one that came in.
          h.equal(out.wireTitle, HOSTILE[0], 'the trip title was altered on the way out');
          h.equal(out.backTitle, HOSTILE[0], 'the trip title was altered on the way back in');
          h.equal(out.wireDay, HOSTILE[8], 'a day title was altered by the round trip');
          h.equal(out.backDay, HOSTILE[8], 'a day title was altered on the way back in');
          h.equal(out.backDayId, out.wireDayId, 'a day id did not survive trip-data.json');
          h.equal(out.backItemId, out.wireItemId, 'an item id did not survive trip-data.json');
          h.ok(out.wireTitle.indexOf('&lt;') === -1 && out.wireTitle.indexOf('&amp;') === -1,
            'the export HTML-escaped the data it was given');
        } finally {
          page.close();
          await server.close();
        }
      },
    },

    {
      name: 'the render seam treats every value as text, and every attribute as an attribute',
      run: async function () {
        var server = await browser.serve();
        var page = await browser.visit({ origin: server.origin });
        try {
          // The seam itself, rather than one path through it: `el` and `mount` are what every view in
          // the app is built from, so a hole here is a hole everywhere and a hole nowhere else is
          // something this file's other tests already look at.
          var out = await page.evaluate(function (values) {
            var probe = document.createElement('div');
            document.body.appendChild(probe);
            var results = [];

            values.forEach(function (v, i) {
              var el = TP.ui.render.el('div', { class: 'probe', 'data-id': v, title: v }, [v]);
              TP.ui.render.mount(probe, [el]);
              var made = probe.querySelector('.probe');
              results.push({
                i: i,
                text: made.textContent,
                dataId: made.getAttribute('data-id'),
                title: made.getAttribute('title'),
                attributes: made.attributes.length,
                children: made.children.length,
                // What the value would be if it had been written as markup. Nothing should ever
                // change this, but recording it makes the assertion below legible in a failure.
                html: probe.innerHTML.length,
              });
            });

            // `mount` clears what was there, so a stale render cannot be mistaken for a clean one.
            TP.ui.render.mount(probe, []);
            var empty = probe.childNodes.length;
            probe.remove();
            return { results: results, empty: empty };
          }, [HOSTILE]);

          h.equal(out.empty, 0, 'mount did not clear the node it was given');
          out.results.forEach(function (r) {
            var v = HOSTILE[r.i];
            h.equal(r.text, v, 'value ' + r.i + ' did not arrive as text');
            h.equal(r.dataId, v, 'value ' + r.i + ' did not arrive as an attribute value');
            h.equal(r.title, v, 'value ' + r.i + ' did not arrive as a title attribute');
            // Three attributes, and no children: a value that had been parsed as markup would have
            // produced a child element and would have been dropped from the text.
            h.equal(r.attributes, 3, 'value ' + r.i + ' produced ' + r.attributes + ' attributes, not 3 — the value escaped its attribute');
            h.equal(r.children, 0, 'value ' + r.i + ' created ' + r.children + ' child element(s) — it was parsed as markup');
          });
        } finally {
          page.close();
          await server.close();
        }
      },
    },
  ],
};
