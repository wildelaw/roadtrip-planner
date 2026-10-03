# 03 — Data model

The canonical model, the passthrough bags, and the container envelope.
Implements `REQ-201`–`REQ-213`.

---

## 1. The payload is one trip

`PATTERN.md` §8.3 gives the payload for a vacation planner as "Trip: travellers, legs, bookings,
activities, budget, documents" — singular. This instance takes that literally: **one file, one trip**
(`REQ-201`, `ADR-0016`).

Consequences that are not obvious and are therefore stated:

| Consequence | Detail |
|---|---|
| The sidebar is a **registry**, not a store | It lists known documents — a convenience index, re-seeded from files on every load (`REQ-405`, `PAT-AP-09`). Deleting an entry never deletes a document (`REQ-406`) |
| "New Trip" mints a new **document** | New `docId`, new empty history with a root commit, empty payload |
| Importing a trip becomes a document | Importing `trip-data.json` or `.ics` creates a new document by default; replacing the current document's payload is a separate, explicitly confirmed commit (`REQ-616`) |
| "Export all trips" disappears | It has no meaning when a document is one trip. The registry can export each document it knows |

Today the app stores many trips in one IndexedDB store (`app/db.js:16-18`) and `exportAllTrips`
(`app/store.js:312`) emits a JSON array. That is the shape being retired, not an alternative being
rejected — see `ADR-0016`.

---

## 2. The canonical model is a superset

`PATTERN.md` §5.3, P1 and P2. Implements `REQ-202`, `REQ-208`.

> **P1 — Neutral superset, never a lowest common denominator.** The canonical model represents the
> union of what the external formats can express. Where only one format has a concept, the concept
> still exists internally; the other format's export reports it as unrepresentable.

The tempting mistake is mapping both formats onto their intersection. A converter that maps field to
field drops data with no counterpart, and the loss is invisible: the document still validates, still
renders, and is simply missing what someone wrote. `trip-data.json` has budget, expenses, EV
charging data and a booking list; iCalendar has recurrence, alarms, attendees and time zones. The
union is much larger than the intersection, and the union is what is modelled.

### 2.1 Entities

| Entity | Canonical fields | Required (canonical) | Source format(s) |
|---|---|---|---|
| **Trip** | `id`, `docId`, `title`, `subtitle`, `currency`, `startDate`, `endDate`, `destinations[]`, `travelers[]`, `vehicle`, `x` | `id`, `title` | both |
| **Day** | `id`, `date`, `title`, `stay`, `drive`, `chargeStops`, `nacs`, `summary`, `dining[]`, `tips[]`, `items[]`, `x` | `id`, `date` | both |
| **Item** (itinerary entry) | `id`, `type`, `title`, `time`, `timeRaw`, `location`, `cost`, `currency`, `durationMin`, `confirmation`, `link`, `notes`, `flags`, `x` | `id`, `title` | both |
| **Destination** | `id`, `name`, `x` | `id`, `name` | trip-data |
| **Traveler** | `id`, `name`, `type` | `id`, `name` | trip-data |
| **Vehicle** | `model`, `batteryKWh?`, `efficiencyMilesPerKWh?`, `fullRangeMiles?`, `usableRangeMiles?`, `chargingConvention?` | `model` | trip-data |
| **Lodging** | `id`, `location`, `checkIn`, `checkOut`, `nights?`, `area?`, `notes?`, `confirmation?`, `x` | `id`, `location` | trip-data |
| **Reservation** | `id`, `what`, `when?`, `duration?`, `cost?`, `howToBook?`, `bookBy?`, `priority?`, `done?`, `x` | `id`, `what` | trip-data |
| **NoReservation** | `id`, `what`, `notes?`, `x` | `id`, `what` | trip-data |
| **PreTripAction** | `id`, `text`, `category`, `priority`, `done?`, `x` | `id`, `text` | trip-data |
| **BucketItem** | `id`, `name`, `date?`, `dateLabel?`, `x` | `id`, `name` | trip-data |
| **ChargingNetwork** | `id`, `name`, `location`, `network`, `nacsAdapter?`, `notes?`, `x` | `id`, `name` | trip-data |
| **MinSocThreshold** | `id`, `day`, `leg`, `minSoc`, `reason`, `severity?`, `x` | `id`, `minSoc` | trip-data |
| **Location** (POI) | `id`, `name`, `icon?`, `summary?`, `lodging?`, `charging[]`, `dining[]`, `activities[]`, `x` | `id`, `name` | trip-data |
| **Contact** | `id`, `what`, `how`, `x` | `id`, `how` | trip-data |
| **CriticalAlert** | `id`, `severity`, `title`, `text`, `x` | `id`, `title` | trip-data |
| **KeyTip** | *(string, no identity)* | — | trip-data |
| **ChecklistCategory** | `id`, `category`, `items[{id, text, done}]`, `x` | `id`, `category` | trip-data |
| **BudgetEstimate** | `id`, `category`, `item`, `cost`, `optional?`, `x` | `id`, `item` | trip-data |
| **Expense** | `id`, `date`, `category`, `amount`, `label`, `dayId?`, `x` | `id`, `date` | trip-data |

