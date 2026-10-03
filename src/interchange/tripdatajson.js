// The `trip-data.json` mapper (specs/06-interchange.md §1, §3).
//
// This is a FIRST-PARTY format, not a domain standard (ADR-0014): it is bespoke, it is the
// app's incumbent shape, and the AI agent writes into it. Treating it honestly as the app's
// own format is why its ledger column is nearly all `mapped` — the model was designed to
// follow it.
//
// The mapper is deliberately structural. Wire fields the canonical model represents are
// mapped by name; every other wire field is preserved verbatim in `x.tripDataJson` on the
// entity it came from, and re-emitted on export. That is what makes the import lossless
// (REQ-504) without a whole-document copy riding along.

TP.tripdatajson = (function () {
  'use strict';

  var ID = 'trip-data.json';
  var FORMAT = 'tripDataJson';

  // ---- Which wire fields the canonical model represents, per entity kind ----

  var TRIP_KEYS = {
    id: 1, title: 1, subtitle: 1, currency: 1, startDate: 1, endDate: 1,
    destinations: 1, travelers: 1, vehicle: 1,
  };

  var DAY_KEYS = {
    id: 1, date: 1, title: 1, stay: 1, drive: 1, chargeStops: 1, nacs: 1,
    summary: 1, dining: 1, tips: 1, items: 1,
  };

  var ITEM_KEYS = {
    id: 1, type: 1, title: 1, time: 1, timeRaw: 1, location: 1, cost: 1, currency: 1,
    durationMin: 1, confirmation: 1, link: 1, notes: 1, flags: 1,
    activity: 1, desc: 1, // the wire spellings of title / notes
    charge: 1, overnight: 1, tour: 1, warn: 1, minSoc: 1, minSocCritical: 1,
  };

  var COLLECTION_KEYS = {
    lodging: { id: 1, location: 1, checkIn: 1, checkOut: 1, area: 1, notes: 1, confirmation: 1 },
    reservations: { id: 1, what: 1, when: 1, duration: 1, cost: 1, howToBook: 1, bookBy: 1, priority: 1, done: 1 },
    noReservationNeeded: { id: 1, what: 1, notes: 1 },
    preTripActions: { id: 1, text: 1, category: 1, priority: 1, done: 1 },
    bucketList: { id: 1, name: 1, date: 1, dateLabel: 1 },
    chargingNetworks: { id: 1, name: 1, location: 1, network: 1, nacsAdapter: 1, notes: 1 },
    minSocThresholds: { id: 1, day: 1, leg: 1, minSoc: 1, reason: 1, severity: 1 },
    locations: { id: 1, name: 1, icon: 1, summary: 1, lodging: 1, charging: 1, dining: 1, activities: 1 },
    contacts: { id: 1, what: 1, how: 1 },
    criticalAlerts: { id: 1, severity: 1, title: 1, text: 1 },
    budgetEstimates: { id: 1, category: 1, item: 1, cost: 1, optional: 1 },
    expenses: { id: 1, date: 1, category: 1, amount: 1, label: 1, dayId: 1 },
  };

  var VEHICLE_KEYS = {
    model: 1, batteryKWh: 1, efficiencyMilesPerKWh: 1, fullRangeMiles: 1,
    usableRangeMiles: 1, chargingConvention: 1,
  };

  // ---- Small helpers ----

  function str(v) { return v == null ? '' : String(v); }

  function isoOrNull(v) {
    if (typeof v !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
  }

  // A TRIP-level date field as the wire carries it.
  //
  // `isoOrNull` reads the ISO form (and truncates a timestamp to its date, which is the same meaning
  // for a trip's first day). Anything else — a hand-written `May 1, 2026`, a value in another
  // convention — it cannot read, and returning null there would DROP a field the ledger calls
  // Mapped for this format in silence: REQ-809 makes M a promise that the path round-trips, and
  // REQ-504 makes it a disclosed loss or no loss at all. The schema accepts any string here
  // (`nullableString`, with no `format`), so such a file is one this app is handed rather than one
  // it can call malformed.
  //
  // So an unreadable value is kept verbatim. Nothing has to cope with it: the model's trip dates are
  // "a string or null" (src/model/trip.js), `TP.dates.parseISO` answers null for a string it cannot
  // read and every caller guards on that, and the display helper falls back to the text itself. The
  // person who wrote the field gets their own words back instead of a deletion.
  //
  // This is TRIP-level only, and deliberately. A `day.date` is structural — it is the `DTSTART` of
  // that day's event — so an unreadable one cannot be kept as text without an export that writes a
  // malformed `DTSTART`; days get the ISO form or the derivation below, never a raw string.
  function dateOrRaw(v) {
    var iso = isoOrNull(v);
    if (iso) return iso;
    return (typeof v === 'string' && v !== '') ? v : null;
  }

  function numOrUndef(v) {
    if (v == null || v === '') return undefined;
    var n = Number(v);
    return isFinite(n) ? n : undefined;
  }

  function copyUnknown(target, src, known) {
    if (!src || typeof src !== 'object') return;
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      if (known[k]) continue;
      // The reserved carrier key (see `TP.model.carryIn`): it holds the bags, by format, that this
      // format did not itself produce — including the iCalendar one. It is read below, never
      // treated as one of this format's own fields.
      if (k === 'x') continue;
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      TP.model.bagSet(target, FORMAT, k, src[k]);
    }
    TP.model.carryIn(target, src.x);
  }

  // Put an entity's bag back on the wire: this format's own fields beside the entity's fields,
  // exactly as they arrived, and the other format's bag (plus any member of this one named `x`)
  // in the carrier. The round trip through this format is then exact, which is what
  // 06-interchange.md §3.2 says for `item.x.iCal` and §3.5 says for bags generally.
  function emitUnknown(target, entity) {
    var bag = TP.model.bag(entity, FORMAT);
    if (bag) {
      for (var k in bag) {
        if (!Object.prototype.hasOwnProperty.call(bag, k)) continue;
        if (bag[k] === undefined) continue;
        if (k === 'x') continue;                 // reserved: it travels in the carrier
        target[k] = bag[k];
      }
    }
    var carried = TP.model.carryOut(entity, FORMAT);
    if (carried) target.x = carried;
  }

  // Drop a bag member before the bag is written back. An upgraded value lives in `…Raw` only while
  // the field it could not fill is absent; once a person edits that field to a real number or
  // boolean, the raw is stale and writing it beside the new value would leave two answers on the
  // wire. The entity is a clone by the time an export runs (`fromTrip`), so this mutates a copy.
  function dropBag(entity, key) {
    var bag = TP.model.bag(entity, FORMAT);
    if (bag && bag[key] !== undefined) TP.model.bagSet(entity, FORMAT, key, undefined);
  }

  function timeToHHMM(raw) {
    if (!raw) return undefined;
    var m = String(raw).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return undefined;
    var h = parseInt(m[1], 10);
    var min = m[2];
    var ap = (m[3] || '').toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return String(h).padStart(2, '0') + ':' + min;
  }

  // ---- Detection (structural markers, never the filename) ----

  function detect(root) {
    if (!root || typeof root !== 'object' || Array.isArray(root)) return false;
    var t = root.trip;
    if (t && typeof t === 'object' && !Array.isArray(t)) return true;
    return Array.isArray(root.days);
  }

  // ---- Import ----

  function toTrip(wire) {
    var w = wire && typeof wire === 'object' ? wire : {};
    var wt = w.trip && typeof w.trip === 'object' ? w.trip : {};
    var start = dateOrRaw(wt.startDate);
    var end = dateOrRaw(wt.endDate);

    var trip = {
      id: TP.uid(),
      docId: '',
      // A title the file DOES carry is kept as it stands, even when it is empty: the schema's `text`
      // has no minimum, `fromTrip` writes the title unconditionally, and the ledger calls it mapped —
      // so a person who blanked the title would otherwise find "Imported trip" in their file. The
      // fallback is for a file that carries no title at all.
      title: wt.title == null ? 'Imported trip' : str(wt.title),
      subtitle: str(wt.subtitle),
      currency: str(wt.currency) || 'USD',
      startDate: start,
      endDate: end,
      destinations: [],
      travelers: [],
    };

    // The trip's own identity is on the wire and comes back with it, so `trip.id` is M in the
    // ledger rather than a fresh id per import.
    if (wt.id != null && wt.id !== '') trip.id = String(wt.id);

    // Every trip-level wire field the model does not name is preserved (REQ-504) — today's mapper
    // drops them, which is a silent loss this line is what removes. Without it, `wt` is read field
    // by field and anything else the file carried simply disappears on import.
    copyUnknown(trip, wt, TRIP_KEYS);

    // Destinations: the wire allows bare strings, and older files carried none at all and
    // derived them from locations[]. Both are handled, and the second is derived, not stored.
    if (Array.isArray(wt.destinations) && wt.destinations.length) {
      trip.destinations = wt.destinations
        .map(function (d, i) {
          if (typeof d === 'string') return { id: TP.model.derivedId('dest', i, d), name: d };
          if (d && typeof d === 'object') {
            var dest = { id: d.id || TP.model.derivedId('dest', i, d.name), name: str(d.name) };
            copyUnknown(dest, d, { id: 1, name: 1 });
            return dest;
          }
          return null;
        })
        .filter(function (d) { return d && (d.name || d.x); });
    } else {
      trip.destinations = (Array.isArray(w.locations) ? w.locations : [])
        .map(function (l, i) { return l && l.name ? { id: TP.model.derivedId('dest', i, l.name), name: String(l.name) } : null; })
        .filter(Boolean);
    }
    // The placeholder a trip with no destinations gets. Its id is derived rather than minted so
    // that the round trip is a fixed point: a nameless destination is dropped from the wire on
    // export (there is nothing to write), so an id minted at random here would change on every
    // import and make the round trip differ on a field no format can carry.
    if (!trip.destinations.length) trip.destinations = [{ id: TP.model.derivedId('dest', 0, ''), name: '' }];

    if (Array.isArray(wt.travelers) && wt.travelers.length) {
      trip.travelers = wt.travelers.map(function (x, i) {
        if (typeof x === 'string') return { id: TP.model.derivedId('person', i, x), name: x, type: 'adult' };
        var person = {
          id: (x && x.id) || TP.model.derivedId('person', i, x && x.name),
          name: str(x && x.name),
          type: (x && x.type) || 'adult',
        };
        // A traveller's bag too: an `.ics` import puts the traveller's EMAIL here, and a trip that
        // became a calendar and came back has to still have it (06-interchange.md §3.1).
        copyUnknown(person, x, { id: 1, name: 1, type: 1 });
        return person;
      });
    } else {
      // The placeholder for a trip the file gives no travellers. Derived, not minted, for the same
      // reason as the destination above: this format cannot write a nameless traveller, so the
      // entity is re-created here on every import and a random id would make each import differ
      // from the last on a field nothing on the wire carries.
      trip.travelers = [{ id: TP.model.derivedId('person', 0, ''), name: '', type: 'adult' }];
    }

    if (wt.vehicle && typeof wt.vehicle === 'object') {
      var v = {
        model: str(wt.vehicle.model),
        batteryKWh: numOrUndef(wt.vehicle.batteryKWh),
        efficiencyMilesPerKWh: numOrUndef(wt.vehicle.efficiencyMilesPerKWh),
        fullRangeMiles: numOrUndef(wt.vehicle.fullRangeMiles),
        usableRangeMiles: numOrUndef(wt.vehicle.usableRangeMiles),
        chargingConvention: wt.vehicle.chargingConvention != null ? str(wt.vehicle.chargingConvention) : undefined,
      };
      copyUnknown(v, wt.vehicle, VEHICLE_KEYS);
      trip.vehicle = v;
    }

    // Days: use the wire's days when present, so a file whose days do not line up with its
    // dates is preserved rather than silently re-expanded.
    var wireDays = Array.isArray(w.days) ? w.days : [];
    if (wireDays.length) {
      trip.days = wireDays.map(function (d, i) { return toDay(d, i, start); });
    } else {
      trip.days = TP.dates.expandDays(start, end);
    }

    for (var c = 0; c < TP.model.COLLECTIONS.length; c++) {
      var key = TP.model.COLLECTIONS[c];
      var known = COLLECTION_KEYS[key] || {};
      var arr = Array.isArray(w[key]) ? w[key] : [];
      trip[key] = arr.map(function (item) {
        var out = { id: (item && item.id) || TP.uid() };
        copyKnown(out, item, known);
        if (key === 'preTripActions' || key === 'reservations') out.done = !!(item && item.done);
        if (key === 'expenses') {
          if (!out.category) out.category = 'General';
          // `expense.amount` is `stringOrNumber` in the vendored schema, so "$45.50" is a VALID
          // expense and the ledger lists the field as mapped and disclosed. `numOrUndef(...) || 0`
          // turned every such figure into the number 0 — the person's own amount, destroyed on
          // import and never mentioned. A non-numeric amount is kept VERBATIM instead, which is what
          // `fromTrip`'s rescue pass writes back; an amount that is absent or empty still becomes 0,
          // as it did before.
          var amount = numOrUndef(out.amount);
          out.amount = amount !== undefined ? amount
            : (out.amount == null || String(out.amount).trim() === '' ? 0 : String(out.amount));
        }
        copyUnknown(out, item, known);
        return out;
      });
    }

    trip.keyTips = Array.isArray(w.keyTips) ? w.keyTips.map(str) : [];

    // checklists: the wire shape is {category: string[]}. `done` has no place there, so it
    // starts false; it is the one field this format drops, and the ledger says so.
    trip.checklists = [];
    var rawCl = w.checklists;
    if (Array.isArray(rawCl)) {
      trip.checklists = rawCl.map(function (c) {
        if (typeof c === 'string') return { id: TP.uid(), category: c, items: [] };
        if (Array.isArray(c)) return { id: TP.uid(), category: 'General', items: c.map(newCheckItem) };
        return {
          id: (c && c.id) || TP.uid(),
          category: str(c && c.category) || 'General',
          items: (Array.isArray(c && c.items) ? c.items : []).map(newCheckItem),
        };
      });
    } else if (rawCl && typeof rawCl === 'object') {
      for (var cat in rawCl) {
        if (!Object.prototype.hasOwnProperty.call(rawCl, cat)) continue;
        if (cat === '__proto__' || cat === 'constructor' || cat === 'prototype') continue;
        var items = Array.isArray(rawCl[cat]) ? rawCl[cat] : [];
        trip.checklists.push({
          id: TP.uid(),
          category: cat,
          items: items.map(newCheckItem),
        });
      }
    }

    trip = TP.model.normalize(trip);
    return trip;
  }

  function newCheckItem(text) {
    return { id: TP.uid(), text: str(text), done: false };
  }

  // Copy every declared canonical field that the wire actually carries. A field the wire
  // omits stays undefined rather than becoming an empty string, so an unedited import does
  // not grow fields it never had.
  function copyKnown(target, src, known) {
    if (!src || typeof src !== 'object') return;
    for (var k in known) {
      if (!Object.prototype.hasOwnProperty.call(known, k)) continue;
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      var v = src[k];
      target[k] = (v && typeof v === 'object') ? TP.model.clone(v) : v;
    }
  }

  function toDay(d, i, fallbackStart) {
    var src = d && typeof d === 'object' ? d : {};
    var date = isoOrNull(src.date);
    if (!date && fallbackStart) {
      // A day with no date of its own, in a file whose trip does have a start: the date is the
      // start plus the day's index, which is the same derivation `expandDays` makes when the file
      // has no days at all (line 223). It invents nothing the file does not already say.
      //
      // No clock is read here. `fallbackStart` is `isoOrNull(wt.startDate)` (line 133), so it is
      // always `YYYY-MM-DD` or null, and `parseISO` accepts exactly that shape — the `|| new Date()`
      // this used to carry was unreachable. It was removed rather than left as a harmless default:
      // "today" is not derivable from the file, and a reader auditing whether importing a document
      // can produce a different result on a different day should not have to prove a branch is dead
      // to answer. A start that somehow did not parse now leaves the day undated, which is the
      // honest rendering of a file that does not say.
      var base = TP.dates.parseISO(fallbackStart);
      if (base) date = TP.dates.toISO(TP.dates.addDays(base, i));
    }
    var day = {
      id: src.id || ('day-' + i + '-' + (date || i)),
      date: date,
      title: str(src.title),
      stay: str(src.stay),
      drive: str(src.drive),
      chargeStops: str(src.chargeStops),
      nacs: str(src.nacs),
      summary: str(src.summary),
      dining: Array.isArray(src.dining) ? src.dining.map(str) : [],
      tips: Array.isArray(src.tips) ? src.tips.map(str) : [],
      items: (Array.isArray(src.items) ? src.items : []).map(toItem),
    };
    copyUnknown(day, src, DAY_KEYS);
    return day;
  }

  function toItem(src) {
    // `timeRaw` is "the original unparsed string" the wire carried. A wire that carries the
    // canonical `HH:MM` form carries nothing raw, and storing it as a raw would hand the model a
    // field the file never had — one more path a round trip would differ on for no reason. So the
    // raw is kept only when it says something the parsed form does not.
    var rawTime = src && src.time != null ? String(src.time) : undefined;
    var it = {
      id: (src && src.id) || TP.uid(),
      title: str(src && (src.title != null ? src.title : src.activity)) || 'Untitled',
      time: timeToHHMM(rawTime),
      timeRaw: rawTime !== undefined && timeToHHMM(rawTime) !== rawTime ? rawTime : undefined,
      location: src && src.location != null ? str(src.location) : undefined,
      cost: src ? TP.format.parseCost(src.cost) : undefined,
      currency: src && src.currency != null ? str(src.currency) : undefined,
      durationMin: numOrUndef(src && src.durationMin),
      confirmation: src && src.confirmation != null ? str(src.confirmation) : undefined,
      link: src && src.link != null ? str(src.link) : undefined,
      notes: src && (src.notes != null || src.desc != null) ? str(src.notes != null ? src.notes : src.desc) : '',
      type: 'activity',
    };
    // The flags are read from BOTH spellings the schema allows: the flat keys this format writes
    // (`charge`, `minSoc`, …) and a nested `flags` object, which `item.flags` types as an object and
    // which the ledger lists as mapped. Reading only the flat ones dropped a valid nested `flags`
    // whole — and since `flags` is in ITEM_KEYS, `copyUnknown` skipped it as known, so the value was
    // neither mapped nor bagged: the charge stop disappeared and `itemType` derived 'activity'.
    var flat = (src && src.flags && typeof src.flags === 'object') ? src.flags : {};
    function flag(key) { return (src && src[key] != null) ? src[key] : flat[key]; }

    var flags = {};
    if (flag('charge')) flags.charge = true;
    if (flag('overnight')) flags.overnight = true;
    if (flag('tour')) flags.tour = true;
    if (flag('warn')) flags.warn = true;
    if (flag('minSoc') != null) flags.minSoc = numOrUndef(flag('minSoc'));
    if (flag('minSocCritical')) flags.minSocCritical = true;
    if (Object.keys(flags).length) it.flags = flags;

    // A non-numeric wire cost is preserved so the export can reproduce it verbatim.
    if (src && src.cost != null && typeof src.cost !== 'number') {
      TP.model.bagSet(it, FORMAT, 'costRaw', String(src.cost));
    }
    copyUnknown(it, src, ITEM_KEYS);
    it.type = TP.model.itemType(it);
    return it;
  }

  // ---- The incumbent generation, upgraded (ADR-0019) ----
  //
  // `trip-data.json` carries no version marker, and the vendored schema is written against THIS
  // generation's types. The retired app (`app/io.js`) wrote an older one: numeric day ids, numeric
  // `chargeStops`, boolean `nacs`, and free text where this generation types a number or a boolean.
  // Handed that file, `check('tripdata', …)` refuses it 48 times — and an app whose validator rejects
  // a file its own detector accepts has two answers to one question — while mapping it WITHOUT
  // validating silently DROPS a `minSoc` this generation has no type for.
  //
  // So the older generation is upgraded to this one BEFORE validation. Recognition is by SHAPE, never
  // by a marker the file does not carry: a document is generation 1 when it shows a value THIS
  // generation's exporter cannot write. `chargingNetworks[].nacsAdapter` is deliberately not one of
  // those signals — a lone non-boolean there is the hostile-input case the validator should still
  // refuse, and a real generation-1 file carries a day-level signal anyway.
  //
  // Every coercion moves a value into THIS generation's type or into an unmodelled `…Raw` key beside
  // it. The schema is open, so an unknown key validates; the key tables below do not name it, so
  // `copyUnknown` bags it and `emitUnknown` writes it back. Nothing is invented and nothing is lost.

  var PREVIOUS_GENERATION = '1.0.0';

  var UNSAFE_KEYS = { __proto__: 1, constructor: 1, prototype: 1 };

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function numericString(v) {
    return typeof v === 'string' && v !== '' && isFinite(Number(v));
  }

  // Shallow copy that keeps the wire's key order and skips the three names a hostile file uses to
  // reach a prototype (`REQ-503`). Subtrees this pass does not touch are shared with the input.
  function copyShallow(src) {
    var out = {};
    if (!isObject(src)) return out;
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      if (UNSAFE_KEYS[k]) continue;
      out[k] = src[k];
    }
    return out;
  }

  // The first shape this generation cannot write, or null. Named so a failure says which.
  function generationMarker(w) {
    var days = Array.isArray(w.days) ? w.days : [];
    for (var i = 0; i < days.length; i++) {
      var d = days[i];
      if (!isObject(d)) continue;
      if (typeof d.id === 'number') return 'days[].id';
      if (typeof d.chargeStops === 'number') return 'days[].chargeStops';
      if (typeof d.nacs === 'boolean') return 'days[].nacs';
      var items = Array.isArray(d.items) ? d.items : [];
      for (var j = 0; j < items.length; j++) {
        if (isObject(items[j]) && typeof items[j].minSoc === 'string') return 'days[].items[].minSoc';
      }
    }
    var thresholds = Array.isArray(w.minSocThresholds) ? w.minSocThresholds : [];
    for (var t = 0; t < thresholds.length; t++) {
      if (isObject(thresholds[t]) && typeof thresholds[t].minSoc === 'string') return 'minSocThresholds[].minSoc';
    }
    return null;
  }

  // `minSoc` in place on a copied entity: a numeric string becomes the number, text this generation
  // cannot read moves beside the entity as `minSocRaw` — the same treatment a non-numeric `cost`
  // gets in `toItem`, so a value the wire spelled in prose survives instead of being dropped by
  // `numOrUndef`.
  function upgradeMinSoc(entity) {
    if (typeof entity.minSoc === 'number') return;
    if (typeof entity.minSoc !== 'string') return;
    if (numericString(entity.minSoc)) { entity.minSoc = Number(entity.minSoc); return; }
    if (entity.minSocRaw === undefined) entity.minSocRaw = entity.minSoc;
    delete entity.minSoc;
  }

  function upgradeNetwork(network) {
    var out = copyShallow(network);
    if (typeof out.nacsAdapter === 'string') {
      var word = out.nacsAdapter.toLowerCase();
      if (word === 'true') out.nacsAdapter = true;
      else if (word === 'false') out.nacsAdapter = false;
      else {
        if (out.nacsAdapterRaw === undefined) out.nacsAdapterRaw = out.nacsAdapter;
        delete out.nacsAdapter;
      }
    }
    return out;
  }

  function upgradeDay(day) {
    var out = copyShallow(day);
    if (typeof out.id === 'number') out.id = String(out.id);
    if (typeof out.chargeStops === 'number') out.chargeStops = String(out.chargeStops);
    if (typeof out.nacs === 'boolean') {
      // The text the v1 UI rendered for the flag (`app/ui/charging.js:78`); false is absent, not a
      // string saying "false" (ADR-0018).
      if (out.nacs) out.nacs = 'NACS';
      else delete out.nacs;
    }
    if (Array.isArray(day.items)) {
      out.items = day.items.map(function (item) {
        if (!isObject(item)) return item;
        var copy = copyShallow(item);
        upgradeMinSoc(copy);
        return copy;
      });
    }
    return out;
  }

  // Upgrade `wire` if it is the previous generation. Returns the value to validate and map, and
  // `from` — null when nothing was done, so a caller can say so. Idempotent: every marker is gone
  // from the result, so a second call is a no-op and returns the same value.
  function upgrade(wire) {
    if (!isObject(wire)) return { value: wire, from: null, marker: null };
    var marker = generationMarker(wire);
    if (!marker) return { value: wire, from: null, marker: null };

    var out = copyShallow(wire);
    if (Array.isArray(wire.days)) {
      out.days = wire.days.map(function (d) { return isObject(d) ? upgradeDay(d) : d; });
    }
    if (Array.isArray(wire.minSocThresholds)) {
      out.minSocThresholds = wire.minSocThresholds.map(function (t) {
        if (!isObject(t)) return t;
        var copy = copyShallow(t);
        upgradeMinSoc(copy);
        return copy;
      });
    }
    if (Array.isArray(wire.chargingNetworks)) {
      out.chargingNetworks = wire.chargingNetworks.map(function (n) { return isObject(n) ? upgradeNetwork(n) : n; });
    }
    return { value: out, from: PREVIOUS_GENERATION, marker: marker };
  }

  // ---- Export ----

  function fromTrip(trip) {
    var n = TP.model.normalize(TP.model.clone(trip));
    var out = {};

    var wt = { title: n.title };
    if (n.id) wt.id = n.id;
    if (n.startDate) wt.startDate = n.startDate;
    if (n.endDate) wt.endDate = n.endDate;
    if (n.subtitle) wt.subtitle = n.subtitle;
    if (n.currency && n.currency !== 'USD') wt.currency = n.currency;
    if (n.vehicle) {
      var v = { model: n.vehicle.model };
      if (n.vehicle.batteryKWh != null) v.batteryKWh = n.vehicle.batteryKWh;
      if (n.vehicle.efficiencyMilesPerKWh != null) v.efficiencyMilesPerKWh = n.vehicle.efficiencyMilesPerKWh;
      if (n.vehicle.fullRangeMiles != null) v.fullRangeMiles = n.vehicle.fullRangeMiles;
      if (n.vehicle.usableRangeMiles != null) v.usableRangeMiles = n.vehicle.usableRangeMiles;
      if (n.vehicle.chargingConvention) v.chargingConvention = n.vehicle.chargingConvention;
      emitUnknown(v, n.vehicle);
      out.trip = wt;
      wt.vehicle = v;
    }
    // Destinations and travellers keep the incumbent bare-name shape — a file that came in as
    // names goes out as names. An object appears only when the entity carries something a bare name
    // cannot: an identity the file itself supplied, or a bag. Inventing a field on the wire that
    // the entity does not have is what makes a round trip stop being a fixed point.
    //
    // "A bag" means either format's. Checking only this format's was a real loss: a traveller whose
    // only bag is the calendar's (`x.iCal.EMAIL`, which is where an `.ics` import puts the address)
    // took the bare-name branch, and the bare name has nowhere to put a carrier — so the address was
    // gone after one trip through `trip-data.json`, which is exactly the case this comment said the
    // bag was here to prevent. `carryOut` is what the object branch would have written, so asking it
    // is asking the same question the branch below is about to answer.
    var dests = (n.destinations || []).filter(function (d) { return d && d.name; });
    if (dests.length) {
      wt.destinations = dests.map(function (d, i) {
        var named = d.id === TP.model.derivedId('dest', i, d.name);
        if (named && !TP.model.bag(d, FORMAT) && !TP.model.carryOut(d, FORMAT)) return d.name;
        var o = { name: d.name };
        if (!named) o.id = d.id;
        emitUnknown(o, d);
        return o;
      });
    }
    var travelers = (n.travelers || []).filter(function (t) { return t && t.name; });
    if (travelers.length) {
      wt.travelers = travelers.map(function (t, i) {
        var named = t.id === TP.model.derivedId('person', i, t.name);
        var adult = !t.type || t.type === 'adult';
        if (named && adult && !TP.model.bag(t, FORMAT) && !TP.model.carryOut(t, FORMAT)) return t.name;
        var o = { name: t.name };
        if (!named) o.id = t.id;
        if (!adult) o.type = t.type;
        emitUnknown(o, t);
        return o;
      });
    }
    emitUnknown(wt, n);
    out.trip = wt;

    out.days = (n.days || []).map(fromDay);

    for (var c = 0; c < TP.model.COLLECTIONS.length; c++) {
      var key = TP.model.COLLECTIONS[c];
      var known = COLLECTION_KEYS[key] || {};
      out[key] = (n[key] || []).map(function (item) { return fromEntity(item, known, key); });
    }

    out.keyTips = (n.keyTips || []).slice();

    // The wire shape is the incumbent `{category: string[]}` map, and the schema also accepts an
    // array of `{category, items}` entries (06-interchange.md §3.3). The map cannot hold two
    // checklists that share a name, so a trip that has two would lose a whole list here; the array
    // form is used for exactly that trip and the map for every other. An empty name and an empty
    // item are representable in both forms and are no longer dropped: the ledger lists
    // `checklists[]` as mapped and disclosed, and a silent drop is neither.
    var lists = (n.checklists || []).filter(function (c) { return !!c; });
    var seen = Object.create(null);
    var duplicated = lists.some(function (c) {
      var name = c.category || '';
      if (seen[name]) return true;
      seen[name] = true;
      return false;
    });
    if (duplicated) {
      out.checklists = lists.map(function (c) {
        return {
          category: c.category || '',
          items: (c.items || []).map(function (i) { return (i && i.text) || ''; }),
        };
      });
    } else {
      var cl = {};
      lists.forEach(function (c) {
        cl[c.category || ''] = (c.items || []).map(function (i) { return (i && i.text) || ''; });
      });
      out.checklists = cl;
    }

    out.budgetEstimates = (n.budgetEstimates || []).map(function (e) {
      var o = fromEntity(e, COLLECTION_KEYS.budgetEstimates, 'budgetEstimates');
      return o;
    });
    out.expenses = (n.expenses || []).map(function (e) {
      return fromEntity(e, COLLECTION_KEYS.expenses, 'expenses');
    });
    (n.expenses || []).forEach(function (e, i) {
      if (typeof e.amount === 'string') out.expenses[i].amount = e.amount;
    });

    return out;
  }

  function fromEntity(entity, known, collection) {
    var out = { id: entity.id };
    for (var k in known) {
      if (k === 'id') continue;
      var v = entity[k];
      if (v === undefined) continue;
      // `done: false` and an absent `done` mean the same thing on the wire.
      if (k === 'done' && !v) continue;
      out[k] = v;
    }
    if (collection === 'expenses') {
      if (!out.category) out.category = 'General';
      out.amount = Number(entity.amount) || 0;
      if (!out.label) out.label = '';
    }
    // A `…Raw` from the generation upgrade is written only while the field it stands in for is
    // absent (see `dropBag`).
    if (collection === 'minSocThresholds' && out.minSoc != null) dropBag(entity, 'minSocRaw');
    if (collection === 'chargingNetworks' && out.nacsAdapter != null) dropBag(entity, 'nacsAdapterRaw');
    // `lodging[].confirmation` reached the wire through the bag until this generation named it, so a
    // row saved by an earlier build has the old value in `x.tripDataJson.confirmation`. `emitUnknown`
    // runs AFTER the named fields above, so leaving it would let that stale copy overwrite the value
    // the person just typed — an edit silently reverted by the file it was meant to correct.
    if (collection === 'lodging' && out.confirmation != null) dropBag(entity, 'confirmation');
    emitUnknown(out, entity);
    return out;
  }

  function fromDay(day) {
    var out = { id: day.id };
    if (day.date) out.date = day.date;
    if (day.title) out.title = day.title;
    if (day.stay) out.stay = day.stay;
    if (day.drive) out.drive = day.drive;
    if (day.chargeStops) out.chargeStops = day.chargeStops;
    if (day.nacs) out.nacs = day.nacs;
    if (day.summary) out.summary = day.summary;
    out.dining = (day.dining || []).slice();
    out.tips = (day.tips || []).slice();
    out.items = (day.items || []).map(fromItem);
    emitUnknown(out, day);
    return out;
  }

  function fromItem(item) {
    // The item's id is on the wire and comes back with it. The day above it already emits its id;
    // an item that did not would lose one on every export, and `item.id` is M in the ledger.
    var out = { id: item.id };
    // `time` is the parsed form and `timeRaw` the string the wire carried, and the wire has ONE
    // slot for both. Writing the raw form back is only right when it parses to the time beside it.
    // Otherwise — an `.ics` DTSTART, say, which this mapper cannot read as a time at all — the
    // export would replace a good time with a string it cannot parse, and the time would be gone
    // on the next import. The same guard as `costRaw` below, for the same reason.
    //
    // An item with a RAW and no parsed time is one of two things, and they are told apart here: a
    // raw this format cannot read, which is written back as it stands (ledger: `item.timeRaw`), or a
    // raw that DOES parse — which is the same slot as `item.time`, so its absence means the person
    // cleared the time, and writing it back would restore the value they deleted.
    var rawTime = item.timeRaw;
    if (item.time == null) {
      if (rawTime && timeToHHMM(rawTime) === undefined) out.time = rawTime;
    } else if (rawTime && timeToHHMM(rawTime) === item.time) out.time = rawTime;
    else out.time = item.time;
    out.activity = item.title;
    if (item.notes) out.desc = item.notes;
    if (item.location) out.location = item.location;

    var bag = TP.model.bag(item, FORMAT);
    var rawCost = bag && bag.costRaw != null ? bag.costRaw : null;
    if (rawCost != null && TP.format.parseCost(rawCost) === item.cost) out.cost = rawCost;
    else if (item.cost != null) out.cost = item.cost;

    if (item.durationMin != null) out.durationMin = item.durationMin;
    if (item.currency) out.currency = item.currency;
    if (item.confirmation) out.confirmation = item.confirmation;
    if (item.link) out.link = item.link;

    var f = item.flags || {};
    if (f.charge) out.charge = true;
    if (f.overnight) out.overnight = true;
    if (f.tour) out.tour = true;
    if (f.warn) out.warn = true;
    if (f.minSoc != null) out.minSoc = f.minSoc;
    if (f.minSocCritical) out.minSocCritical = true;
    // A `minSocRaw` the generation upgrade left beside the value is written only while there is no
    // number to write (`dropBag`). `minSoc` and `minSocRaw` are two spellings of one wire slot, so a
    // person who later edits the text to a number must not leave the old prose in the file beside it.
    if (out.minSoc != null) dropBag(item, 'minSocRaw');

    emitUnknown(out, item);
    return out;
  }

  function losses() {
    return TP.ledger.disclosures('json');
  }

  return {
    ID: ID,
    FORMAT: FORMAT,
    detect: detect,
    toTrip: toTrip,
    fromTrip: fromTrip,
    upgrade: upgrade,
    PREVIOUS_GENERATION: PREVIOUS_GENERATION,
    losses: losses,
    TRIP_KEYS: TRIP_KEYS,
    DAY_KEYS: DAY_KEYS,
    ITEM_KEYS: ITEM_KEYS,
    COLLECTION_KEYS: COLLECTION_KEYS,
  };
})();
