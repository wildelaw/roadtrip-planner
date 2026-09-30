# ADR-0016 — One trip per document

- **Status:** Accepted
- **Pattern decision:** Not a `PAT-DEC` — instance-specific (payload granularity)
- **Specified in:** `03-data-model.md` §1, `05-storage.md` §4
- **Deviation:** **Yes** — the present app stores many trips in one IndexedDB store

## Context

`PATTERN.md` §8.3 gives the payload for a vacation planner as "Trip: travellers, legs, bookings,
activities, budget, documents" — **singular**. It names vacation planning as a worked fit for the
pattern, and the payload it names is one trip.

The present application is multi-trip: a `trips` store in IndexedDB (`app/db.js:16-18`), a sidebar
listing them (`app/ui/trip-list.js`), and an `exportAllTrips` that emits a JSON array
(`app/store.js:312`).

A multi-trip document is *possible* under the pattern — the container's payload is arbitrary. It is a
worse fit, for reasons that only become visible once history exists.

## Decision

**The payload is one trip. One file, one trip.**

| Consequence | Detail |
|---|---|
| The sidebar becomes a **registry**, not a store | It lists known *documents* — a convenience index, re-seeded from files on every load (`PAT-AP-09`). Deleting an entry never deletes a document (`REQ-406`) |
| "New Trip" mints a new **document** | New `docId`, new empty history with a root commit, empty payload |
| Importing a trip creates a document | Importing `trip-data.json` or `.ics` creates a new document by default; replacing the current document's payload is a separate, explicitly confirmed commit (`REQ-616`) |
| "Export all trips" disappears | It has no meaning when a document is one trip |

## Why one trip, specifically

The argument is about **history**, not about the UI.

| With one trip per file | With many trips per file |
|---|---|
| A commit's message describes one itinerary change | "Updated the trips list" — the commit cannot say *which* trip, because the payload is a set |
| Reconciliation compares two versions of one plan | Reconciliation compares two versions of a *collection*, and one person adding a trip conflicts with another editing a different one for no reason |
| A file can be sent to a travel companion without also sending the user's other trips | Sending one plan sends every plan — a disclosure problem, not a convenience one |
| Merging is comprehensible: "this day changed" | Merging is a set-union with per-element history. A DAG over a collection is a different and much harder problem |
| The file's size is one trip's size | Every export carries every trip, against a ~5 MB storage budget (`ADR-0012`) |

The last row is the one that decides it. The versioning design (`ADR-0003`) is scoped to a payload
whose size is bounded by one trip. Making the payload a collection multiplies it by the number of trips
the user has ever created, and every commit's snapshot carries all of them.

The disclosure argument is the one that decides it morally: **a document is a thing you send to
someone.** "Here is the file" should mean "here is the plan", not "here is every plan I have ever made".

## Consequences

- **The registry is a behavioural change and must be explained.** The sidebar's empty state says "no
  documents have been opened here", never "no trips" — because the second reads as data loss
  (`REQ-406`, `PAT-AP-09`).
- A user switching between trips switches **documents**, each with its own history, storage keys, and
  reconcile state. The boot sequence's reconcile step runs for the opened document only.
- The one-time migration from IndexedDB (`REQ-411`) mints **one document per existing trip**, which is
  where the "each is now its own document" wording in the migration report comes from
  (`05-storage.md` §8).
- `exportAllTrips` (`app/store.js:312`) is retired. The registry can still export each document it
  knows, one at a time — which is a different feature with a different name, and is not required.
- Cross-document operations that exist today — the `wipeAll()` at `app/store.js:318-324` — become
  registry operations, and must not delete files the app cannot see (`REQ-406`).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| One document holding all trips | Every export carries every trip; reconciliation conflicts across unrelated trips; sending one plan sends them all |
| One document per *trip collection*, chosen by the user | Two granularities to explain, and the collection case is strictly worse than the trip case |
| Keep IndexedDB as the multi-trip home and add documents for export | Two sources of truth, which is the shape `ADR-0001` exists to remove |

## References

`PATTERN.md` §8.3, §5.2, `PAT-AP-09`; `specs/03-data-model.md` §1; `specs/05-storage.md` §4, §8;
`REQ-201`, `REQ-405`, `REQ-406`, `REQ-411`, `REQ-616`.
