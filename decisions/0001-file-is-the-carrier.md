# ADR-0001 — The file is the carrier

- **Status:** Accepted
- **Pattern decision:** `PAT-DEC-01` — Where the source of truth lives
- **Specified in:** `05-storage.md`, `02-architecture.md`
- **Deviation:** None

## Context

Platform storage is unreliable and browser-dependent. Under `file://`, Chrome and Edge treat every local
file as one origin, Firefox treats each file *path* as its own origin, and Safari is inconsistent
(`PATTERN.md` §5.1). Storage therefore does not follow a file that is moved, renamed, copied, or opened
from somewhere else — and a user who clears their browser profile loses everything.

The present application is the opposite shape: trips live **only** in IndexedDB (`app/db.js:12-28`).
Moving or clearing a profile is total data loss, and `PAT-AP-01` names this failure exactly.

## Decision

**The exported HTML file is the source of truth. Storage is an overlay.**

Every operation must reach a correct outcome with storage absent, empty, partitioned, or hostile. The
adapter (`05-storage.md` §2) exists to make the *common* case fast, not to make correctness possible.

The test of the rule is a manual requirement, `REQ-404`: delete all local storage and reopen the file —
nothing should be lost, only convenience.

## Consequences

- The file must be re-exported and re-sent for changes to travel. That is the mechanism, not a defect.
- Users will be surprised that the app "forgot" a change they did not export. This is stated in the
  UI — the boot sequence reports reconcile status (`REQ-612`) — rather than left to be discovered.
- The sidebar's list of trips becomes a **registry** (a convenience index re-seeded from files,
  `PAT-AP-09`) rather than the store itself.
- History must be inside the file, which is why versioning is not optional in this design.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| IndexedDB stays authoritative | Blocked on some `file://` origins entirely (`PAT-DEC-12`), and does not travel with the file. It is the present design's failure |
| A server | The pattern's premise is that two people can reconcile with no server |
| File System Access API as the primary store | Not available under `file://`, not available in Firefox or Safari, and requires a user gesture per write |

## References

`PATTERN.md` §5.1, `PAT-INV-01`, `PAT-INV-02`, `PAT-AP-01`, `PAT-AP-09`; `specs/05-storage.md`.
