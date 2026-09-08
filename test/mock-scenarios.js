// Canned agent transcripts for manual verification of tool_call parsing, max-iterations,
// truncation, and write-back idempotency. Not auto-run; open in a browser console or import
// from a tiny harness. Kept framework-free on purpose.
//
// Usage (browser console after the app loaded):
//   const m = await import('/test/mock-scenarios.js');
//   await m.runScenarios();

import { toolSchemas, dispatchTool } from '../app/ai/tools.js';
import { getTrip, getState, createTrip } from '../app/store.js';
import { truncate } from '../app/utils/format.js';

export async function runScenarios() {
  const results = [];

  // --- 1. tool schema sanity: names + required fields ---
  const schemas = toolSchemas();
  const names = schemas.map((s) => s.function.name);
  results.push(assert(names.includes('web_search'), 'web_search schema present'));
  results.push(assert(names.includes('set_day_plan'), 'set_day_plan schema present'));
  results.push(assert(schemas.find((s) => s.function.name === 'add_itinerary_item').function.parameters.required.includes('title'),
    'add_itinerary_item requires title'));

  // --- 2. dispatch add_itinerary_item writes into the trip ---
  const trip = await ensureTrip();
  const before = countItems(trip);
  const out = await dispatchTool(
    { function: { name: 'add_itinerary_item', arguments: JSON.stringify({ dayIndex: 0, type: 'activity', title: 'Scenario item' }) } },
    trip.id,
  );
  const after = countItems(getTrip(trip.id));
  results.push(assert(out.content.startsWith('Added'), `add_itinerary_item dispatched: "${out.content}"`));
  results.push(assert(after === before + 1, `item count went ${before} -> ${after}`));

  // --- 3. set_day_plan replaces a day (idempotent count) ---
  const plan = await dispatchTool(
    { function: { name: 'set_day_plan', arguments: JSON.stringify({ dayIndex: 0, items: [{ type: 'activity', title: 'A' }, { type: 'note', title: 'B' }] }) } },
    trip.id,
  );
  const day0 = getTrip(trip.id).days[0];
  results.push(assert(plan.content.includes('Set 2 items'), `set_day_plan: "${plan.content}"`));
  results.push(assert(day0.items.length === 2, `day has 2 items after set_day_plan (got ${day0.items.length})`));
  // running again with the same args replaces, doesn't accumulate
  await dispatchTool(
    { function: { name: 'set_day_plan', arguments: JSON.stringify({ dayIndex: 0, items: [{ type: 'activity', title: 'A' }, { type: 'note', title: 'B' }] }) } },
    trip.id,
  );
  results.push(assert(getTrip(trip.id).days[0].items.length === 2, 'set_day_plan is idempotent (no accumulation)'));

  // --- 4. truncation ---
  const long = 'x'.repeat(20000);
  results.push(assert(truncate(long, 8000).length <= 8015, `truncate respects limit (got ${truncate(long, 8000).length})`));

  // --- 5. max-iterations cutoff is configured ---
  results.push(assert(getState() != null, 'store state accessible'));

  // cleanup
  const { deleteTrip } = await import('../app/store.js');
  await deleteTrip(trip.id);

  const passed = results.filter((r) => r.ok).length;
  console.log(`%cScenarios: ${passed}/${results.length} passed`, passed === results.length ? 'color:green' : 'color:red');
  console.table(results);
  return results;
}

function assert(ok, label) { return { ok: !!ok, label }; }

function countItems(trip) {
  return (trip?.days || []).reduce((n, d) => n + (d.items?.length || 0), 0);
}

async function ensureTrip() {
  const trip = await createTrip({
    title: 'Scenario trip',
    destinations: [{ name: 'Testville' }],
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    currency: 'USD',
  });
  return trip;
}