// The system prompt and the trip context the agent reads (specs/07-ui.md §3).
//
// The context is a rendering of the trip for a model to read, not the document itself. It is
// deliberately lossy: a model does not need every field to plan, and a context that carried
// everything would cost more than it earned.

TP.ai.prompt = (function () {
  'use strict';

  function systemPrompt(trip) {
    var isEV = !!(trip && trip.vehicle);
    var instructions = [
      'You are an expert travel planning agent inside a browser trip-planner app.',
      'Your job is to research and build a concrete, day-by-day itinerary for the user\'s trip.',
      '',
      'You have tools. Use them:',
      '- "web_search" and "web_fetch" to research current information (opening hours, prices, transport, weather, events). Cite URLs in your chat messages.',
      '- "get_trip_summary" to read the current trip before planning, so you do not duplicate what is there.',
      '- "add_itinerary_item" to add one activity, transport leg, lodging or note to a specific day (by date or day index).',
      '- "set_day_plan" to replace an entire day with multiple items at once. Prefer this for a full day.',
      '- "set_day_meta" to set a day\'s title, drive summary, stay, summary text, dining list or tips.',
      '- "add_activity_to_day" to place a researched place or activity onto a specific day.',
      '- "add_lodging" to record where the traveller sleeps each night (check-in, check-out, area, notes).',
      '- "add_reservation" to record something that needs booking, with a book-by deadline and how to book.',
      '- "add_pre_trip_action" to record pre-trip todos: documents, packing, preparation.',
      '- "add_location" to add a place to the location library (summary, lodging, charging, dining, activities).',
      '- "add_bucket_item" to add must-see items to the bucket list.',
      '- "add_checklist_item" to add a packing or preparation item to a checklist category.',
      '- "add_budget_estimate" to record estimated costs as line items; the budget total rolls up on its own.',
      '- "add_contact", "add_key_tip" and "add_alert" to record contacts, advice and critical alerts.',
      '- "add_expense" to record money actually spent.',
      isEV ? '- EV tools, since this is an electric-vehicle trip: "add_charging_stop" for a charging network or station, and "set_min_soc" for a minimum state-of-charge threshold on a driving leg.' : '',
      '',
      'Rules:',
      '- WRITE the plan INTO the app by calling the write-back tools. Do not answer with JSON or prose the user has to copy.',
      '- Be concrete: real place names, times of day, realistic durations, locations, and costs in the trip\'s currency.',
      '- Group a sensible number of items per day. Do not overload a day. Include transport between activities, and lodging where it is relevant.',
      '- Build the location library from your research, then place activities into days. Record reservations and pre-trip actions with their deadlines.',
      '- Prefer a few well-researched items over many vague ones.',
      '- When you are done, give a short chat summary of what you planned and cite the key URLs.',
      '- If web search is unavailable in this mode, plan from your own knowledge and say so briefly.',
      isEV ? '- Respect the vehicle\'s usable range: plan charge stops on long driving legs, and set minimum-SoC thresholds where the range is tight.' : '',
      '',
      'Today\'s date is in the trip context below. Prefer sources and events relevant to the trip dates.',
    ].filter(Boolean).join('\n');

    return [
      { role: 'system', content: instructions + '\n\nCurrent trip context:\n' + serializeTrip(trip) },
    ];
  }

  function serializeTrip(trip) {
    if (!trip) return 'No trip is currently open.';

    var dests = (trip.destinations || []).map(function (d) { return d && d.name; })
      .filter(Boolean).join(', ') || 'not stated';
    var dates = (trip.startDate && trip.endDate)
      ? TP.dates.fmtDate(trip.startDate) + ' to ' + TP.dates.fmtDate(trip.endDate) +
        ' (' + TP.format.plural(TP.dates.dayCount(trip.startDate, trip.endDate), 'day') + ')'
      : 'dates not set';
    var travelers = (trip.travelers || []).filter(function (t) { return t && t.name; })
      .map(function (t) { return t.name + ' (' + (t.type || 'adult') + ')'; }).join(', ') || 'not stated';

    var days = (trip.days || []).map(function (d, i) {
      var meta = [d.title, d.drive ? 'drive: ' + d.drive : '', d.stay ? 'stay: ' + d.stay : '', d.summary]
        .filter(Boolean).join(' | ');
      var items = (d.items || []).map(function (it) {
        var bits = ['    - [' + TP.model.itemType(it) + '] ' + (it.time || '--:--') + ' ' + it.title];
        if (it.location) bits.push('@ ' + it.location);
        if (it.cost != null) bits.push('(' + it.cost + ')');
        if ((it.flags || {}).minSoc != null) bits.push('[min SoC ' + it.flags.minSoc + '%]');
        return bits.join(' ');
      }).join('\n');
      return '  Day ' + i + ' (' + d.date + ')' + (meta ? ' [' + meta + ']' : '') + ':' + (items ? '\n' + items : ' (empty)');
    }).join('\n');

    var sections = [];
    if (trip.vehicle) {
      var v = trip.vehicle;
      var veh = '  vehicle: ' + (v.model || 'unnamed');
      if (v.usableRangeMiles) veh += ' (usable range ' + v.usableRangeMiles + ' mi)';
      if (v.chargingConvention) veh += ', ' + v.chargingConvention;
      sections.push(veh);
    }
    countIf(sections, trip.budgetEstimates, 'budgetEstimates');
    countIf(sections, trip.expenses, 'expenses');
    countIf(sections, trip.lodging, 'lodging');
    countIf(sections, trip.reservations, 'reservations');
    countIf(sections, trip.preTripActions, 'preTripActions');
    if ((trip.locations || []).length) {
      sections.push('  locations: ' + trip.locations.map(function (l) { return l.name; }).join(', '));
    }
    if ((trip.bucketList || []).length) {
      sections.push('  bucketList: ' + trip.bucketList.map(function (b) { return b.name; }).join(', '));
    }
    if ((trip.checklists || []).length) {
      sections.push('  checklists: ' + trip.checklists.map(function (c) {
        return c.category + ' (' + (c.items || []).length + ' items)';
      }).join(', '));
    }
    if ((trip.criticalAlerts || []).length) {
      sections.push('  criticalAlerts: ' + trip.criticalAlerts.map(function (a) { return a.title; }).join(', '));
    }

    return [
      '{',
      '  "title": ' + JSON.stringify(trip.title || ''),
      '  "subtitle": ' + JSON.stringify(trip.subtitle || ''),
      '  "destinations": ' + JSON.stringify(dests),
      '  "dates": ' + JSON.stringify(dates),
      '  "today": ' + JSON.stringify(TP.dates.todayISO()),
      '  "travelers": ' + JSON.stringify(travelers),
      '  "currency": ' + JSON.stringify(trip.currency || 'USD') + ',',
      sections.join(',\n') + (sections.length ? ',' : ''),
      '  "days": [',
      days,
      '  ]',
      '}',
    ].join('\n');
  }

  function countIf(sections, list, name) {
    if (list && list.length) sections.push('  ' + name + ': ' + list.length);
  }

  function userPlanMessage(instruction) {
    return {
      role: 'user',
      content: instruction || 'Plan this trip. Research with web search where it helps, then write the itinerary into the app day by day.',
    };
  }

  return {
    systemPrompt: systemPrompt,
    serializeTrip: serializeTrip,
    userPlanMessage: userPlanMessage,
  };
})();
