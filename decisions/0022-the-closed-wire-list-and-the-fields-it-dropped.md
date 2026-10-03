# ADR-0022 — the closed wire list, and the five fields it was dropping

- **Status:** Accepted
- **Pattern decision:** Not a `PAT-DEC` — instance-specific (what a first-party exporter owes the
  fields a panel writes), but it is the reason `PAT-INV-10` can be claimed for `trip-data.json` at all
- **Specified in:** `06-interchange.md` §3.2, §3.3; `03-data-model.md` §2.1
- **Deviation:** **Yes** — `REQ-504`'s "import is lossless" was met by the reader and broken by the
  writer. The ledger said `M` for fields the mapper never wrote

## Context

The complaint was that the planning agent could not record a **lodging confirmation number**. It could
not, and neither could anybody else, because the confirmation number never reached the file at all.
The reported field turned out to be one instance of a class.

`src/interchange/tripdatajson.js` is a **closed-field-list** mapper. For each entity it writes the
fields named in `TRIP_KEYS` / `DAY_KEYS` / `ITEM_KEYS` / `COLLECTION_KEYS`, plus the members of the
entity's passthrough bag:

```js
// fromEntity — the named fields first …
COLLECTION_KEYS entries →
emitUnknown(out, entity);      // … then everything in the bag
```

The retired app (`app/io.js:128-133`) was the opposite: `clone(it)`, whatever the model row carried.
Migrating to `src/` therefore introduced a silent-data-loss class the app had never had — **any field
a panel writes straight onto a model row that no key table names is destroyed on export, with no
disclosure and no error.** Five of them were live:

| Field | Entity | What the wire calls it | What a person lost |
|---|---|---|---|
| `confirmation` | `lodging[]` | *(nothing)* | A booking reference typed into the Lodging panel. This is the one that was reported |
| `adapter` | `chargingNetworks[]` | `nacsAdapter` | **"Adapter needed" has never once persisted**, in any version of this app |
| `notes` | `chargingNetworks[]` | *(nothing)* | The Charging panel's Notes column, discarded on save |
| `link` | `days[].items[]` | *(nothing)* | A URL typed onto an itinerary item — visible for the rest of the session, gone on reopen |
| `item` | `expenses[]` | `label` | Every "Item" description on a recorded expense, exported as `label: ""` |

Two of the five (`adapter`, `item`) are not missing wire fields at all. The wire already carries
`nacsAdapter` and `label`, and `03-data-model.md` §2.1 names both. The panel simply wrote a different
name — so those two also broke the *display*: an imported row's value was invisible in the panel that
was supposed to show it.

### Why the checks that existed could not see it

`REQ-809`'s completeness check is real, and it passed the whole time. It is driven by
`TP.ledger.kindOf`, which resolves an exact path first and then the **longest segment-bounded prefix**.
That rule is load-bearing — it is what lets the ledger stay as coarse as the spec's tables
(`lodging[]` covers `lodging[0].location`) — and it is exactly why the ledger said **M** for
`lodging[0].confirmation`: the `lodging[]` row covers every path beneath it, including the one the
mapper dropped on the floor.

The `REQ-809` test is driven over a corpus, and **the corpus was the blind spot**: `h.maximalTrip` and
`h.randomTrip` (`test/harness.js`) populated precisely the fields the ledger already named.
`h.maximalTrip` built a `lodging` row with six fields and no `confirmation`, and a `chargingNetworks`
row with `nacsAdapter` rather than the panel's `adapter`. The check has never been asked about a field
nobody wrote down, which is the only kind of field it exists to catch. `ADR-0008` names this failure
exactly — "a thin corpus ships a divergence with a passing test" — and this is a second instance of it
in the same repository.

## Decision

**The five fields are on the wire; the two misnamed panels write the wire's name; and the guard is a
check over the panels themselves, because no corpus can enumerate a field nobody thought to add.**

