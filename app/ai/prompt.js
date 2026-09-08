// System prompt builder + current-trip context serializer.

import { fmtDate, dayCount } from '../utils/dates.js';

export function systemPrompt(trip) {
  const isEV = !!(trip && trip.vehicle);
  const instructions = `You are an expert travel planning agent inside a browser trip-planner app.
Your job is to research and build a concrete, day-by-day itinerary for the user's trip.

You have tools. Use them:
- "web_search" and "web_fetch" to research current info (opening hours, prices, transport, weather, events). Cite URLs in your chat messages.
- "get_trip_summary" to read the current trip before planning (avoid duplicates).
- "add_itinerary_item" to add a single activity/transport/lodging/note to a specific day (by date or dayIndex).
- "set_day_plan" to replace an entire day's plan with multiple items at once (prefer this for a full day).
- "set_day_meta" to set a day's title, drive summary, stay, summary text, dining list, or tips.
- "add_activity_to_day" to place a researched place/activity onto a specific day.
- "add_lodging" to record where you sleep each night (check-in/out, area, notes).
- "add_reservation" to record something that needs booking (with a book-by deadline and how to book).
- "add_pre_trip_action" to record pre-trip todos (documents, packing, prep).
- "add_location" to add a place to the location library (POI with summary, lodging, charging, dining, activities).
- "add_bucket_item" to add must-see items to the bucket list.
- "add_checklist_item" to add a packing/prep item to a checklist category.
- "add_budget_estimate" to record estimated costs as line items (the budget total rolls up automatically).
- "add_contact", "add_key_tip", "add_alert" to record useful contacts, key tips, and critical alerts.
- "add_expense" to record actual spend; "set_budget" for an overall total.
${isEV ? `- EV tools (this is an EV trip): "add_charging_stop" to record a charging network/station, and "set_min_soc" to set a minimum state-of-charge threshold for a driving leg.\n` : ''}Rules:
- WRITE the plan INTO the app by calling the write-back tools. Do not just dump JSON prose.
- Be concrete: real place names, times of day, realistic durations, locations, and estimated costs in the trip's currency.
- Group a sensible number of items per day (don't overload). Include transport between activities and lodging where relevant.
- Build the location library from research, then place activities into days. Record reservations and pre-trip actions with deadlines.
- Prefer a few well-researched items over many vague ones.
- After writing, give a short chat summary of what you planned and cite key URLs.
- If web search is unavailable (local mode), plan from your own knowledge and say so briefly.
${isEV ? `- Respect the vehicle's usable range: plan charge stops on long driving legs and set min-SoC thresholds where range is tight.\n` : ''}Today's date is provided in the trip context. Prefer sources and events relevant to the trip dates.`;
  const context = `Current trip context:\n${serializeTrip(trip)}`;
  return [
    { role: 'system', content: `${instructions}\n\n${context}` },
  ];
}

export function serializeTrip(trip) {
  if (!trip) return 'No trip is currently selected.';
  const dests = (trip.destinations || []).map((d) => d.name).filter(Boolean).join(', ') || 'unspecified';
  const dates = trip.startDate && trip.endDate
    ? `${fmtDate(trip.startDate)} to ${fmtDate(trip.endDate)} (${dayCount(trip.startDate, trip.endDate)} days)`
    : 'dates not set';
  const travelers = (trip.travelers || []).filter((t) => t.name).map((t) => `${t.name} (${t.type})`).join(', ') || 'unspecified';
  const today = new Date().toISOString().slice(0, 10);

  const days = (trip.days || []).map((d, i) => {
    const meta = [d.title, d.drive && `drive: ${d.drive}`, d.stay && `stay: ${d.stay}`, d.summary].filter(Boolean).join(' | ');
    const items = (d.items || []).map((it) =>
      `    - [${it.type || 'activity'}] ${it.time || '—'} ${it.title}${it.location ? ' @ ' + it.location : ''}${it.cost != null ? ` (${it.cost})` : ''}`
    ).join('\n');
    return `  Day ${i} (${d.date})${meta ? ' [' + meta + ']' : ''}:${items ? '\n' + items : ' (empty)'}`;
  }).join('\n');

  const sections = [];
  if (trip.vehicle) {
    const v = trip.vehicle;
    sections.push(`  vehicle: ${v.model}${v.usableRangeMiles ? ` (usable ${v.usableRangeMiles} mi)` : ''}${v.chargingConvention ? `, ${v.chargingConvention}` : ''}`);
  }
  if (trip.budgetEstimates?.length) sections.push(`  budgetEstimates: ${trip.budgetEstimates.length} line items`);
  if (trip.locations?.length) sections.push(`  locations: ${trip.locations.map((l) => l.name).join(', ')}`);
  if (trip.reservations?.length) sections.push(`  reservations: ${trip.reservations.length}`);
  if (trip.preTripActions?.length) sections.push(`  preTripActions: ${trip.preTripActions.length}`);
  if (trip.lodging?.length) sections.push(`  lodging: ${trip.lodging.length}`);
  if (trip.checklists?.length) sections.push(`  checklists: ${trip.checklists.map((c) => c.category).join(', ')}`);

  return `{
  "title": "${trip.title}",
  "subtitle": "${trip.subtitle || ''}",
  "destinations": "${dests}",
  "dates": "${dates}",
  "today": "${today}",
  "travelers": "${travelers}",
  "currency": "${trip.currency || 'USD'}",
  "budget": ${JSON.stringify(trip.budget || { total: 0, categories: [] })},${sections.length ? '\n' + sections.join('\n') : ''}
  "days": [
${days}
  ]
}`;
}

export function userPlanMessage(instruction) {
  return {
    role: 'user',
    content: instruction || 'Plan this trip. Research with web search where useful, then write the itinerary into the app day by day.',
  };
}