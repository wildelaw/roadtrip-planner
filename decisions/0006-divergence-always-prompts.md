# ADR-0006 — Divergence stops and asks

- **Status:** Accepted
- **Pattern decision:** `PAT-DEC-06` — Divergence policy
- **Specified in:** `04-versioning.md` §7.3, `07-ui.md` §8.2
- **Deviation:** Partial — the three-way compare view is deferred; the stop is not

## Context

Auto-merge is convenient. The merge base is computable for a DAG. And both sides of a divergence contain
real work that a human intended.

The temptation is to pick a winner, or to merge field-by-field automatically because "the merge base
makes it unambiguous". It is unambiguous per *field*, and it is not unambiguous per *intent*: two people
who both renamed the same day, or one who deleted a day the other filled in, produce a merge that is
syntactically fine and semantically wrong.

## Decision

**Divergence stops. The application never picks a winner and never auto-merges.**

| Case | Behaviour |
|---|---|
| One side is an ancestor of the other | Fast-forward, no prompt (`PAT-DEC-05`) |
| Different `docId` | Register separately, never merge |
| No common ancestor | Register separately, never merge |
| **Genuine divergence** | **Block; require a clean working copy; open the compare prompt** |

Suggestions may be pre-selected. **Nothing is written until confirmed** (`PAT-INV-04`).

`PATTERN.md` §8.2 explicitly permits deferring the three-way *view*: "a 'choose one side entirely' prompt
is coarse but safe". That is the deferral recorded here and carried as `10-open-questions.md` Q-5.

## Consequences

- More user work per reconcile. That is the cost.
- The first version's prompt is coarse — it discards one side wholesale. Safe, and unhelpful for two
  large divergent edits.
- A reconcile against a divergent file **cannot be dismissed and ignored**: the app blocks, and the
  user must choose. `PAT-AP-03` ("silent last-writer-wins") is the failure this prevents.
- The compare prompt requires a **clean working copy**, so an uncommitted edit cannot be silently
  discarded by a choice made in the prompt.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Auto-merge using the merge base | Correct per field, wrong per intent. And it writes the result, which makes the mistake permanent |
| Last-writer-wins | `PAT-AP-03`. One person's work vanishes with no notification |
| Prompt, but default to the later timestamp | Presents a guess as a recommendation (`ADR-0005`) |
| Refuse to reconcile at all | Defeats the pattern's purpose — this is the thing the file exists to enable |

## References

`PATTERN.md` §5.8, §8.2, `PAT-DEC-06`, `PAT-INV-04`, `PAT-AP-03`; `specs/04-versioning.md` §7.3;
`specs/10-open-questions.md` Q-5.