`REQ-504` is a promise about the *pair* of mappers, and the pair is only as good as its weaker half. The
ledger, `06-interchange.md` §3's tables, `03-data-model.md` §2.1 and the vendored schema are all
statements about the same set of fields, so all four move together (`PROVENANCE.md`: the schema is
edited by hand, and "the mapper's `TRIP_KEYS` / `DAY_KEYS` / `ITEM_KEYS` / `COLLECTION_KEYS` tables are
what it must agree with").

### The two renames are the panels' business, not the wire's

`chargingNetworks[].adapter` and `expenses[].item` were wrong names in `src/ui/`, and the wire's names
are already right. **Nothing is migrated, because nothing was ever persisted** — that is the same fact
that makes the fields worth a second look rather than a repair: the value these keys wrote has never
existed on disk, so there is no file anywhere holding one.

`expenses[].item` becomes `label`, which is also what `rollupBudget` and the model already use.
`budgetEstimates[].item` is a real field of a different collection and stays where it is — the same
three letters, and the reason a grep is not a fix.

### `item.link` reaches a calendar only when it is already a URL

A calendar carries a link as a `URL`, and a `URL` must be a URI (`06-interchange.md` §3.2). The model's
`link` is free text — a person may type `the museum website`, or nothing at all. So the mapper carries
the value **only when `TP.format.linkifyTarget(s) === s`**: the value is already an absolute URL the app
would use verbatim. Anything else stays on the item; `trip-data.json` keeps it and the calendar does not
carry it. The ledger says so in the row, because "M" for a field that is conditionally carried is a
claim a reader has to be able to check.

This is the same rule `costRaw` and `timeRaw` already follow, and it is what makes export a fixed
point: `www.example.com` linkifies to `https://www.example.com`, so writing it as a `URL` and reading
it back would change the value. The alternative — writing the free text into `URL:` — makes the app's
own export fail its own validator, which is how the widened corpus first reported it.

### No generation bump, and no history break

`ADR-0019`'s upgrade mechanism is **not** needed here, and this is a claim rather than a hope:

- **The bytes do not change.** For a row that already carries a value, `emitUnknown` was *already*
  writing it at the top level, and `canonical.serialize` sorts keys. Naming the field in the key table
  moves the write from the bag branch to the named branch and changes nothing observable. Verified by
  mutating the key table at runtime and re-exporting: byte-identical.
- **No generation-1 file can carry one.** The retired app's model had no such field, and its exporter
  passed model fields through, so there is nothing for an upgrade to find. The one real document in the
  repository was checked: its lodging rows carry no `confirmation`.
- **History is not re-derived.** `verify.payload` reconstructs from the **stored** snapshots and deltas,
  never from the wire, so a representation change cannot invalidate an existing document's chain.

The one real behaviour change is that a **non-string** `confirmation` / `notes` / `link` is now
*invalid*, where an unknown property was previously accepted by an open schema. That is the schema
doing its stated job — "TYPES on the fields the app does interpret" — and it is what `durationMin: "90"`
already does. The malformed corpus gained a case per field so both validators agree on refusing them.

### The stale bag member, and `emitUnknown`'s running order

`emitUnknown` writes the bag **after** the named fields. Until this generation, `lodging[].confirmation`
reached the wire *through the bag*, so a document already on disk has the value in
`x.tripDataJson.confirmation`. Open such a file in the fixed app and edit the confirmation cell: the
edit lands as a plain `confirmation`, the bag still holds the old one, and the bag wins. **The person's
correction is silently reverted by the file it was meant to correct.**

So naming a field is not sufficient; it has to be paired with `dropBag`:

```js
if (collection === 'lodging' && out.confirmation != null) dropBag(entity, 'confirmation');
```

That is the established pattern (`costRaw`, `timeRaw`, `minSocRaw`, `nacsAdapterRaw`), and it is
guarded only while the named field is present — an untouched bag-only value still round-trips.

### The guard: two checks, because neither is sufficient alone

1. **Widen the corpus.** `test/harness.js` now generates `confirmation`, `chargingNetworks[].notes`,
   `items[].link` and the `label` spelling, in both `maximalTrip` and `randomTrip`. This was written
   **before** the mapper change and watched to fail: all 120 seeds reported the new paths, and
   `REQ-809`'s own check flagged `days[0].items[0].link` independently while the coarse `lodging[]` and
   `chargingNetworks[]` rows hid the other two. That is the demonstration the check is not vacuous.

2. **Read the panels in `test/artifact.test.js`.** For every `collectionCard({…})` spec in the shipped
   program — its own `key`, its `columns[].key` values (skipping key-less derived columns like
   Lodging's "Nights"), and the row its `blank()` returns — plus every `cellInput('<collection>', …,
   '<field>', …)` cell, require the field to be present in `TP.tripdatajson.COLLECTION_KEYS`. Four of
   the five instances lived in these two shapes.

   The corpus can never enumerate a field nobody thought to add; the panels are the source of the
   claim. And the scan has to be able to fail for the right reason, so it asserts what it found before
   it asserts what it did not: three `collectionCard` specs, at least seven `cellInput` cells, the
   charging card's blank row specifically (that is the shape `adapter` hid in), and a deliberately
   broken input per shape. A check that passes by finding nothing is the failure it exists to prevent.

## Consequences

- **`REQ-504` holds for these two formats and this model.** The ledger row for `item.link` is now
  written out rather than left to the coarse collection row, and the `lodging[]` / `chargingNetworks[]`
  field counts moved with it.
- **`update_record` gained `confirmation` for free.** `sanitizePatch` derives its allow-list from
  `COLLECTION_KEYS`, so naming the field in the mapper handed the agent the ability to patch it — which
  is the intended direction of that dependency, and a reason to keep it that way.
- **The agent can read back what it set.** `CONTEXT_FIELDS.lodging` in `src/ai/prompt.js` names
  `confirmation`. A field the agent can write but cannot see is one it writes twice.
- **A `URL` that came from a calendar is now visible in the UI.** It used to be bagged, so an imported
  link was invisible in the item editor. The bag fallback stays, for a document an earlier build wrote:
  a person who clears such a link sees it come back, because the model holds no trace of a deleted
  link. That wart is recorded in the ledger's note for `item.link` rather than hidden.
- **The scan covers two shapes, and says so.** It is not "does any panel write a stray key"; a general
  analysis is not available here. A third shape would not be caught, and the file's comment says as
  much rather than implying a coverage it does not have.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Open the wire list — write every model field through, as `app/io.js` did | The list is what makes `trip-data.json` a format rather than a serialization of one program's current internals. An open list cannot be validated, cannot be described in `06-interchange.md` §3, and cannot be the reason a field is *absent*. The bug was that the list was incomplete and the ledger overstated it, not that a list exists |
| Widen the ledger's rows instead — give every collection a per-field row | Would have made the ledger say `M` for a field the mapper drops, which is worse than the coarse row it replaces: it converts an honest summary into a false specific. The rows stay coarse; the mapper was brought up to them |
| Have `REQ-809` compare the mapper against `TP.schemas` rather than against the ledger | The two agree already — the schema listed the field as an unknown-but-permitted property, so it had no opinion to disagree with. A check driven by the schema still cannot see a field nobody declared |
| Detect the bug at export and disclose it — "these fields were dropped" | Turns silent loss into announced loss, and a person cannot act on an announcement about a column they cannot see. The field is representable; there was no reason to lose it |
| Make `item.link` write any string into `URL:` | The app's own export would fail its own `ical` validator, and a real client would reject the event. A link that is not a URL is not a calendar link |
| Bump the `trip-data.json` generation | There is no old file carrying these fields to upgrade, and the bytes for a file that does are unchanged. A generation bump with nothing to migrate is a version number spent for nothing |

## References

`specs/06-interchange.md` §3.2, §3.3; `specs/03-data-model.md` §2.1; `REQ-504`, `REQ-516`, `REQ-809`;
`PAT-INV-10`, `PAT-AP-08`; `ADR-0008`, `ADR-0014`, `ADR-0018`, `ADR-0019`; `vendor/PROVENANCE.md`;
`src/interchange/tripdatajson.js` (`ITEM_KEYS`, `COLLECTION_KEYS`, `fromEntity`, `dropBag`),
`src/interchange/ical.js` (`calendarUrl`), `src/interchange/ledger.js` (`kindOf`);
`test/interchange.test.js`, `test/artifact.test.js`, `test/harness.js`; `app/io.js:128`.