Canonical requires almost nothing — an id and a name (`REQ-203`). Format-specific required fields are
satisfied by **synthesis at export** (§7), and every synthesized value is disclosed.

`KeyTip` is deliberately identity-free because `trip-data.json` defines it as a `string[]`; giving it
an id would change the round-trip on a format that has none. It is the one entity where the canonical
model follows the wire, and the exception is recorded here rather than silently made.

**Every field in this table is a field the wire names.** `trip-data.json` is written from a closed
list (`TRIP_KEYS` / `DAY_KEYS` / `ITEM_KEYS` / `COLLECTION_KEYS`), so a canonical field that list omits
is one a panel can write, the model can hold, and the exporter silently destroys. `confirmation` on a
lodging stay, `notes` on a charging network and `link` on an item were three of them; two panels were
also writing names the wire never uses (`chargingNetworks[].adapter` for `nacsAdapter`, and
`expenses[].item` for `label`). `ADR-0022` records the class and the guard against a sixth.

### 2.2 Fields the model adds beyond either format

These exist so that the union is genuinely a superset, and so the app can hold state that no external
format can express:

| Field | Why it exists |
|---|---|
| `done?` on reservations and pre-trip actions | A UI affordance with no `trip-data.json` counterpart. It is stripped on export (`app/io.js:130`) — and under this spec the stripping is *ledgered*, not incidental |
| `flags{}` on items | EV/charging semantics already carried (`app/io.js:48-51`), and unrepresentable in iCalendar |
| `x` on every entity | The passthrough bag (§4) |
| `docId` on the trip | The document identity that history binds to (§5) |

### 2.3 Derived roll-ups are not canonical

`budget.categories` today is a derived roll-up of `budgetEstimates` (`app/io.js:213-221`,
`app/store.js:250-268`). Roll-ups are **recomputed, never stored** in the container. Storing a
derived value alongside its source creates two truths that a merge can desynchronise; the merge
would then have to arbitrate between them, and any arbitration is a guess.

---

## 3. Identity

`PATTERN.md` §5.3. Implements `REQ-204`.

| Rule | |
|---|---|
| An entity's internal id **never changes** because of an export | It is assigned once, on creation or first import, and is preserved verbatim on re-import |
| Format-specific identifiers are **derived**, deterministically | The iCalendar `UID` is `{trip.id}/{item.id}@trip-planner.invalid`, computed at export and never stored. Re-exporting produces the same `UID`, so re-importing an exported file **matches** rather than duplicating |
| A format that supplies its own id is preserved | `trip-data.json` may carry `id` on collection items; the current code already preserves it and strips its own synthetic ids on export when the source had none (`app/io.js:126-132`). That behaviour is required, not incidental |
| `docId` identifies the **document**, not the trip | It is what history binds to. Two files with different `docId`s are registered separately and never merged (`REQ-304`, `05-storage.md` §4) |

