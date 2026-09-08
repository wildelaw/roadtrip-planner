# Metadata Expansion Plan — track everything in trip-data.json

## Context

The planner now imports/exports `trip-data.json` **losslessly** (see `app/io.js`): the full
original object is preserved on the trip as `importedRaw`, the understood parts are mapped into the
native model, and all rich sections are carried through round-trip. Today only **trip metadata,
day itinerary items, and budget** are first-class editable features. Everything else is stored but
not surfaced with its own editor.

This plan promotes each remaining `trip-data.json` section into a first-class, editable,
AI-writable feature. Each section below lists: current state, proposed native model, UI placement,
AI agent tool, and migration notes. A phased build order is at the end.

Reference schema (`trip-data.json` top-level keys):
`trip, lodging, reservations, noReservationNeeded, preTripActions, bucketList, chargingNetworks,
minSocThresholds, locations, days, checklists, budgetEstimates, contacts, keyTips, criticalAlerts`.

Legend for what's already tracked vs. planned:

- ✅ already first-class editable
- 🟡 stored + shown read-only (added with import/export work)
- 🔵 planned by this doc

---

## 1. Trip-level metadata

| Field | Status | Plan |
|---|---|---|
| `trip.title`, `startDate`, `endDate` | ✅ | — |
| `trip.subtitle` | 🟡 shown in itinerary header | 🔵 Add to the Edit-trip modal as a one-line tagline. Store on `trip.subtitle`. |
| `trip.vehicle` (model, batteryKWh, efficiencyMilesPerKWh, fullRangeMiles, usableRangeMiles, chargingConvention) | 🟡 shown in itinerary header | 🔵 New **Vehicle** editor (modal or Settings-per-trip). Model is generic; the EV fields are optional/advanced. Drives the EV features in §5/§6. |

**Model:** `trip.subtitle: string`; `trip.vehicle: { model, batteryKWh?, efficiencyMilesPerKWh?, fullRangeMiles?, usableRangeMiles?, chargingConvention? }`.

---

## 2. Lodging (`lodging[]`) — 🔵

Currently lodging only exists as `type:"lodging"` itinerary items, which loses check-in/out,
nights, area, and notes.

**Model:** `trip.lodging: [{ id, location, checkIn, checkOut, nights?, area?, notes? }]`.

**UI:** New **Lodging** tab (or a card on Itinerary). List with add/edit/delete; show date range and
nights; link a lodging entry to the days it covers (derived from check-in/out vs. trip days).

**AI tool:** `add_lodging`, `update_lodging` (mirrors `add_itinerary_item`). On import, also keep
the itinerary "Check into hotel" item but cross-reference the lodging entry.

---

## 3. Reservations & bookings (`reservations[]`, `noReservationNeeded[]`, `preTripActions[]`) — 🔵

Three related lists about things to book and pre-trip todos.

**Model:**
- `trip.reservations: [{ id, what, when, duration?, cost?, howToBook?, bookBy?, priority? }]`
- `trip.noReservationNeeded: [{ id, what, notes? }]`
- `trip.preTripActions: [{ id, text, category, priority }]`

**UI:** New **Bookings & tasks** tab with three sub-sections (or a single triaged list with a
status filter: `reservation | no-reservation | pre-trip-action`). Each row: checkbox/done state,
priority badge (high/med/low), "Book by" date with overdue highlighting, deep link to `howToBook`.
`priority` reuses the existing tag styling.

**AI tool:** `add_reservation`, `add_pre_trip_action`, `complete_action` (mark done). The agent
already researches via `web_search`; these let it record concrete booking tasks with deadlines.

**Migration:** `confirmation` on itinerary items is a narrower version of a reservation; leave
both (item.confirmation stays for per-item, reservation is the planning list).

---

## 4. Bucket list & locations (`bucketList[]`, `locations[]`) — 🔵

`bucketList` is dated must-see items; `locations` is a richer POI library (summary, lodging,
charging, dining, structured activities).

**Model:**
- `trip.bucketList: [{ id, name, date?, dateLabel? }]`
- `trip.locations: [{ id, name, icon?, summary?, lodging?, charging?: string[], dining?: string[], activities?: [{ name, type, desc }] }]`

**UI:** A **Places** tab. Top: bucket list as dated chips. Below: location cards with icon,
summary, and expandable activities (each activity can be "Add to a day" → creates an itinerary
item). `dining` entries can be added as dining itinerary items.

**AI tool:** `add_location`, `add_bucket_item`, `add_activity_to_day(locationId, activityName, date)`.
This is the natural bridge between research and itinerary: the agent builds the location library
from web search, then places activities into days.

---

## 5. EV / charging (`chargingNetworks[]`, `minSocThresholds[]`, per-day `drive/chargeStops/nacs`,
per-item `charge/overnight/minSoc/minSocCritical`) — 🔵 (EV mode; gated on `trip.vehicle`)

EV-specific. Only show if `trip.vehicle` is set (a toggle "This is an EV trip").

**Model:**
- `trip.chargingNetworks: [{ id, name, location, network, nacsAdapter? }]`
- `trip.minSocThresholds: [{ day, leg, minSoc, reason, severity? }]`
- Day fields: `day.drive`, `day.chargeStops`, `day.nacs`, `day.stay` (already preserved).
- Item flags: `item.flags.{ charge, overnight, tour, warn, minSoc, minSocCritical }` (already stored).

**UI:**
- A **Charging** sub-tab (under EV mode) listing charging networks and per-leg min-SoC thresholds
  with severity colors (reuse `info--warn`/`info--danger`).
