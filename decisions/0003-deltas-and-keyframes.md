# ADR-0003 — Deltas with periodic keyframes

- **Status:** Accepted
- **Pattern decision:** `PAT-DEC-03` — How history is stored
- **Specified in:** `04-versioning.md` §4
- **Deviation:** None

## Context

Storage is small and bounded; reconstruction cost grows with history. A trip plan's payload — days,
items, bookings, budgets, expenses, checklists, EV charging data — is realistically 100–500 KB, against
a ~5 MB `localStorage` budget.

| Approach | Fails because |
|---|---|
| Snapshots only | A 100–500 KB payload over a hundred commits is tens of MB. The budget is 5 |
| Deltas only | Reconstruction replays from the root — O(N) per access — and one corrupted patch destroys everything after it |

## Decision

**A commit stores either a full snapshot or a patch against its parent. Exactly one, never both.**

A commit **must** be a keyframe when:

| # | Condition | Kind |
|---|---|---|
| 1 | It is a root | Correctness |
| 2 | It has more than one parent (a merge) | Correctness |
| 3 | Its patch would be larger than the snapshot, compared **before writing** | Correctness |
| 4 | The count since the last keyframe reaches `keyframeInterval` (default 20) | Heuristic |

Rules 1–3 are correctness; only rule 4 is a heuristic, and it is stated as one so that tuning it is not
mistaken for changing behaviour.

Rule 2 is load-bearing beyond storage: because a merge is always a keyframe, reconstruction never has to
choose between two parents.

## Consequences

- Real reconstruction logic, a fidelity guarantee to test (`REQ-310`), and a re-keyframing path.
- Rule 3 requires computing a candidate patch and comparing sizes before deciding — work that must
  happen before the write, and that must not itself be the thing that fails.
- **Compaction is free of risk** because neither the snapshot nor the delta is an input to the commit
  id (`REQ-302`, `PAT-INV-07`). Re-keyframing cannot desynchronise two copies of the same history.
- The patch `path` is an **array of segments**, not a JSON Pointer string, so that rejecting a
  `__proto__` segment is a comparison rather than a parse (`REQ-705`).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Snapshots only | Exceeds the storage budget at realistic history lengths |
| Deltas only | Unbounded reconstruction cost, and no recovery from a damaged patch |
| Content-defined chunking | Far more machinery than a document with one editing human needs |

## References

`PATTERN.md` §5.5, `PAT-DEC-03`; `specs/04-versioning.md` §4; `REQ-308`–`REQ-311`.