`uid()` today is `crypto.randomUUID()` with a fallback (`app/utils/id.js:2-7`). It stays — identity
generation is not security-sensitive and needs no change. The fallback path is what matters under
`file://`, and it already exists.

---

## 4. Passthrough bags

`PATTERN.md` §5.3, P2. Implements `REQ-205`–`REQ-207`.

```json
"x": {
  "tripDataJson": { "…": "fields only the JSON format has" },
  "iCal":         { "…": "properties only iCalendar has" }
}
```

| Rule | |
|---|---|
| Every field the canonical model does not represent is preserved **verbatim**, keyed by source format | `REQ-205` |
| An empty bag is **omitted**, never emitted as `{}` | `REQ-206` |
| Bags are **opaque to the UI**: shown, attributed, preserved — not interpreted | `REQ-207` |
| Bags are per-entity, not per-document | An unmodelled property on one `VEVENT` lives on that item, not in a document-level dumping ground |

The present code already has the idea in two ad-hoc forms: `importedRaw` on the trip
(`app/io.js:82`) and `_src` on days and items (`app/io.js:36,47`). This spec generalises them —
one name, one shape, per-entity, with the omission rule and the opacity rule made explicit. The
generalisation is what turns `PAT-AP-08` ("a lossy import with no ledger") from a live risk into a
mechanical check: the ledger in `06-interchange.md` §3 classifies every field, and anything not
mapped has a bag to live in.

Worked example — an iCalendar `VEVENT` with an alarm:

```json
{
  "id": "8f14e45f-…",
  "type": "activity",
  "title": "Ferry to Miyajima",
  "time": "09:30",
  "x": {
    "iCal": {
      "UID": "3c9909af-…/8f14e45f-…@trip-planner.invalid",
      "VALARM": { "TRIGGER": "-PT30M", "ACTION": "DISPLAY" },
      "SEQUENCE": 2,
      "STATUS": "CONFIRMED"
    }
  }
}
```

On export those come back out. On a `trip-data.json` export they are **unrepresentable** and disclosed
as such by the ledger.

---

## 5. The container

`PATTERN.md` §5.2. Implements `REQ-209`–`REQ-213`.

```json
{
  "$schema": "https://trip-planner.invalid/schemas/container-1.0.0.schema.json",
  "format": "1.0.0",
  "payload": { "trip": { } },
  "history": {
    "keyframeInterval": 20,
    "head": "sha256:…",
    "commits": [ ]
  },
  "build": {
    "appVersion": "0.2.0",
    "appHash": "sha256-…",
    "generatedAt": "2026-09-29T12:00:00Z"
  }
}
```

| Field | Rule | Requirement |
|---|---|---|
| `format` | Container format version, **independent** of the app version and of the payload's own version | `REQ-209` |
| `payload` | The canonical model **at the head commit** — never the working copy | `REQ-210` |
| `history.commits` | The DAG, in topological order | `REQ-304` |
| `history.head` | The commit the working copy was last synchronised to | — |
| `build.appHash` | The declared build hash, checked by export self-verification | `REQ-508` |
| `build.generatedAt` | **Informational. Never used to decide precedence** | `REQ-213`, `PAT-INV-03` |

An unknown `format` newer than the app is opened **read-only, with an explanation** (`REQ-212`). The
app never guesses at a format's semantics — guessing wrong is worse than refusing, because a guess
that parses will be written back.

### 5.1 What the container omits

| Omitted | Why | Requirement |
|---|---|---|
| The working copy | Not a property of a portable document; it is *derived* from the head | `REQ-211` |
| Storage bookkeeping | Local, and unreliable across origins | `REQ-211` |
| Per-user preferences | Local to a person, not to a trip | `REQ-211` |
| **AI conversations** | Per-user state. They stay app-local and never enter the file | `REQ-410` |

