# ADR-0013 — Undo is bounded by the commit; revert is a forward commit

- **Status:** Accepted
- **Pattern decision:** `PAT-DEC-13` — Undo versus revert
- **Specified in:** `04-versioning.md` §8.1
- **Deviation:** None

## Context

Users expect "undo" to cover everything. History must be append-only (`PAT-INV-06`).

Conflating the two makes **"change my mind about this edit"** and **"change the record of history"**
indistinguishable. The first is a working-copy operation with no lasting record; the second is a
statement about a document that has been copied, sent, and possibly edited by someone else.

## Decision

**Two mechanisms, deliberately not conflated.**

| Mechanism | Scope | Produces |
|---|---|---|
| Undo / redo | **Bounded by the commit boundary** — a journal of operations since the head | No new commit until one is made |
| Revert | History-wide | **A forward commit** whose payload equals the target commit's |

| Rule | |
|---|---|
| History is append-only; ids are never rewritten | `PAT-INV-06`, `REQ-314` |
| Reverting restores the payload; it does not erase the record | The abandoned commits remain reachable and remain shown |
| Committing clears the operation journal | — |
| The journal is **not persisted** and is **not in the container** | It is per-user working state (`03-data-model.md` §5.1) |

`PATTERN.md` §7 marks this "choose differently: never — the boundary is what keeps `PAT-INV-06`
comprehensible to users." That is the whole argument, and it is why this ADR records no deviation and
no tuning parameter.

## Consequences

- **Two mechanisms and a clear explanation in the UI.** A user who presses undo expecting it to cross a
  commit boundary gets a no-op, and the app has to say why. This is the cost, and it is stated in the
  history view (`07-ui.md` §8.2) rather than left to be discovered.
- Rewriting history desynchronises every copy in circulation and makes reconciliation against any
  previously exported file impossible (`REQ-314`). The append-only rule is what keeps the file a
  document that can be *merged* rather than a document that can only be *replaced*.
- The journal being unpersisted means an edit that is undone before a commit leaves **no trace at all** —
  which is the correct behaviour and also means the undo buffer does not inflate the document.
- A revert is a normal commit in every respect: it has a parent, an author, a message, and a place in
  the chain. Nothing downstream needs to know it is a revert.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Undo across commit boundaries | Requires rewriting history, which `PAT-INV-06` forbids |
| Persist the undo journal in the container | It is per-user working state; the container omits per-user state (`REQ-211`) |
| Only revert, no undo | Makes every edit a commit; a user fixing a typo in a field would produce history entries |
| Only undo, no revert | Loses the ability to restore an earlier state without replaying every operation, which is not possible after a reconcile |

## References

`PATTERN.md` §5.5, `PAT-DEC-13`, `PAT-INV-06`; `specs/04-versioning.md` §8.1; `REQ-314`, `REQ-315`.
