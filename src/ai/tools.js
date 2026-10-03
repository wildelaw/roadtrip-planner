// Tool schemas and dispatch for the planning agent (specs/08-security.md §8, specs/09-testing.md §9).
//
// Every write-back tool goes through `TP.store.edit`, which means three things for free and on
// purpose: the change is undoable, it lands in the working payload rather than the file, and it
// becomes ONE commit when the agent stops. An agent that took forty turns should not put forty
// lines in the history — the user asked for one thing.
//
// The EV tools are injected only when the trip has a vehicle, so a model planning a petrol trip is
// never told about charging.
//
// `update_record` and `remove_record` exist because the first generation of tools could only
// append, and a real session showed what that costs: the agent recorded the same three stays
// fourteen times, then told the person it had no way to take any of them back, and they cleaned it
// up by hand. An agent that can write into the trip has to be able to correct itself — otherwise a
// mistake it makes is a mistake the person has to undo in the UI.
//
// One deliberate omission from the earlier version: there is no `set_budget` tool. The canonical
// model derives the budget from its line items and deletes any stored total, so a tool that wrote
// one would appear to succeed and then vanish on the next load. `add_budget_estimate` is the whole
// surface.

TP.ai.tools = (function () {
  'use strict';

  // The only collections the agent may change or remove. Days, items, keyTips, checklists,
  // travelers, vehicle and destinations are NOT here on purpose: they are the trip's spine, and a
  // tool that could rewrite them turns an over-eager model into data loss. `keyTips` is also a bare
  // string[] with no id, so it could never be targeted in the first place.
  //
  // `minSocThresholds` is here even though `set_min_soc` is an EV tool, because it is the same
  // append-only shape as the rest: every call piles on another threshold, so it can make exactly
  // the mess this pair of tools exists to clear up.
  var MUTABLE_COLLECTIONS = {
    lodging: 1, reservations: 1, locations: 1, bucketList: 1, contacts: 1, expenses: 1,
    criticalAlerts: 1, budgetEstimates: 1, preTripActions: 1, chargingNetworks: 1,
    minSocThresholds: 1,
  };
  // The tool descriptions and the refusal message are both built from this, so what the model is
  // told it may touch and what it is actually allowed to touch cannot drift apart.
  var MUTABLE_LIST = Object.keys(MUTABLE_COLLECTIONS).join(', ');

  // Derived from checkIn/checkOut and deleted by the normaliser on every load (model/trip.js), so
  // storing one would be a field that vanishes. `id` is refused for the same class of reason.
  var DERIVED_FIELDS = { nights: 1 };

  var WEB_TOOLS = [
    fn('web_search', 'Search the web for current information: opening hours, prices, events, transport. Ollama Cloud mode only.', {
      query: { type: 'string' },
      max_results: { type: 'integer' },
    }, ['query']),
    fn('web_fetch', 'Fetch and read the content of a URL found by web_search. Ollama Cloud mode only.', {
      url: { type: 'string' },
    }, ['url']),
  ];

  var PLANNING_TOOLS = [
    fn('get_trip_summary', 'Read the current trip: dates, days, existing items, budget, collections. Use this before planning so you do not duplicate what is there.', {}, []),
    fn('add_itinerary_item', 'Add one item to a specific day of the trip.', {
      date: { type: 'string', description: 'ISO date, YYYY-MM-DD' },
      dayIndex: { type: 'integer', description: '0-based day index, as an alternative to date' },
      type: { type: 'string', enum: ['activity', 'transport', 'lodging', 'note'] },
      title: { type: 'string' },
      time: { type: 'string', description: 'HH:MM, 24-hour. Optional' },
      location: { type: 'string' },
      cost: { type: 'number' },
      currency: { type: 'string' },
      durationMin: { type: 'integer' },
      confirmation: { type: 'string' },
      notes: { type: 'string' },
    }, ['title']),
    fn('set_day_plan', 'Replace an entire day with several items at once. Prefer this when planning a full day.', {
      date: { type: 'string' },
      dayIndex: { type: 'integer' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['activity', 'transport', 'lodging', 'note'] },
            title: { type: 'string' },
            time: { type: 'string' },
            location: { type: 'string' },
            cost: { type: 'number' },
            currency: { type: 'string' },
            durationMin: { type: 'integer' },
            notes: { type: 'string' },
          },
          required: ['title'],
        },
      },
    }, ['items']),
    fn('set_day_meta', 'Set a day\'s own fields: title, drive summary, stay, summary text, dining list or tips. The companion to set_day_plan.', {
      date: { type: 'string' },
      dayIndex: { type: 'integer' },
      title: { type: 'string' },
      drive: { type: 'string' },
      stay: { type: 'string' },
      summary: { type: 'string' },
      dining: { type: 'array', items: { type: 'string' } },
      tips: { type: 'array', items: { type: 'string' } },
    }, []),
    fn('add_activity_to_day', 'Add a place or activity to a specific day as an itinerary item.', {
      date: { type: 'string' },
      title: { type: 'string' },
      location: { type: 'string' },
      time: { type: 'string' },
      notes: { type: 'string' },
    }, ['date', 'title']),
    fn('add_lodging', 'Record a lodging stay: where the traveller sleeps.', {
      location: { type: 'string' },
      checkIn: { type: 'string', description: 'YYYY-MM-DD' },
      checkOut: { type: 'string' },
      area: { type: 'string' },
      notes: { type: 'string' },
    }, ['location']),
    fn('add_reservation', 'Record something that needs booking, with a deadline and how to book it.', {
      what: { type: 'string' },
      when: { type: 'string' },
      bookBy: { type: 'string' },
      cost: { type: 'string' },
      howToBook: { type: 'string' },
      priority: { type: 'string', enum: ['high', 'med', 'low'] },
    }, ['what']),
    fn('add_pre_trip_action', 'Record a pre-trip todo: documents, packing, preparation.', {
      text: { type: 'string' },
      category: { type: 'string' },
      priority: { type: 'string', enum: ['high', 'med', 'low'] },
    }, ['text']),
    fn('add_location', 'Add a place to the location library: a point of interest with a summary, lodging, charging, dining and activities.', {
      name: { type: 'string' },
      icon: { type: 'string' },
      summary: { type: 'string' },
      lodging: { type: 'string' },
      charging: { type: 'array', items: { type: 'string' } },
      dining: { type: 'array', items: { type: 'string' } },
      activities: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' }, desc: { type: 'string' } } },
      },
    }, ['name']),
    fn('add_bucket_item', 'Add a must-see item to the bucket list, optionally on a date.', {
      name: { type: 'string' },
      date: { type: 'string' },
      dateLabel: { type: 'string' },
    }, ['name']),
    fn('add_checklist_item', 'Add an item to a checklist category, creating the category if it is missing.', {
      category: { type: 'string' },
      text: { type: 'string' },
    }, ['category', 'text']),
    fn('add_budget_estimate', 'Add a budget line item: category, item, cost. The budget total rolls up from these automatically.', {
      category: { type: 'string' },
      item: { type: 'string' },
      cost: { type: 'string', description: 'free text, e.g. "$450" or "est. $450-600"' },
      optional: { type: 'boolean' },
    }, ['category', 'item']),
    fn('add_contact', 'Record a useful contact: what it is for, and how to reach it.', {
      what: { type: 'string' },
      how: { type: 'string' },
    }, ['what']),
    fn('add_key_tip', 'Record a short piece of advice for this trip.', {
      text: { type: 'string' },
    }, ['text']),
    fn('add_alert', 'Record a critical alert — a road closure, weather, a reservation deadline — with its severity.', {
      severity: { type: 'string', enum: ['danger', 'warn'] },
      title: { type: 'string' },
      text: { type: 'string' },
    }, ['title']),
    fn('add_expense', 'Record money actually spent.', {
      date: { type: 'string' },
      category: { type: 'string' },
      amount: { type: 'number' },
      item: { type: 'string' },
    }, ['amount', 'category']),
    // `match` and `patch` are deliberately free-form objects. The identifying fields differ per
    // collection (`location` for lodging, `what` for a reservation, `name` for a location), and a
    // schema that listed all of them would invite the model to fill in the ones that do not apply.
    // The description teaches the shape; dispatch enforces it.
    fn('update_record', 'Change fields on a record you already wrote: ' + MUTABLE_LIST + '. Use this rather than adding a second copy of something that is already there.', {
      collection: { type: 'string', description: 'Which collection: ' + MUTABLE_LIST + '.' },
      match: { type: 'object', description: 'Which record. Prefer {"id":"..."} from the trip summary. Otherwise give one or more fields to compare, e.g. {"location":"Hotel X","checkIn":"2026-09-01"} or {"what":"Ferry booking"}. Every field must match; text is compared ignoring case and extra spaces. If several records match, nothing is changed and the error lists their ids.' },
      patch: { type: 'object', description: 'The fields to change, e.g. {"checkOut":"2026-09-04","notes":"late arrival"}. Unknown, nested or derived fields are ignored, and id can never be changed.' },
    }, ['collection', 'match', 'patch']),
    fn('remove_record', 'Delete a record you already wrote, or every duplicate of one. Use this to clean up your own duplicates instead of leaving them for the person.', {
      collection: { type: 'string', description: 'Which collection: ' + MUTABLE_LIST + '.' },
      match: { type: 'object', description: 'Which record. Prefer {"id":"..."} from the trip summary, or give fields like {"location":"Hotel X","checkIn":"2026-09-01"}. Every field must match; text ignores case and extra spaces.' },
      all: { type: 'boolean', description: 'Set true to delete EVERY record that matches, not just one. Only when the several matches are duplicates you mean to clear.' },
    }, ['collection', 'match']),
  ];

  var EV_TOOLS = [
    fn('add_charging_stop', 'Record a charging network or station the traveller plans to use.', {
      name: { type: 'string' },
      location: { type: 'string' },
      network: { type: 'string' },
      nacsAdapter: { type: 'boolean' },
    }, ['name']),
    fn('set_min_soc', 'Set a minimum state-of-charge threshold for a driving leg.', {
      day: { type: 'string' },
      leg: { type: 'string' },
      minSoc: { type: 'number' },
      reason: { type: 'string' },
      severity: { type: 'string', enum: ['danger', 'warn', 'info'] },
    }, ['minSoc']),
  ];

  function fn(name, description, properties, required) {
    return { type: 'function', function: { name: name, description: description, parameters: { type: 'object', properties: properties, required: required } } };
  }

  // Web tools are cloud-only, because only the Ollama Cloud endpoint has /api/web_search. The
  // other modes plan from the model's own knowledge, and telling them about a tool they cannot
  // call just produces a failed call.
  function schemas(trip) {
    var cfg = TP.ai.transport.config();
    var web = cfg.isCloud ? WEB_TOOLS : [];
    return web.concat(PLANNING_TOOLS, (trip && trip.vehicle) ? EV_TOOLS : []);
  }

  // ---- Dispatch ----

  // Returns a promise for { name, content, citations? }. `content` is what is fed back to the
  // model as the tool result, so a failure is described rather than thrown: the model can then
  // correct itself instead of the loop dying.
  function dispatch(call, options) {
    var opts = options || {};
    var name = (call.function && call.function.name) || call.name;
    var args = {};
    try { args = JSON.parse((call.function && call.function.arguments) || call.arguments || '{}') || {}; }
    catch (e) { args = {}; }

    function log(label) { if (opts.onTool) opts.onTool({ name: name, label: label }); }

    switch (name) {
      case 'web_search':
        log('Searching: "' + args.query + '"');
        return TP.ai.transport.webSearch({ query: args.query, maxResults: args.max_results || 5 }).then(function (res) {
          if (!res.ok) return { name: name, content: 'web_search failed: ' + TP.ai.transport.describeError(res.error) };
          var results = (res.data && res.data.results) || [];
          var text = results.map(function (r, i) { return '[' + (i + 1) + '] ' + r.title + '\n' + r.url + '\n' + r.content; }).join('\n\n');
          return { name: name, content: text || 'No results.', citations: results.map(function (r) { return r.url; }) };
        });

      case 'web_fetch':
        log('Fetching: ' + args.url);
        return TP.ai.transport.webFetch({ url: args.url }).then(function (res) {
          if (!res.ok) return { name: name, content: 'web_fetch failed: ' + TP.ai.transport.describeError(res.error) };
          var body = (res.data && res.data.content) || '';
          var screened = guardResult(body);
          return { name: name, content: 'Title: ' + (res.data && res.data.title) + '\nURL: ' + args.url + '\n\n' + screened, citations: [args.url] };
        });

      case 'get_trip_summary':
        log('Reading the trip');
        return settle(name, TP.ai.prompt.serializeTrip(TP.store.trip()));

      case 'add_itinerary_item': {
        log('Adding item: ' + args.title);
        var added = edit(name, 'Add "' + (args.title || 'an item') + '"', function (trip) {
          var day = resolveDay(trip, args);
          if (!day) return { error: 'no day matches ' + describeTarget(args) };
          day.items = day.items || [];
          day.items.push(newItem(args));
          return { day: day.date || ('day ' + indexOfDay(trip, day)) };
        });
        return settle(name, added.error ? 'Failed: ' + added.error : 'Added "' + args.title + '" on ' + added.day + '.');
      }

      case 'set_day_plan': {
        // A model that sends `items` as anything but a list — `{title: '…'}`, a bare string — is a
        // normal event for a small local model, and `(args.items || []).map` threw out of `dispatch`
        // and killed the whole turn, reported to the user as a network error. The failure is
        // described instead, like every other tool's: the model can correct itself and carry on.
        var list = Array.isArray(args.items) ? args.items : null;
        var count = list ? list.length : 0;
        log('Setting the plan for a day (' + count + (count === 1 ? ' item' : ' items') + ')');
        var planned = edit(name, 'Plan a day', function (trip) {
          var day = resolveDay(trip, args);
          if (!day) return { error: 'no day matches ' + describeTarget(args) };
          if (!list) return { error: 'items has to be a list of itinerary items' };
          day.items = list.map(newItem);
          return { count: day.items.length, date: day.date || ('day ' + indexOfDay(trip, day)) };
        });
        return settle(name, planned.error ? 'Failed: ' + planned.error : 'Set ' + planned.count + ' items for ' + planned.date + '.');
      }

      case 'set_day_meta': {
        log('Setting the day\'s own fields for ' + (args.date || ('day ' + args.dayIndex)));
        var meta = edit(name, 'Describe a day', function (trip) {
          var day = resolveDay(trip, args);
          if (!day) return { error: 'no day matches ' + describeTarget(args) };
          var keys = [];
          ['title', 'drive', 'stay', 'summary', 'dining', 'tips'].forEach(function (k) {
            if (args[k] == null) return;
            day[k] = Array.isArray(args[k]) ? args[k].map(String) : String(args[k]);
            keys.push(k);
          });
          return { date: day.date, keys: keys };
        });
        return settle(name, meta.error ? 'Failed: ' + meta.error
          : (meta.keys.length ? 'Updated ' + meta.date + ': ' + meta.keys.join(', ') + '.' : 'Nothing to change.'));
      }

      case 'add_activity_to_day': {
        log('Adding "' + args.title + '" to ' + args.date);
        var placed = edit(name, 'Add "' + (args.title || 'an activity') + '"', function (trip) {
          var day = resolveDay(trip, args);
          if (!day) return { error: 'no day matches ' + describeTarget(args) };
          day.items = day.items || [];
          day.items.push(newItem({
            type: 'activity', title: args.title, location: args.location,
            time: args.time, notes: args.notes,
          }));
          return { day: day.date };
        });
        return settle(name, placed.error ? 'Failed: ' + placed.error : 'Added "' + args.title + '" to ' + placed.day + '.');
      }

      case 'add_lodging':
        log('Adding lodging: ' + args.location);
        return collection(name, 'lodging', args, 'Recorded lodging "' + args.location + '".', null, lodgingDuplicate);

      case 'add_reservation':
        log('Adding reservation: ' + args.what);
        return collection(name, 'reservations', args,
          'Recorded reservation "' + args.what + '"' + (args.bookBy ? ' (book by ' + args.bookBy + ')' : '') + '.');

      case 'add_pre_trip_action':
        log('Adding pre-trip action: ' + args.text);
        return collection(name, 'preTripActions', args, 'Recorded pre-trip action "' + args.text + '".', { done: false });

      case 'add_location':
        log('Adding location: ' + args.name);
        return collection(name, 'locations', args, 'Added "' + args.name + '" to the location library.');

      case 'add_bucket_item':
        log('Adding bucket item: ' + args.name);
        return collection(name, 'bucketList', args, 'Added "' + args.name + '" to the bucket list.');

      case 'add_checklist_item': {
        log('Adding checklist item [' + args.category + '] ' + args.text);
        var wanted = String(args.category || 'General');
        var cl = edit(name, 'Add a checklist item', function (trip) {
          trip.checklists = trip.checklists || [];
          var cat = null;
          for (var i = 0; i < trip.checklists.length; i++) {
            if (String(trip.checklists[i].category).toLowerCase() === wanted.toLowerCase()) { cat = trip.checklists[i]; break; }
          }
          if (!cat) {
            cat = { id: TP.uid(), category: wanted, items: [] };
            trip.checklists.push(cat);
          }
          cat.items = cat.items || [];
          cat.items.push({ id: TP.uid(), text: String(args.text), done: false });
          return 'Added "' + args.text + '" to checklist "' + wanted + '".';
        });
        return settle(name, typeof cl === 'string' ? cl : failedOr(cl, 'Added the checklist item.'));
      }

      case 'add_budget_estimate':
        log('Adding budget estimate: ' + args.category + ' / ' + args.item);
        return collection(name, 'budgetEstimates', args,
          'Recorded budget estimate ' + args.category + ': ' + args.item + (args.cost ? ' (' + args.cost + ')' : '') + '.');

      case 'add_contact':
        log('Adding contact: ' + args.what);
        return collection(name, 'contacts', args, 'Recorded contact "' + args.what + '".');

      case 'add_key_tip':
        log('Adding a key tip');
        return settle(name, edit(name, 'Add a key tip', function (trip) {
          trip.keyTips = trip.keyTips || [];
          trip.keyTips.push(String(args.text));
          return 'Recorded the key tip.';
        }));

      case 'add_alert':
        log('Adding alert: ' + args.title);
        return collection(name, 'criticalAlerts', args, 'Recorded alert "' + args.title + '".');

      case 'add_charging_stop':
        log('Adding charging stop: ' + args.name);
        return collection(name, 'chargingNetworks', args, 'Recorded charging network "' + args.name + '".');

      case 'set_min_soc':
        log('Setting min SoC ' + args.minSoc + '% for ' + (args.leg || args.day || 'a leg'));
        return collection(name, 'minSocThresholds', args,
          'Set minimum state of charge to ' + args.minSoc + '% for ' + (args.leg || args.day || 'the leg') + '.');

      case 'add_expense':
        log('Adding expense: ' + args.amount + ' ' + args.category);
        return collection(name, 'expenses', args,
          'Recorded ' + TP.format.fmtMoney(args.amount) + ' in ' + args.category + '.');

      case 'update_record':
        log('Updating ' + (args.collection || 'a record'));
        return settle(name, updateRecord(args));

      case 'remove_record':
        log('Removing ' + (args.collection || 'a record'));
        return settle(name, removeRecord(args));

      default:
        return settle(name, 'Unknown tool: ' + name);
    }
  }

  // A tool result is not a promise, but callers treat them uniformly.
  function settle(name, content) {
    return Promise.resolve({ name: name, content: content });
  }

  // `edit` returns the mutator's own value on success, or { error } when nothing could be written.
  function failedOr(out, ok) {
    return (out && out.error) ? 'Failed: ' + out.error : ok;
  }

  // Run a mutation through the store, then say what happened. `edit` returns whatever the mutator
  // returned, or a plain { ok } when the document is read-only.
  function edit(toolName, label, mutate) {
    if (TP.store.isReadOnly()) {
      return { error: 'the document is open read-only, so nothing could be written' };
    }
    var out = null;
    TP.store.edit(label, function (trip) { out = mutate(trip); });
    return out || {};
  }

  // `guard` is optional and is consulted inside the edit, before the push, so a refusal leaves the
  // document untouched: `store.edit` compares canonically and sees no change, so there is no dirty
  // flag, no autosave and no empty commit (decisions/0018).
  function collection(toolName, key, args, message, extra, guard) {
    var payload = shallow(args);
    // Every row the agent adds is addressable the moment it lands. It was not, and that was the
    // second half of the disaster this pair of tools was written for: `normalizeEntity` only mints
    // an id on load or import, and the committed payload is the working copy verbatim, so an
    // AI-added row stayed id-less for the whole session. `findIn` and the panel's `removeRow` match
    // on exact id, so the row could not be found at all — the person could not remove it, and
    // editing one cell could hit a different row. Assigning after `shallow` also means a
    // model-supplied id is overwritten rather than trusted.
    payload.id = TP.uid();
    if (extra) Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
    var res = edit(toolName, message, function (trip) {
      trip[key] = trip[key] || [];
      if (guard) {
        var refusal = guard(trip, payload);
        if (refusal) return { error: refusal };
      }
      trip[key].push(payload);
      return true;
    });
    return settle(toolName, res.error ? 'Failed: ' + res.error : message);
  }

  // ---- update_record / remove_record ----

  // The agent used to be append-only, which is how a real session reached fourteen lodging records
  // for three stays and then had to tell the person it could not undo any of it. These two tools are
  // that session's answer: the agent can correct and remove what it wrote.

  function normText(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // A match whose values are all null or absent would satisfy `rowMatches` for EVERY row, which
  // would make an empty match mean "the whole collection". `matchRecords` enforces that it selects
  // nothing, and both tools call this first so they can say which mistake it was.
  function matchKeys(match) {
    var keys = [];
    Object.keys(match || {}).forEach(function (k) {
      var v = match[k];
      if (v == null || typeof v === 'object') return;
      keys.push(k);
    });
    return keys;
  }

  function rowMatches(row, match) {
    var keys = Object.keys(match || {});
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], want = match[k];
      if (want == null) continue;
      if (typeof want === 'object') return false;
      // `id` is an opaque token, so it is compared exactly; everything else is human text.
      if (k === 'id') {
        if (String(row.id == null ? '' : row.id) !== String(want)) return false;
        continue;
      }
      // A field the row does not have cannot match. This is what stops {"location":"Hotel X"} from
      // matching a reservation, which has no `location`.
      if (row[k] == null) return false;
      if (normText(row[k]) !== normText(want)) return false;
    }
    return true;
  }

  function matchRecords(list, match) {
    var out = [];
    // A match with nothing in it selects nothing, and that is enforced here rather than only at the
    // two call sites. Both of them already refuse it with a better message, but the rule belongs to
    // the matcher: an all-null match must never be a way to say "every row", whoever calls this.
    if (!matchKeys(match).length) return out;
    for (var i = 0; i < (list || []).length; i++) if (rowMatches(list[i], match)) out.push(list[i]);
    return out;
  }

  function describeMatch(match) {
    return Object.keys(match || {}).filter(function (k) { return match[k] != null; })
      .map(function (k) { return k + '="' + match[k] + '"'; }).join(', ');
  }

  function idsOf(rows) {
    return rows.map(function (r) { return r.id == null ? '(no id)' : r.id; }).join(', ');
  }

  function writableKey(args) {
    var key = args.collection == null ? '' : String(args.collection);
    if (!key) return { error: 'collection is required — name one of: ' + MUTABLE_LIST + '.' };
    // An own-key check, not a truthy lookup: `MUTABLE_COLLECTIONS['constructor']` is inherited from
    // Object.prototype and would otherwise name a "collection" that is really a function.
    if (!Object.prototype.hasOwnProperty.call(MUTABLE_COLLECTIONS, key)) {
      return { error: '"' + key + '" is not a collection the agent can change. It can change: ' + MUTABLE_LIST + '.' };
    }
    return { key: key };
  }

  // A patch may only touch fields the format actually carries for that collection. This is not
  // tidiness: an unknown key is NOT dropped on the way out. `tripdatajson` writes unknown wire keys
  // into the `x` bag and reads them back again, so an invented field would persist invisibly while
  // the UI showed nothing and the model believed it had succeeded. Deriving the field list from the
  // interchange module means there is one list, not two that can drift.
  function sanitizePatch(key, patch) {
    var known = (TP.tripdatajson.COLLECTION_KEYS || {})[key] || {};
    var fields = {}, keys = [];
    Object.keys(patch || {}).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(known, k)) return;
      if (k === 'id' || DERIVED_FIELDS[k]) return;
      var v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) return;
      if (Array.isArray(v)) {
        for (var i = 0; i < v.length; i++) if (v[i] && typeof v[i] === 'object') return;
        v = v.map(function (x) { return String(x); });
      }
      fields[k] = v;
      keys.push(k);
    });
    return { fields: fields, keys: keys };
  }

  function updateRecord(args) {
    var picked = writableKey(args);
    if (picked.error) return 'Failed: ' + picked.error;
    if (!matchKeys(args.match).length) {
      return 'Failed: match must name at least one field with a value, so one record is targeted. ' +
        'Call get_trip_summary to see the records and their ids.';
    }
    var clean = sanitizePatch(picked.key, args.patch);
    if (!clean.keys.length) {
      return 'Failed: patch must name at least one changeable field for ' + picked.key + '.';
    }
    var out = edit('update_record', 'Update ' + picked.key, function (trip) {
      var matches = matchRecords(trip[picked.key] || [], args.match);
      if (!matches.length) {
        return { error: 'no ' + picked.key + ' record matches ' + describeMatch(args.match) +
          '. Call get_trip_summary to see the records and their ids.' };
      }
      // Ambiguity is refused rather than applied. Patching several rows from one patch is almost
      // never what the model meant, and the error hands it the ids it needs to say which one.
      if (matches.length > 1) {
        return { error: matches.length + ' ' + picked.key + ' records match ' + describeMatch(args.match) +
          ' (ids: ' + idsOf(matches) + '). Match on one id, or add fields to narrow it.' };
      }
      var row = matches[0], changed = [];
      Object.keys(clean.fields).forEach(function (k) {
        if (row[k] === clean.fields[k]) return;
        row[k] = clean.fields[k];
        changed.push(k);
      });
      if (!changed.length) return { unchanged: true, id: row.id };
      return { id: row.id, keys: changed };
    });
    if (out.error) return 'Failed: ' + out.error;
    if (out.unchanged) return 'No change: ' + picked.key + ' record ' + out.id + ' already has those values.';
    return 'Updated ' + picked.key + ' record ' + out.id + ': ' + out.keys.join(', ') + '.';
  }

  function removeRecord(args) {
    var picked = writableKey(args);
    if (picked.error) return 'Failed: ' + picked.error;
    if (!matchKeys(args.match).length) {
      return 'Failed: match must name at least one field with a value, so the whole collection is not removed. ' +
        'Call get_trip_summary to see the records and their ids.';
    }
    var removeAll = args.all === true;
    var out = edit('remove_record', 'Remove from ' + picked.key, function (trip) {
      var list = trip[picked.key] || [];
      var matches = matchRecords(list, args.match);
      if (!matches.length) {
        return { error: 'no ' + picked.key + ' record matches ' + describeMatch(args.match) +
          '. Call get_trip_summary to see the records and their ids.' };
      }
      // One match removes one row. Several matches need `all: true`, because a model that meant to
      // clear eleven duplicates and a model that meant to delete one legitimate stay look identical
      // from here, and guessing wrong destroys data the person wanted. The refusal names every id,
      // so the model can either be precise or say plainly that it means all of them.
      if (matches.length > 1 && !removeAll) {
        return { error: matches.length + ' ' + picked.key + ' records match ' + describeMatch(args.match) +
          ' (ids: ' + idsOf(matches) + '). Match on one id, add fields to narrow it, or pass all: true to remove every match.' };
      }
      // Filtered by object identity, not by id: rows written before ids were minted have no id at
      // all, and a duplicated id must never take out the wrong row.
      trip[picked.key] = list.filter(function (x) { return matches.indexOf(x) === -1; });
      return { n: matches.length, ids: matches.map(function (m) { return m.id; }) };
    });
    if (out.error) return 'Failed: ' + out.error;
    if (out.n === 1) return 'Removed ' + picked.key + ' record ' + out.ids[0] + '.';
    return 'Removed ' + out.n + ' ' + picked.key + ' records matching ' + describeMatch(args.match) +
      ' (ids: ' + out.ids.join(', ') + ').';
  }

  // `add_lodging` appends, and until this change the model could only see a count of what was
  // there — so adding the same stay three times looked, from inside the loop, like three different
  // stays. Refuse the exact duplicate and name the existing record, so the model corrects itself
  // with update_record instead of piling on. A stay at the same place with a DIFFERENT check-in is
  // a separate stay and is allowed.
  function lodgingDuplicate(trip, payload) {
    var list = trip.lodging || [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (normText(row.location) === normText(payload.location) &&
          normText(row.checkIn) === normText(payload.checkIn)) {
        return '"' + payload.location + '" is already recorded for ' +
          (payload.checkIn ? payload.checkIn : 'no check-in date') + ' as id ' + row.id +
          '. Use update_record to change that stay, or give a different checkIn to record a separate stay.';
      }
    }
    return null;
  }

  // ---- Screening a fetched document (08-security.md §8, REQ-712) ----
  //
  // "Tool results pass the same validators as an imported file (06-interchange.md §7) before they
  // reach the model." Almost every fetched page is prose, and prose is not a document: it is passed
  // through as text and never interpreted. The case this exists for is the one where a URL hands
  // back something that IS one of our formats — a calendar, trip data, a planner document. A
  // malformed document is exactly the input a model will paraphrase into the payload, so it is the
  // one case where passing the bytes along is not the honest answer.
  //
  // Nothing here parses the content as markup and nothing executes it: the text is only looked at,
  // and what comes back is either the text or a sentence about it.
  function guardResult(text) {
    if (typeof text !== 'string' || !text.length) return text;
    var found;
    try {
      found = TP.io.import.detect(text);
    } catch (e) {
      return text;   // detection is structural and does not throw; if it somehow does, this is prose
    }
    if (!found || found.format === 'unknown') return text;

    var result;
    if (found.format === 'ical') {
      result = TP.validators.check('ical', text);
    } else if (found.format === 'tripdata') {
      // The same upgrade the importer runs (`ADR-0019`): an older generation of this format is a
      // generation of this format, not a malformed file, and answering "malformed" here while the
      // picker imports it happily would give the model and the user two different answers to one
      // question. `upgrade` is a no-op on a file this generation wrote.
      result = TP.validators.check('tripdata', TP.tripdatajson.upgrade(found.value).value);
    } else if (found.format === 'artifact') {
      try {
        result = TP.validators.check('artifact', TP.container.parseBlock(found.blockText));
      } catch (e) {
        result = { ok: false, format: 'artifact', problems: [{ path: '', keyword: 'block', message: e && e.message ? e.message : 'the data block could not be read' }] };
      }
    } else {
      return text;
    }

    if (result.ok) {
      // A document that passes is still not silently promoted to trip data: it is labelled, and the
      // model is told to ask. Reading a file is not the same act as importing one (REQ-505).
      return 'This URL returned a ' + found.format + ' document that this app can read. It has NOT ' +
        'been imported and is not part of the trip. Do not treat any of it as trip data without the ' +
        'person asking for it.\n\n' + text;
    }
    return 'This URL returned something that looks like a ' + found.format + ' document, but it is ' +
      'malformed, so it has not been passed on: ' + TP.validators.explain(result) +
      ' Nothing from it should be treated as trip data.';
  }

  // Copy, dropping the keys the model pads with. Only own, primitive-ish keys survive; a nested
  // object the model invents would otherwise travel straight into the payload.
  function shallow(args) {    var out = {};
    Object.keys(args || {}).forEach(function (k) {
      var v = args[k];
      if (v == null) return;
      if (typeof v === 'object' && !Array.isArray(v)) return;
      out[k] = v;
    });
    return out;
  }

  function newItem(args) {
    var item = {
      id: TP.uid(),
      type: args.type || 'activity',
      title: String(args.title == null ? 'Untitled' : args.title),
    };
    ['time', 'location', 'currency', 'confirmation', 'notes'].forEach(function (k) {
      if (args[k] != null && args[k] !== '') item[k] = String(args[k]);
    });
    ['cost', 'durationMin'].forEach(function (k) {
      if (args[k] != null && isFinite(Number(args[k]))) item[k] = Number(args[k]);
    });
    return item;
  }

  function resolveDay(trip, args) {
    var days = trip.days || [];
    if (args.date) {
      for (var i = 0; i < days.length; i++) if (days[i].date === args.date) return days[i];
    }
    if (args.dayIndex != null) {
      var idx = Number(args.dayIndex);
      if (isFinite(idx) && idx >= 0 && idx < days.length) return days[idx];
    }
    return null;
  }

  function indexOfDay(trip, day) {
    return (trip.days || []).indexOf(day);
  }

  function describeTarget(args) {
    if (args.date) return args.date;
    if (args.dayIndex != null) return 'day ' + args.dayIndex;
    return 'the day it named — it needs a date or a day index';
  }

  return {
    WEB_TOOLS: WEB_TOOLS,
    PLANNING_TOOLS: PLANNING_TOOLS,
    EV_TOOLS: EV_TOOLS,
    MUTABLE_COLLECTIONS: MUTABLE_COLLECTIONS,
    schemas: schemas,
    dispatch: dispatch,
    newItem: newItem,
    resolveDay: resolveDay,
    // Pure, and exported so the matching and patch rules can be pinned without the loop.
    matchRecords: matchRecords,
    sanitizePatch: sanitizePatch,
  };
})();