The last one is worth its own line. AI conversations are stored today in IndexedDB alongside trips
(`app/db.js:19-21`). They are excluded from the container deliberately — and because the AI subsystem
does not run under `file://` at all (`ADR-0015`), they are also unreachable in the portable form.
Two independent reasons, same conclusion.

---

## 6. Commit records

`PATTERN.md` §5.4, §5.5. Full design in `04-versioning.md`.

```json
{
  "id": "sha256:…",
  "docId": "…",
  "parents": ["sha256:…"],
  "author": { "name": "…", "email": "…" },
  "timestamp": "2026-09-29T12:00:00Z",
  "message": "Move the ferry to day 3",
  "payloadHash": "sha256:…",
  "snapshot": { }
}
```

Exactly one of `snapshot` or `delta` is present, never both, never neither (`REQ-308`). Neither is
an input to the hash (`REQ-302`) — which is what makes re-keyframing and compaction free, and what
prevents `PAT-AP-06`.

---

## 7. Synthesis versus blocking

`PATTERN.md` §8.1 step 4: *synthesize when a neutral default is honest and disclosed; block when any
invented value would be a false statement.* Implements `REQ-203`.

| Field | On export to | Rule |
|---|---|---|
| iCalendar `UID` | `.ics` | **Synthesize** — `{trip.id}/{item.id}@trip-planner.invalid`, deterministic (§3) |
| iCalendar `DTSTAMP` | `.ics` | **Synthesize** — the export time; informational and correct as such |
| iCalendar `DTSTART` | `.ics` | **Synthesize** from the day's date as an all-day `DATE` when the item has no time. Honest: the plan says "this day", and an all-day event says exactly that |
| iCalendar `DTSTART` with no day date | `.ics` | **Block** the item and disclose. There is no day, so any date would be invented. The rest of the export proceeds |
| iCalendar `SUMMARY` | `.ics` | Never synthesized: canonical requires a title (§2.1), so it is present or the entity does not exist |
| `trip.currency` absent | `trip-data.json` | **Synthesize** `USD`, disclosed. A neutral default that the format itself assumes |
| `trip-data.json` `trip.title` | `trip-data.json` | Canonical-required, so never synthesized |
| `expenses[].category` | `trip-data.json` | **Synthesize** `"General"` — already the present behaviour (`app/io.js:145`), disclosed |

Blocking is per-entity, never per-document: one item that cannot be honestly dated does not fail the
export, it is reported. `PATTERN.md` §5.9's rule — every limit "fails with an explanation and an offer
to export what was readable, never a blank page" — applies to synthesis failures too.

---

## 8. Canonical serialization

`PATTERN.md` §5.11; full rules in `04-versioning.md` §2. Implements `REQ-305`, `REQ-306`.

The hashing input is `canonicalSerialize(payload)`: sorted keys, no insignificant whitespace, defined
number and string normalization. It has **one implementation**, shared by the application and the
test harness — two implementations that "should" agree are two implementations that will eventually
disagree, and the disagreement would present as every commit in every circulated file failing to
verify.

---

## 9. Present state

| Target | Today |
|---|---|
| Canonical superset with bags | Field-by-field mappers (`mapImportToTrip`, `buildExportObject` in `app/io.js`) plus `importedRaw` and per-entity `_src` |
| One trip per document | Many trips in one IndexedDB store (`app/db.js:16-18`) |
| Container with `format`/`payload`/`history`/`build` | No container. `source: {format:'trip-data.json', version:1, importedAt}` (`app/io.js:83`) is the only version stamp |
| Commit records | None |
| Derived roll-ups recomputed | `budget` is persisted on the trip alongside `budgetEstimates` (`app/store.js:250-268`), i.e. two truths |
| `x` bags, one name, per entity | `importedRaw` + `_src`, two names, two shapes |
| Identity preserved, format ids derived | Preserved (`app/io.js:126-132`); no derived format ids exist yet |
