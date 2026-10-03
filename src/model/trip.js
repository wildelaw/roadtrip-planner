// The canonical model (specs/03-data-model.md). One trip per document (REQ-201).
//
// This is the union of what `trip-data.json` and iCalendar can express, never their
// intersection (REQ-202, PAT-INV-11): where only one format has a concept, the concept still
// exists here and the other format's export discloses it as unrepresentable.
//
// Derived roll-ups are NOT canonical (03-data-model.md §2.3). `budget` is recomputed from
// `budgetEstimates` on demand; storing it beside its source would create two truths that a
// merge would then have to arbitrate, and any arbitration is a guess.

TP.model = (function () {
  'use strict';

  // The collections, in the order the UI and both mappers present them.
  var COLLECTIONS = [
    'lodging', 'reservations', 'noReservationNeeded', 'preTripActions',
    'bucketList', 'chargingNetworks', 'minSocThresholds', 'locations',
    'contacts', 'criticalAlerts', 'budgetEstimates', 'expenses',
  ];

  var FORMATS = ['tripDataJson', 'iCal'];

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  // ---- Passthrough bags (REQ-205–REQ-207) ----
  //
  // Every field the canonical model does not represent is preserved verbatim, keyed by
  // source format, on the entity it came from. An empty bag is omitted, never emitted as {}.

  function bag(entity, format) {
    if (!entity || !entity.x) return null;
    var b = entity.x[format];
    return b && typeof b === 'object' ? b : null;
  }

  function bagSet(entity, format, key, value) {
    if (!entity) return;
    if (!entity.x) entity.x = {};
    if (!entity.x[format]) entity.x[format] = {};
    if (value === undefined) delete entity.x[format][key];
    else entity.x[format][key] = value;
    pruneBag(entity, format);
  }

  function pruneBag(entity, format) {
    if (!entity || !entity.x) return;
    var b = entity.x[format];
    if (b && typeof b === 'object' && Object.keys(b).length === 0) delete entity.x[format];
    if (Object.keys(entity.x).length === 0) delete entity.x;
  }

  function pruneAllBags(root) {
    if (!root || typeof root !== 'object') return;
    if (Array.isArray(root)) {
      for (var i = 0; i < root.length; i++) pruneAllBags(root[i]);
      return;
    }
    if (root.x && typeof root.x === 'object') {
      for (var f = 0; f < FORMATS.length; f++) pruneBag(root, FORMATS[f]);
      if (root.x && Object.keys(root.x).length === 0) delete root.x;
    }
    for (var k in root) {
      if (Object.prototype.hasOwnProperty.call(root, k) && k !== 'x') {
        var v = root[k];
        if (v && typeof v === 'object') pruneAllBags(v);
      }
    }
  }

  // ---- Carrying a bag on the wire ----
  //
  // A bag is keyed by the format its fields came from, but a mapper writes the wire for ONE format.
  // So the bag the OTHER format left behind is the mapper's business too: without this, a trip that
  // went `.ics` -> model -> `trip-data.json` -> model -> `.ics` comes back with every VALARM, RRULE
  // and UID gone. 06-interchange.md §3.2 states that case for `item.x.iCal` — "M on `trip-data.json`
  // (they ride along in the bag)" — and §3.5's guarantee is that a bag survives a round trip through
  // the format it came from. The reverse cannot hold and is not claimed: a calendar has nowhere to
  // put a JSON bag, and the ledger's iCalendar column says so with a **D**.
  //
  // The carrier is one reserved key, `x`, holding bags by format. It is deliberately NOT flattened
  // into the surrounding object: `trip-data.json` is first-party and a person may open it, and a
  // bare `VALARM` beside `title` is nonsense to them. `x` is reserved for the carrier, so a mapper
  // never writes a bag member at `x`; a bag that HAS one sends it inside the carrier, where
  // `carryIn` puts it back. The round trip is exact either way, which is the only thing the two
  // functions have to agree on.
  var CARRIER = 'x';

  // The carrier to write for `entity` on a wire in `format`, or null when there is nothing to
  // carry. The format's own bag is written field by field beside the entity's fields by the mapper
  // — that is what makes an export look like the file it came from — so only the other format's
  // bag (and any member named `x`) travels here.
  function carryOut(entity, format) {
    if (!entity || !entity.x || typeof entity.x !== 'object') return null;
    var out = null;
    for (var i = 0; i < FORMATS.length; i++) {
      var f = FORMATS[i];
      var b = entity.x[f];
      if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
      if (f === format) {
        if (!Object.prototype.hasOwnProperty.call(b, CARRIER)) continue;
        var own = {};
        own[CARRIER] = clone(b[CARRIER]);
        out = out || {};
        out[f] = own;
        continue;
      }
      if (!Object.keys(b).length) continue;
      out = out || {};
      out[f] = clone(b);
    }
    return out;
  }

  // Read a carrier back. Every format's bag is copied, the wire's own included, so a file that
  // carried a bag member named `x` comes back whole.
  function carryIn(entity, carrier) {
    if (!entity || !carrier || typeof carrier !== 'object' || Array.isArray(carrier)) return;
    for (var i = 0; i < FORMATS.length; i++) {
      var f = FORMATS[i];
      var b = carrier[f];
      if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
      for (var k in b) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        bagSet(entity, f, k, clone(b[k]));
      }
    }
  }

  // ---- Construction ----

  // A stable id for an entity a wire names but does not identify — a destination or a traveller on
  // `trip-data.json`, whose incumbent shapes are bare names.
  //
  // A mapper has to mint SOMETHING there, and a random id would make every round trip differ on a
  // field no format can carry, which is how a round-trip test comes to be written loosely enough to
  // miss the losses that matter. Deriving it from position and name keeps the round trip exact and
  // keeps the id stable for anyone who does not rename the thing. `day.id` is derived the same way
  // (`day-<i>-<date>`) and lives in `normalize`, so this is the model's existing convention with a
  // name on it, not a new one.
  function derivedId(prefix, index, name) {
    var slug = String(name == null ? '' : name).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return prefix + '-' + index + '-' + (slug || 'unnamed');
  }

  function newTraveler() { return { id: TP.uid(), name: '', type: 'adult' }; }
  function newDestination() { return { id: TP.uid(), name: '' }; }

  function newTrip(options) {
    var opts = options || {};
    var start = opts.startDate || TP.dates.todayISO();
    var end = opts.endDate || TP.dates.toISO(TP.dates.addDays(TP.dates.parseISO(start), 2));
    var trip = {
      id: TP.uid(),
      docId: opts.docId || '',
      title: opts.title || 'New trip',
      subtitle: '',
      currency: opts.currency || 'USD',
      startDate: start,
      endDate: end,
      // The placeholder the trip starts with is DROPPED from both wires: `trip-data.json` writes no
      // destination without a name and no traveller without one, and a calendar names neither. Both
      // mappers re-create the placeholder on import, so its id has to be the DERIVED one or the
      // re-created entity would differ from this one on every round trip, in a field no format can
      // carry. `newDestination()` / `newTraveler()` still mint a random id for an entity a person
      // adds: that one has a name, so it is written to the wire and comes back with its id.
      destinations: [{ id: derivedId('dest', 0, ''), name: '' }],
      travelers: [{ id: derivedId('person', 0, ''), name: '', type: 'adult' }],
      days: TP.dates.expandDays(start, end),
    };
    for (var i = 0; i < COLLECTIONS.length; i++) trip[COLLECTIONS[i]] = [];
    trip.keyTips = [];
    trip.checklists = [];
    return trip;
  }

  function emptyPayload(docId) {
    return { trip: newTrip({ docId: docId }) };
  }

  // ---- Normalization ----
  //
  // Applied on import and on load. It fills what the model requires and removes what the
  // model derives; it never renames or silently drops a field a person wrote.

  function normalize(input, docId) {
    var trip = input && typeof input === 'object' ? input : newTrip({ docId: docId });
    if (!trip.id) trip.id = TP.uid();
    if (docId) trip.docId = docId;
    else if (!trip.docId) trip.docId = '';
    if (typeof trip.title !== 'string') trip.title = trip.title == null ? 'Untitled trip' : String(trip.title);
    if (typeof trip.subtitle !== 'string') trip.subtitle = trip.subtitle == null ? '' : String(trip.subtitle);
    if (typeof trip.currency !== 'string' || !trip.currency) trip.currency = 'USD';
    if (typeof trip.startDate !== 'string') trip.startDate = null;
    if (typeof trip.endDate !== 'string') trip.endDate = null;

    if (!Array.isArray(trip.destinations)) trip.destinations = [];
    trip.destinations = trip.destinations.map(function (d) {
      if (typeof d === 'string') return { id: TP.uid(), name: d };
      return { id: d && d.id ? d.id : TP.uid(), name: d && d.name != null ? String(d.name) : '', x: d && d.x };
    });
    trip.destinations.forEach(function (d) { pruneAllBags(d); });

    if (!Array.isArray(trip.travelers)) trip.travelers = [];
    trip.travelers = trip.travelers.map(function (t) {
      if (typeof t === 'string') return { id: TP.uid(), name: t, type: 'adult' };
      return {
        id: t && t.id ? t.id : TP.uid(),
        name: t && t.name != null ? String(t.name) : '',
        type: (t && t.type) || 'adult',
        // The traveller's bags too. A traveller has no `email` field — the address a calendar
        // knows about lives in `x.iCal.EMAIL` — so dropping the bags here would drop the only
        // place an ATTENDEE can be reconstructed from, and the .ics export writes no ATTENDEE
        // for a traveller without one.
        x: t && t.x,
      };
    });
    trip.travelers.forEach(function (t) { pruneAllBags(t); });

    if (trip.vehicle && typeof trip.vehicle === 'object') {
      var v = trip.vehicle;
      trip.vehicle = {
        model: v.model != null ? String(v.model) : '',
        batteryKWh: numOrUndef(v.batteryKWh),
        efficiencyMilesPerKWh: numOrUndef(v.efficiencyMilesPerKWh),
        fullRangeMiles: numOrUndef(v.fullRangeMiles),
        usableRangeMiles: numOrUndef(v.usableRangeMiles),
        chargingConvention: v.chargingConvention != null ? String(v.chargingConvention) : undefined,
        x: v.x,
      };
      pruneAllBags(trip.vehicle);
    } else {
      // ABSENT, not null. `trip-data.json`'s schema declares `vehicle` as an object and nothing
      // else — `03-data-model.md` §2.1 lists it among the optional fields, and the one nullable
      // trip field in the schema is the dates. So `null` is not "no vehicle", it is a value of the
      // wrong type, and a canonical payload carrying it fails the very schema this app validates
      // imports against. It was invisible because every writer of the wire formats prunes nulls on
      // the way out, so the invalid value never left the process — the defect was only in what the
      // app believed about its own payload.
      delete trip.vehicle;
    }

    if (!Array.isArray(trip.days)) trip.days = [];
    trip.days = trip.days.map(function (d, i) {
      var date = d && typeof d.date === 'string' ? d.date : null;
      var day = {
        // A present id is a STRING, always. The older generation of `trip-data.json` wrote numeric
        // day ids (`app/io.js:173` minted them), and `canonical.serialize` distinguishes `1` from
        // `"1"` — so a number here would make the same day two different days to the payload hash,
        // to history, and to `findDay`. The generation upgrade coerces it at the wire
        // (`ADR-0019`); this is the model's own floor under that, for any other path in.
        id: d && d.id != null && d.id !== '' ? String(d.id) : 'day-' + i + '-' + (date || i),
        date: date,
        title: str(d && d.title),
        stay: str(d && d.stay),
        drive: str(d && d.drive),
        chargeStops: str(d && d.chargeStops),
        nacs: str(d && d.nacs),
        summary: str(d && d.summary),
        dining: strArray(d && d.dining),
        tips: strArray(d && d.tips),
        items: Array.isArray(d && d.items) ? d.items.map(normalizeItem) : [],
        x: d && d.x,
      };
      pruneAllBags(day);
      return day;
    });

    for (var i = 0; i < COLLECTIONS.length; i++) {
      var key = COLLECTIONS[i];
      if (!Array.isArray(trip[key])) trip[key] = [];
      trip[key] = trip[key].map(function (item) { return normalizeEntity(item); });
    }
    trip.lodging.forEach(function (l) { if (l.nights != null) delete l.nights; });   // derived

    trip.keyTips = strArray(trip.keyTips);

    if (!Array.isArray(trip.checklists)) trip.checklists = [];
    trip.checklists = trip.checklists.map(function (c) {
      if (typeof c === 'string') return { id: TP.uid(), category: c, items: [] };
      return {
        id: c && c.id ? c.id : TP.uid(),
        category: c && c.category != null ? String(c.category) : 'General',
        items: (Array.isArray(c && c.items) ? c.items : []).map(function (it) {
          if (typeof it === 'string') return { id: TP.uid(), text: it, done: false };
          return {
            id: it && it.id ? it.id : TP.uid(),
            text: it && it.text != null ? String(it.text) : '',
            done: !!(it && it.done),
          };
        }),
        x: c && c.x,
      };
    });
    trip.checklists.forEach(function (c) { pruneAllBags(c); });

    // Derived, never stored.
    delete trip.budget;
    delete trip.importedRaw;
    delete trip.source;
    delete trip.createdAt;
    delete trip.updatedAt;

    pruneAllBags(trip);
    return trip;
  }

  function normalizeEntity(item) {
    var out = {};
    if (item && typeof item === 'object') {
      for (var k in item) if (Object.prototype.hasOwnProperty.call(item, k)) out[k] = item[k];
    }
    if (!out.id) out.id = TP.uid();
    if (out.x && typeof out.x === 'object' && Object.keys(out.x).length === 0) delete out.x;
    return out;
  }

  function normalizeItem(item) {
    var it = normalizeEntity(item);
    if (typeof it.title !== 'string') it.title = it.title == null ? 'Untitled' : String(it.title);
    if (it.cost != null) it.cost = numOrUndef(it.cost);
    if (it.durationMin != null) it.durationMin = numOrUndef(it.durationMin);
    // The optional fields the WIRE omits when there is nothing to write. The model keeps exactly
    // one form for "nothing" there, and it is the absent key: `trip-data.json` has one slot per
    // field and its schema types these as strings, so a `null` has to be written as a `null` the
    // format does not allow or vanish entirely, and an `''` is a value no export can reproduce.
    // Either way it would be a field that changes on the next export — and `item.time` reaching
    // here as `null` is not hypothetical: that is what the itinerary editor writes when a person
    // clears a time (`target.time = value.trim() || null`).
    //
    // `notes` is deliberately NOT in this list. This format writes `desc` only when it is
    // non-empty and the mapper reads a missing `desc` back as `''`, so `notes` is canonically a
    // string — always present, possibly empty — and collapsing it here would make the model
    // toggle between absent and `''` on every round trip.
    var OPTIONAL_STRINGS = ['time', 'timeRaw', 'location', 'currency', 'confirmation', 'link'];
    for (var s = 0; s < OPTIONAL_STRINGS.length; s++) {
      var k = OPTIONAL_STRINGS[s];
      if (it[k] === null || it[k] === '') delete it[k];
    }
    if (it.cost === undefined) delete it.cost;
    if (it.durationMin === undefined) delete it.durationMin;
    if (it.flags && typeof it.flags === 'object') {
      var f = it.flags;
      var flags = {};
      if (f.charge) flags.charge = true;
      if (f.overnight) flags.overnight = true;
      if (f.tour) flags.tour = true;
      if (f.warn) flags.warn = true;
      if (f.minSoc != null) flags.minSoc = numOrUndef(f.minSoc);
      if (f.minSocCritical) flags.minSocCritical = true;
      if (Object.keys(flags).length) it.flags = flags;
      else delete it.flags;
    } else {
      delete it.flags;
    }
    // `item.type` is DERIVED (06-interchange.md §3.2), and it has to be derived here rather than
    // only in the mappers. The wire carries no type, so an import recomputes it from the flags; a
    // payload that kept a hand-written type disagreeing with its own flags would come back from an
    // export different from how it went in, which is a round trip that loses a value nobody can
    // see it losing. Deriving once, in the normaliser, is what makes `type` a function of the
    // fields both formats do carry.
    it.type = itemType(it);
    return it;
  }

  function str(v) { return v == null ? '' : String(v); }
  function numOrUndef(v) {
    if (v == null || v === '') return undefined;
    var n = Number(v);
    return isFinite(n) ? n : undefined;
  }
  function strArray(v) {
    if (!Array.isArray(v)) return [];
    return v.map(function (s) { return s == null ? '' : String(s); });
  }

  // ---- Lookups ----

  function tripTitle(trip) {
    var t = trip && trip.title ? String(trip.title).trim() : '';
    return t || 'Untitled trip';
  }

  function findDay(trip, dayId) {
    var days = (trip && trip.days) || [];
    for (var i = 0; i < days.length; i++) if (days[i].id === dayId) return days[i];
    return null;
  }

  function findItem(trip, dayId, itemId) {
    var day = findDay(trip, dayId);
    if (!day) return null;
    for (var i = 0; i < day.items.length; i++) if (day.items[i].id === itemId) return day.items[i];
    return null;
  }

  function findIn(list, id) {
    var arr = list || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  // ---- Derived roll-ups ----

  function rollupBudget(estimates) {
    var byCat = new Map();
    var list = estimates || [];
    for (var i = 0; i < list.length; i++) {
      var n = TP.format.parseCost(list[i].cost);
      if (n == null) continue;
      var cat = list[i].category || 'General';
      byCat.set(cat, (byCat.get(cat) || 0) + n);
    }
    var categories = [];
    var total = 0;
    byCat.forEach(function (amount, name) {
      categories.push({ name: name, amount: amount });
      total += amount;
    });
    categories.sort(function (a, b) { return b.amount - a.amount; });
    return { total: total, categories: categories };
  }

  function expenseTotal(expenses) {
    var total = 0;
    var list = expenses || [];
    for (var i = 0; i < list.length; i++) {
      var n = Number(list[i].amount);
      if (isFinite(n)) total += n;
    }
    return total;
  }

  // The EV tab exists only for a trip with a vehicle (REQ-609's existing mechanism).
  function isEv(trip) {
    return !!(trip && trip.vehicle);
  }

  function itemType(item) {
    var f = (item && item.flags) || {};
    if (f.overnight) return 'lodging';
    if (f.charge) return 'transport';
    return (item && item.type) || 'activity';
  }

  return {
    COLLECTIONS: COLLECTIONS,
    FORMATS: FORMATS,
    clone: clone,
    bag: bag,
    bagSet: bagSet,
    carryOut: carryOut,
    carryIn: carryIn,
    pruneBag: pruneBag,
    pruneAllBags: pruneAllBags,
    newTrip: newTrip,
    newTraveler: newTraveler,
    newDestination: newDestination,
    derivedId: derivedId,
    emptyPayload: emptyPayload,
    normalize: normalize,
    normalizeEntity: normalizeEntity,
    normalizeItem: normalizeItem,
    tripTitle: tripTitle,
    findDay: findDay,
    findItem: findItem,
    findIn: findIn,
    rollupBudget: rollupBudget,
    expenseTotal: expenseTotal,
    isEv: isEv,
    itemType: itemType,
  };
})();