- Itinerary day header already shows `drive / chargeStops / stay` (done). Add a per-day **Charge
  plan** mini-panel listing the day's `charge` items with min-SoC.
- Item flag badges (⚡🌙🎟️⚠️🔋) already render (done).

**AI tool:** `add_charging_stop`, `set_min_soc`. In EV mode the system prompt gets an EV appendix
instructing the agent to respect usable range and plan charge stops.

---

## 6. Checklists (`checklists{}`) — 🔵

Grouped packing/prep lists keyed by category (`evDriving, clothing, hikingOutdoors, jeepTour,
estateSales, digitalPrep`).

**Model:** `trip.checklists: { [category: string]: string[] }` (already stored verbatim).
Add a typed wrapper: `trip.checklists: [{ id, category, items: [{id, text, done}] }]` to support
per-item done state and reordering, while keeping export compatibility by converting back to the
`{category: string[]}` shape.

**UI:** A **Checklists** tab. Collapsible category groups with checkboxes; "+ item" per group;
"+ category". Export normalizes back to the original `{category: string[]}` shape (drop done state,
which isn't in the format).

**AI tool:** `add_checklist_item(category, text)`.

---

## 7. Budget estimates (`budgetEstimates[]`) — 🔵

Currently flattened into `budget.categories` (numeric totals only), losing per-line items,
non-numeric costs ("est. $450–600", "Already have"), and the `optional` flag.

**Model:** `trip.budgetEstimates: [{ category, item, cost, optional }]` (already stored). Keep
`trip.budget.categories` as the derived roll-up; make `budgetEstimates` the editable source of
truth and recompute categories from it.

**UI:** Rework the **Budget** tab to show budget estimates as a line-item table (category, item,
cost, optional), grouped by category with subtotals. The existing `expenses` (actual spend) stays
for tracking real spend vs. estimates.

**AI tool:** `add_budget_estimate(category, item, cost, optional)` (replaces the stubbed
`set_budget`).

---

## 8. Contacts, key tips, critical alerts (`contacts[]`, `keyTips[]`, `criticalAlerts[]`) — 🔵

**Model:** (already stored)
- `trip.contacts: [{ what, how }]`
- `trip.keyTips: string[]`
- `trip.criticalAlerts: [{ severity, title, text }]`

**UI:**
- `criticalAlerts` + `keyTips`: already shown read-only in the Itinerary "Alerts & tips" card
  (done). 🔵 Add edit: an "Add alert" control and per-alert delete; severity picker (danger/warn).
- `contacts`: show in the Bookings & tasks tab (or a small **Contacts** card on Itinerary) as
  "what → how" rows with linkified `how` when it's a URL.

**AI tool:** `add_contact`, `add_key_tip`, `add_alert`.

---

## 9. Day-level rich fields (already partially shown) — 🔵 finish

Day `title, stay, drive, chargeStops, nacs, summary, dining[], tips[]` are preserved and `title /
stay / drive / summary / tips` are shown. Finish:
- 🔵 Editable day header: click the day title/summary to edit; a "Day notes" editor for `dining[]`
  and `tips[]`.
- Ensure `updateTripDates` preserves day meta when the date range changes (currently it rebuilds
  days from `expandDays` and would drop meta — fix by matching by date and carrying meta over).

**AI tool:** `set_day_meta(date, { title, stay, drive, summary, dining, tips })` — companion to the
existing `set_day_plan`.

---

## Migration & compatibility

- **No breaking schema change.** All new fields are additive on the trip document; IndexedDB stores
  arbitrary objects, and `updateTrip`/`updateTripDates` spread preserves unknown fields.
- **Import** (`mapImportToTrip`) already populates every section above; no change needed as features
  ship — editors just start reading/writing the fields that are already there.
- **Export** (`buildExportObject`) already round-trips every section losslessly; per-section editors
  must write back to the same field names so export keeps working. For `checklists`, export
  normalizes the typed `{category, items}` back to `{category: string[]}`.
- **Old trips** (created before a feature) simply have empty arrays for the new sections; editors
  render an empty state.

## AI agent integration

Each new section gets a tool in `app/ai/tools.js` (schemas + dispatch) and a sentence in the system
prompt (`app/ai/prompt.js`) so the agent knows it can write there. Tools follow the existing
`add_itinerary_item` / `set_day_plan` pattern (mutate via `store.js`, persist, re-render, return a
short confirmation). EV tools are only injected when `trip.vehicle` is set. This keeps the agent
loop unchanged — just more tools in the `tools` array.

## Phased build order

1. **Trip meta + checklists** (low risk, high value): `trip.subtitle` + `vehicle` editor; Checklists
   tab with per-item done state. Export normalization for checklists.
2. **Budget estimates rework**: line-item editor as source of truth; recompute categories.
3. **Bookings & tasks**: reservations / noReservationNeeded / preTripActions with priority, book-by
   dates, done state. Contacts card.
4. **Places**: locations library + bucket list; "add activity to day" bridge to itinerary.
5. **Lodging**: lodging tab linked to days.
6. **EV mode** (gated on vehicle): charging networks, min-SoC thresholds, day charge-plan panel,
   EV system-prompt appendix, EV tools. Fix `updateTripDates` meta preservation.
7. **Alerts/tips editing**: editable criticalAlerts + keyTips; polish.

Each phase is independently shippable and verifiable with the mock transport (no API spend) plus the
real `trip-data.json` round-trip test already in place.