# ADR-0012 — `localStorage` behind an adapter

- **Status:** Accepted
- **Pattern decision:** `PAT-DEC-12` — Storage backend
- **Specified in:** `05-storage.md`
- **Deviation:** **Yes** — this changes the *present app's* backend (IndexedDB). It is not a deviation from the reference implementation, which also chose `localStorage`

## Context

| Backend | Forces |
|---|---|
| `localStorage` | Small (~5 MB), **synchronous**, partitioned unpredictably |
| IndexedDB | Larger, asynchronous, and **blocked on some `file://` origins entirely** |

The present application uses IndexedDB (`app/db.js:12-28`). It is also, today, the app's *only* store —
there is no file carrier (see `ADR-0001`), so the storage question and the source-of-truth question are
entangled.

That entanglement is what this ADR has to separate. Once the file is the carrier, storage is an overlay,
and the question becomes: which overlay is *reliable enough to be optional*?

IndexedDB is not, and the reason is the environment this pattern targets. `PATTERN.md` `PAT-DEC-12`
states it directly: it is "blocked on some `file://` origins entirely". A storage backend that is
sometimes simply absent is a poor foundation for an overlay whose entire job is to be optional.

## Decision

**`localStorage` behind an adapter, with a memory adapter and a null adapter.**
**"Storage is unavailable" is a supported configuration, not an error path.**

| Implementation | When chosen | Behaviour |
|---|---|---|
| `localStorage` | Default in a normal browsing session | The real store |
| `memory` | `localStorage` throws on access (some `file://` configurations, private windows, blocked site data) | Fully functional for the session; discarded on close |
| `null` | Read-only mode — integrity failure (`REQ-317`) or an unknown newer container `format` (`REQ-212`) | Reads return nothing; writes refused with an explanation |

Synchronous is not incidental. The boot sequence is deterministic (`PAT-INV-14`, `REQ-612`), and an
asynchronous store would put an await point in the middle of integrity verification and reconcile.

## Consequences

- **A hard quota ceiling.** ~5 MB, addressed by compaction and disclosure rather than eviction
  (`05-storage.md` §6, `REQ-408`). No commit is ever dropped to make space: an eviction policy that
  quietly discards old commits loses work with no notification, and the history may be the only copy.
- The write ordering rule (`PAT-INV-13`) becomes load-bearing rather than theoretical. Per-key commits
  mean an interrupted save leaves orphans rather than corruption — but only because the pointer is
  written last and removed first.
- The null adapter is what makes read-only mode a **supported configuration** rather than a special
  case, so the code path that integrity failure needs already exists and is exercised (`05-storage.md` §2).
- The registry is a convenience index, re-seeded from files, never authority (`PAT-AP-09`).
- Existing users' trips need a **one-time migration** from IndexedDB (`REQ-411`) — served mode only,
  because the database may be unreachable under `file://`, and the original data is never deleted
  (`PAT-INV-05`).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Keep IndexedDB | Blocked on some `file://` origins, and asynchronous in a boot sequence that must be deterministic |
| `localStorage` with no adapter | Spreads the backend across every call site; "cannot persist" becomes a branch inside every feature |
| File System Access API | Unavailable under `file://`, in Firefox and Safari, and requires a user gesture per write |
| No storage at all | Loses the convenience the overlay exists to provide; the registry would not survive a reload |

## References

`PATTERN.md` `PAT-DEC-12`, `PAT-INV-12`, `PAT-INV-13`, `PAT-AP-09`, `PAT-AP-11`;
`specs/05-storage.md`; `REQ-401`–`REQ-412`.
