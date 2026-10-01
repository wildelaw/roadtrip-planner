// Tool schemas and dispatch for the planning agent (specs/07-ui.md §3.3).
//
// Every write-back tool goes through `TP.store.edit`, which means three things for free and on
// purpose: the change is undoable, it lands in the working payload rather than the file, and it
// becomes ONE commit when the agent stops. An agent that took forty turns should not put forty
// lines in the history — the user asked for one thing.
//
// The EV tools are injected only when the trip has a vehicle, so a model planning a petrol trip is
// never told about charging.
//
// One deliberate omission from the earlier version: there is no `set_budget` tool. The canonical
// model derives the budget from its line items and deletes any stored total, so a tool that wrote
// one would appear to succeed and then vanish on the next load. `add_budget_estimate` is the whole
// surface.

TP.ai.tools = (function () {
  'use strict';

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
        return collection(name, 'lodging', args, 'Recorded lodging "' + args.location + '".');

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

  function collection(toolName, key, args, message, extra) {
    var payload = shallow(args);
    if (extra) Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
    var res = edit(toolName, message, function (trip) {
      trip[key] = trip[key] || [];
      trip[key].push(payload);
      return true;
    });
    return settle(toolName, res.error ? 'Failed: ' + res.error : message);
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
    schemas: schemas,
    dispatch: dispatch,
    newItem: newItem,
    resolveDay: resolveDay,
  };
})();
