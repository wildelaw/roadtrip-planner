# ADR-0005 — Ancestry decides; a clock never does

- **Status:** Accepted
- **Pattern decision:** `PAT-DEC-05` — What "newer" means
- **Specified in:** `04-versioning.md` §6
- **Deviation:** None

## Context

Users say "the newer one", and the only clock available is the client's — untrusted, and on a machine
with a wrong clock, confidently wrong.

`PATTERN.md` §7 marks this as the decision to choose differently from **never**, and calls it the
pattern's least negotiable choice. The cost of getting it wrong is invisible until the work is gone.

## Decision

**Precedence is computed from ancestry. Timestamps are displayed and excluded from every decision.**

```
compare(A, B):
  if A == B              → IDENTICAL
  if isAncestor(A, B)    → B is newer   (fast-forward to B)
  if isAncestor(B, A)    → A is newer   (fast-forward to A)
  otherwise              → DIVERGED     (stop and ask)
```

`PAT-INV-03`: no clock, no counter, and no "last modified" field ever decides precedence. `build.generatedAt`
in the container is informational and is named as such (`REQ-213`).

## Consequences

- **A user cannot express "mine is newer" without a merge.** The application sometimes asks when a
  timestamp would have answered. That is the cost, and it is the point.
- The common case is unaffected: a sequential edit is an ancestor relationship, so a fast-forward
  resolves it with no prompt.
- Divergence — genuinely concurrent edits — reaches `PAT-DEC-06`'s stop-and-ask path rather than being
  silently resolved by whichever machine has the later clock.
- The `compare()` function is a pure function over two DAGs and is fully testable without a browser
  (`09-testing.md` P6).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Latest `timestamp` wins | A wrong clock silently wins every reconcile and overwrites a peer's work. The failure is invisible until the work is gone |
| A monotonic counter per device | Two devices' counters are not comparable, and the counter is client-controlled |
| "Ask the user which is newer" with timestamps shown as the default | Presents a guess as a recommendation, and users will take it |

## References

`PATTERN.md` §5.6, §7 `PAT-DEC-05`, `PAT-INV-03`; `specs/04-versioning.md` §6; `REQ-312`, `REQ-213`.
