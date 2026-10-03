// The lossiness ledger (specs/06-interchange.md §3, REQ-511, REQ-512, REQ-809).
//
// Written BEFORE the mappers — PATTERN.md §8.1 step 3 — so that "did we forget a field?" is a
// mechanical check rather than a matter of opinion.
//
//   M  mapped        round-trips with the same meaning
//   F  folded        represented, but combined with other fields; un-folded on import
//   D  dropped       not representable in that format. DISCLOSED at export
//   P  passthrough   preserved verbatim in a bag (x), never interpreted
//
// There is no M on the iCalendar side for anything with no VEVENT counterpart, and every D
// is a disclosure obligation rather than a silent omission.
//
// The rows below are `specs/06-interchange.md` §3's tables. They are written in the same order,
// with the same field names and the same classifications and the same notes, because that table
// IS the ledger: a reviewer comparing the two should find them identical, and anything that
// differs is a decision someone made in code and never wrote down. Rows marked `[extension]` are
// the ones the spec's tables do not name — the passthrough bags on the entities §3 names no bag
// for, and the sub-fields §3 classifies with an "M / D" slash that a single classification cannot
// express.

TP.ledger = (function () {
  'use strict';

  var M = 'mapped';
  var F = 'folded';
  var D = 'dropped';
  var P = 'passthrough';

  // §3.1 Trip-level.
  var TRIP = [
    { field: 'trip.id', json: M, ical: P, note: 'iCalendar has no trip-level id. On .ics import a docId is minted' },
    { field: 'trip.docId', json: D, ical: D, note: 'Document identity, not trip content. Never exported (REQ-211)' },
    { field: 'trip.title', json: M, ical: M, note: 'X-WR-CALNAME, and each SUMMARY carries the item title' },
    { field: 'trip.subtitle', json: M, ical: D },
    { field: 'trip.currency', json: M, ical: D, note: 'Synthesized as USD when absent (03-data-model.md §7)' },
    { field: 'trip.startDate', json: M, ical: D, note: 'Derivable from the earliest VEVENT; derived on import, never stored from the .ics' },
    { field: 'trip.endDate', json: M, ical: D, note: 'Derivable from the latest VEVENT; derived on import, never stored from the .ics' },
    { field: 'trip.destinations[]', json: M, ical: D },
    { field: 'trip.travelers[]', json: M, ical: F, note: 'Folded into ATTENDEE where an email exists; the names travel in X-TP-TRAVELERS, one per line, which restores order too. Un-folding is best-effort: two travellers with the same name and only one address come back paired the other way round' },
    { field: 'trip.travelers[].id', json: M, ical: D, note: '[extension] a calendar identifies a traveller by name and address, never by an id, so it is derived on import from the position and name the calendar gave' },
    { field: 'trip.travelers[].type', json: M, ical: D, note: '[extension] ATTENDEE has no field for it' },
    { field: 'trip.vehicle', json: M, ical: D, note: 'All six fields. Disclosed. EV planning has no calendar representation' },
    // The bags (REQ-205–REQ-207). Each bag is keyed by the format its fields came from, so each
    // format's column states what THAT format does with the bag — which is why the pairs below
    // differ: `trip-data.json` is the format that carries the calendar's bag on the wire
    // (06-interchange.md §3.2, §3.5), and a calendar line has nowhere to put a JSON bag.
    { field: 'trip.x.iCal', json: M, ical: P, note: '[extension] unmodelled trip-level calendar properties; on trip-data.json they ride in the carrier bag' },
    { field: 'trip.x.tripDataJson', json: P, ical: D, note: '[extension] trip-level wire fields the model does not name. A calendar cannot carry a JSON bag, so this is disclosed' },
    { field: 'trip.vehicle.x.iCal', json: M, ical: D, note: '[extension] the vehicle has no calendar counterpart, so in practice this bag is empty' },
    { field: 'trip.vehicle.x.tripDataJson', json: P, ical: D, note: '[extension] same, for the JSON bag' },
  ];

  // §3.2 Days and items.
  var DAY = [
    { field: 'day.id', json: M, ical: D, note: 'Derived on import from DTSTART; the UID this app writes embeds it (03-data-model.md §3), so a day from our own file keeps its id, but a calendar carries no day id' },
    { field: 'day.date', json: M, ical: M, note: 'DTSTART / DTEND of the day’s all-day event' },
    { field: 'day.title', json: M, ical: F, note: 'Folded into that event’s SUMMARY' },
    { field: 'day.stay', json: M, ical: F, note: 'Folded into a `Stay: …` line of DESCRIPTION. A value containing a line break does not survive the fold' },
    { field: 'day.drive', json: M, ical: F, note: 'Folded into a `Drive: …` line of DESCRIPTION. Same line limit' },
    { field: 'day.chargeStops', json: M, ical: F, note: 'Folded into a `Charge stops: …` line of DESCRIPTION. Same line limit' },
    { field: 'day.nacs', json: M, ical: F, note: 'Folded into a `NACS: …` line of DESCRIPTION. Same line limit' },
    { field: 'day.summary', json: M, ical: F, note: 'Folded into a `Summary: …` line of DESCRIPTION. Same line limit' },
    { field: 'day.dining[]', json: M, ical: F, note: 'Folded into a `Dining: …` line of DESCRIPTION, joined with `; ` and split on `;` — so a value containing a semicolon does not survive, and neither does surrounding whitespace' },
    { field: 'day.tips[]', json: M, ical: F, note: 'Folded into a `Tips: …` line of DESCRIPTION, joined with `; ` and split on `;`. Same limits as dining' },
    { field: 'day.x.iCal', json: M, ical: P, note: '[extension] the day event’s UID, and any property on it the model does not name — a VALARM among them, kept whole. ATTENDEE is not here: it folds into trip.travelers[] and is written back from the model' },
    { field: 'day.x.tripDataJson', json: P, ical: D, note: '[extension] day-level wire fields the model does not name' },
  ];

  var ITEM = [
    { field: 'item.id', json: M, ical: P, note: 'The UID is derived from it (03-data-model.md §3) and stored in x.iCal — unless it is the UID this app derived, which is a function of the id and is not kept twice' },
    { field: 'item.title', json: M, ical: M, note: '`activity` on the wire; `SUMMARY` in the calendar' },
    { field: 'item.time', json: M, ical: M, note: '`time` on the wire; the DTSTART time in the calendar' },
    { field: 'item.timeRaw', json: M, ical: D, note: 'The original unparsed string. Disclosed. Written back when it parses to the item’s own time; a raw this format cannot read is written as it stands, and comes back as the raw' },
    { field: 'item.type', json: M, ical: D, note: 'Not a VEVENT concept. Disclosed. Derived from the flags, never carried by the wire' },
    { field: 'item.location', json: M, ical: M, note: 'LOCATION' },
    { field: 'item.cost', json: M, ical: D, note: 'Disclosed. A non-numeric cost is kept verbatim in the bag and written back' },
    { field: 'item.currency', json: M, ical: D },
    { field: 'item.durationMin', json: M, ical: F, note: 'Folded into DTEND − DTSTART' },
    { field: 'item.confirmation', json: M, ical: F, note: 'Folded into DESCRIPTION as a leading `Confirmation: …` line, so a note whose own first line reads that way is read as one on the way back in' },
    { field: 'item.link', json: M, ical: M, note: '`URL` in the calendar, and carried only when the value is already an absolute URL this app would use verbatim. The link field takes any text and a `URL` property must be a URI (§3.2), so a value that is not one stays on the item — `trip-data.json` keeps it, the calendar does not carry it' },
    { field: 'item.notes', json: M, ical: M, note: '`desc` on the wire; `DESCRIPTION` in the calendar' },
    { field: 'item.flags', json: M, ical: D, note: 'The flag keys (charge, overnight, tour, warn, minSoc, minSocCritical). Disclosed. Unrepresentable in a calendar' },
    { field: 'item.x.iCal', json: M, ical: P, note: 'Unmodelled VEVENT properties: VALARM, RRULE, ORGANIZER, SEQUENCE, STATUS, GEO, CATEGORIES, CLASS, TRANSP, PRIORITY, CREATED, LAST-MODIFIED. ATTENDEE is NOT here: it is folded into trip.travelers[] and written back from the model, so bagging it as well would put two on one event. URL is not here either: `item.link` is a field of the model, so a URL goes to the URL line rather than to the bag' },
    { field: 'item.x.tripDataJson', json: P, ical: D, note: '[extension] item-level wire fields the model does not name' },
  ];

  // §3.3 Collections. A row naming a whole collection covers every field beneath it — the mappers
  // copy those fields verbatim — so the rows below are as coarse as the spec’s table, with a finer
  // row only where the spec itself writes an "M / D" slash.
  var COLLECTIONS = [
    { field: 'lodging[]', json: M, ical: D, note: 'All seven fields. Disclosed. A lodging stay is not an itinerary entry in this model' },
    { field: 'reservations[]', json: M, ical: D, note: 'All eight trip-data.json fields. Disclosed' },
    { field: 'reservations[].done', json: M, ical: D, note: 'On the wire `done: false` is written as an absent key; both mean not done' },
    { field: 'noReservationNeeded[]', json: M, ical: D, note: 'Both fields. Disclosed' },
    { field: 'preTripActions[]', json: M, ical: D, note: 'All four fields. Disclosed' },
    { field: 'preTripActions[].done', json: M, ical: D, note: 'Same convention as reservations: false is written as an absent key' },
    { field: 'bucketList[]', json: M, ical: D, note: 'All three fields. Disclosed' },
    { field: 'chargingNetworks[]', json: M, ical: D, note: 'All six fields. Disclosed' },
    { field: 'minSocThresholds[]', json: M, ical: D, note: 'All six fields. Disclosed' },
    { field: 'locations[]', json: M, ical: D, note: 'All eight fields including the nested activities[]. Disclosed' },
    { field: 'contacts[]', json: M, ical: D, note: 'Both fields. Disclosed' },
    { field: 'keyTips[]', json: M, ical: F, note: 'Folded into X-WR-CALDESC, one tip per line. An empty tip does not survive, and neither does a tip containing a line break' },
    { field: 'criticalAlerts[]', json: M, ical: D, note: 'All three fields. Disclosed. A VALARM is not an alert here — it is an alarm on an event, and conflating them would be the "folded" category used dishonestly' },
    { field: 'checklists[]', json: M, ical: D, note: 'The wire shape is {category: string[]}. Disclosed' },
    { field: 'checklists[].id', json: D, ical: D, note: 'That shape has nowhere to put an id, so import mints a fresh one' },
    { field: 'checklists[].items[].id', json: D, ical: D, note: 'Same wire shape, same reason: the element is a bare string' },
    { field: 'checklists[].items[].done', json: D, ical: D, note: 'The format has no place for it. This is today’s behaviour (app/io.js:235) made explicit' },
    { field: 'budgetEstimates[]', json: M, ical: D, note: 'All four fields. Disclosed' },
    { field: 'budget.categories', json: D, ical: D, note: 'Derived, never stored (03-data-model.md §2.3)' },
    { field: 'expenses[]', json: M, ical: D, note: 'All five fields. Disclosed' },
  ];

  function entries() {
    return TRIP.concat(DAY, ITEM, COLLECTIONS);
  }

  function forFormat(format) {
    var key = format === 'ical' ? 'ical' : 'json';
    return entries().map(function (e) {
      return { field: e.field, kind: e[key], note: e.note || '' };
    });
  }

  // Everything the format cannot carry, in the order the ledger declares it. This is what the
  // export dialog shows (06-interchange.md §3.4) — the disclosure is generated from the
  // ledger, so it cannot drift from it.
  function disclosures(format) {
    var key = format === 'ical' ? 'ical' : 'json';
    return entries()
      .filter(function (e) { return e[key] === D; })
      .map(function (e) { return { field: e.field, note: e.note || '' }; });
  }

  // The ledger's classification of one RUNTIME path (`days[0].items[0].title`).
  //
  // Resolution is exact match first, then the LONGEST declared field that bounds the path on a
  // segment boundary. The second rule is what lets the ledger stay as coarse as the spec's tables
  // while still classifying every path the model can emit: `item.flags` covers `item.flags.charge`,
  // `lodging[]` covers `lodging[0].location`, `trip.vehicle` covers `trip.vehicle.model`. Without
  // it, mirroring the spec’s rows literally would report every field beneath a collection as
  // unclassified — and a completeness check that can only pass when the ledger is written in some
  // other dialect is one that gets turned off.
  //
  // `null` means the ledger says nothing about the path — which is exactly what a completeness
  // failure IS. One function, so the completeness check and a test asking "what does the ledger
  // call this?" can never disagree about what the ledger says.
  //
  // It takes a runtime path, not a ledger path: `ledgerPath` is applied here, so passing an
  // already-translated path would translate it twice.
  function kindOf(runtimePath, format) {
    var key = format === 'ical' ? 'ical' : 'json';
    var p = ledgerPath(runtimePath);
    var list = entries();
    var i;

    for (i = 0; i < list.length; i++) if (list[i].field === p) return list[i][key];

    var best = null;
    var bestLen = -1;
    for (i = 0; i < list.length; i++) {
      var f = list[i].field;
      // `a.b.*` is a declared wildcard: it covers anything below `a.b.`, at any depth.
      var star = f.slice(-2) === '.*';
      var prefix = star ? f.slice(0, -1) : f;
      if (prefix.length <= bestLen) continue;
      if (p.length <= prefix.length) continue;
      if (p.slice(0, prefix.length) !== prefix) continue;
      // A declared field bounds whole segments only: `day.date` must not cover `day.datex`.
      if (!star) {
        var next = p.charAt(prefix.length);
        if (next !== '.' && next !== '[' && next !== '@') continue;
      }
      bestLen = prefix.length;
      best = list[i][key];
    }
    return best;
  }

  // Mechanical completeness (REQ-809): every canonical field path the model can emit must be
  // classified for both formats. The test suite feeds a maximally populated trip through
  // TP.model and asserts every resulting path is present here.
  //
  // The two sets of paths are written in different dialects, and that is not an accident: the
  // ledger names what a MAPPER writes (`item.title`, because a mapper writes one item), while a
  // walk over a payload names where a value SITS (`days[0].items[0].title`). Comparing them
  // literally reports every field as missing, which is how a completeness check comes to be
  // turned off. So the runtime path is translated into the ledger's dialect first.
  var COLLECTION_NAMES = (function () {
    var names = [];
    var list = COLLECTIONS;
    for (var i = 0; i < list.length; i++) {
      var name = String(list[i].field).split(/[[.]/)[0];
      if (name && names.indexOf(name) === -1) names.push(name);
    }
    return names;
  })();

  function ledgerPath(runtimePath) {
    var p = String(runtimePath).replace(/\[\d+\]/g, '[]');
    var m = /^days\[\]\.items\[\]\.(.*)$/.exec(p);
    if (m) return 'item.' + m[1];
    m = /^days\[\]\.(.*)$/.exec(p);
    if (m) return 'day.' + m[1];
    m = /^(destinations|travelers)\[\]\.(.*)$/.exec(p);
    if (m) return 'trip.' + m[1] + '[].' + m[2];
    m = /^vehicle\.(.*)$/.exec(p);
    if (m) return 'trip.vehicle.' + m[1];
    for (var i = 0; i < COLLECTION_NAMES.length; i++) {
      var n = COLLECTION_NAMES[i];
      if (p === n || p.indexOf(n + '.') === 0 || p.indexOf(n + '[') === 0) return p;
    }
    return 'trip.' + p;
  }

  // The completeness check, which is now nothing but "the ledger has something to say about this
  // path" for both formats. Every rule about coarse rows lives in `kindOf`, so a test that asks the
  // ledger what it calls a path cannot get a different answer from the check that enforces it.
  function check(paths) {
    var missing = [];
    for (var j = 0; j < paths.length; j++) {
      if (kindOf(paths[j], 'json') !== null) continue;
      if (kindOf(paths[j], 'ical') !== null) continue;
      missing.push(paths[j]);
    }
    return { ok: missing.length === 0, missing: missing };
  }

  return {
    ledgerPath: ledgerPath,
    MAPPED: M,
    FOLDED: F,
    DROPPED: D,
    PASSTHROUGH: P,
    TRIP: TRIP,
    DAY: DAY,
    ITEM: ITEM,
    COLLECTIONS: COLLECTIONS,
    entries: entries,
    forFormat: forFormat,
    disclosures: disclosures,
    kindOf: kindOf,
    check: check,
  };
})();
