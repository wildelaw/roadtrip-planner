# ADR-0007 — A neutral superset with passthrough bags

- **Status:** Accepted
- **Pattern decision:** `PAT-DEC-07` — Canonical model strategy
- **Specified in:** `03-data-model.md` §2, §4
- **Deviation:** None

## Context

External formats disagree structurally, not just in naming. `trip-data.json` has budget, expenses, EV
charging data and a booking list. iCalendar has recurrence, alarms, attendees and time zones.

The tempting mistake is to map both formats onto their **intersection**. A converter that maps field to
field drops whatever has no counterpart — and the loss is invisible, because the document still
validates, still renders, and is simply missing what someone wrote.

## Decision

**The canonical model is the union of what the formats can express.** Where only one format has a
concept, the concept still exists internally, and the other format's export reports it as unrepresentable.

Unmodelled data is preserved verbatim in per-entity, per-format **passthrough bags**:

```json
"x": { "tripDataJson": { }, "iCal": { "VALARM": { }, "RRULE": "…" } }
```

| Rule | |
|---|---|
| Every unrepresented field is preserved verbatim, keyed by source format | `REQ-205` |
| An empty bag is **omitted**, never emitted as `{}` | `REQ-206` |
| Bags are **opaque to the UI** — shown, attributed, preserved, never interpreted | `REQ-207` |
| Bags are per-entity, not per-document | An unmodelled property on one `VEVENT` lives on that item |

## Consequences

- A larger internal model, and mapping code in both directions for every format.
- The union is genuinely a superset, so a field added for one format does not force a choice about the
  other.
- **The existing app already has the idea in two ad-hoc forms** — `importedRaw` on the trip
  (`app/io.js:82`) and `_src` on days and items (`app/io.js:36,47`). This decision generalises them to
  one name and one shape. It is a formalisation of something that works, not a new mechanism.
- The generalisation is what turns `PAT-AP-08` ("a lossy import with no ledger") from a live risk into a
  mechanical check: the ledger classifies every field, and anything not mapped has a bag to live in
  (`06-interchange.md` §3).
- Canonical required fields are minimal — an id and a name (`REQ-203`) — with format-specific required
  fields satisfied by synthesis at export, disclosed (`03-data-model.md` §7).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Map onto the intersection | Silent, invisible data loss. The failure the ledger exists to prevent |
| Use `trip-data.json` as the canonical model | It would make iCalendar a lossy second-class format and prevent the model from ever growing |
| Use iCalendar as the canonical model | Absurd for budget, expenses, and EV planning |
| A document-level "extra data" dumping ground | Loses the association between unmodelled data and the entity it belongs to, so it cannot be exported back out correctly |

## References

`PATTERN.md` §5.3 (P1, P2), `PAT-DEC-07`; `specs/03-data-model.md` §2, §4; `REQ-202`, `REQ-205`–`REQ-208`.
