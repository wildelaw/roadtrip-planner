# ADR-0021 — the planning agent may update and remove records it wrote, within an allowlist

- **Status:** Accepted
- **Pattern decision:** Not a `PAT-DEC` — instance-specific
- **Specified in:** `08-security.md` §8, `09-testing.md` §9
- **Deviation:** **Yes** — the agent can now take trip data away as well as add it, which the §8 rule
  about commits did not contemplate

## Context

The first generation of agent tools could only append. A real session showed what that costs. The
agent recorded the same three lodging stays across successive revisions — the count went 10 → 13 → 14
— and then had to tell the person it had no way to take any of them back:

> add_lodging is an append-only tool in this app. It does not edit or replace an existing record, and I
> have no delete/remove tool exposed. […] I'm sorry: I made the number larger instead of smaller, and I
> can't undo it with the tools I have.

The cleanup was a manual step in the Lodging panel. That is the failure this decision answers: **an
agent that can write into the trip must be able to correct itself**, or every mistake it makes becomes
work for the person.

Two further defects sat behind the same transcript, and both had to be fixed for the tools to be
usable at all:

1. **The agent could not see what it had written.** `serializeTrip` rendered lodging as `lodging: 3`
   and every other collection as a count or a bare name list. From inside the loop, fourteen
   duplicates and three stays read identically — which is *why* the count kept climbing. A removal
   tool without this would name a record the model could not identify.
2. **The rows it created were unremovable.** `collection()` pushed `shallow(args)` with no `id`;
   `normalizeEntity` mints one only on load or import, and the committed payload is the working copy
   verbatim. `findIn` and the panel's `removeRow` match on exact `id`, so an AI-added row could not be
   found at all — the person could not remove it, and editing one cell could hit a different row.

## Decision

**Two generic tools, `update_record` and `remove_record`, over an allowlist of collections; every
record the agent adds carries its own id from the moment it lands; and the trip context lists records
with their ids so they can be named.**

| Rule | |
|---|---|
| The allowlist is `lodging`, `reservations`, `locations`, `bucketList`, `contacts`, `expenses`, `criticalAlerts`, `budgetEstimates`, `preTripActions`, `chargingNetworks`, `minSocThresholds` | `MUTABLE_COLLECTIONS`, `ai/tools.js` |
| `days`, `items`, `keyTips`, `checklists`, `travelers`, `vehicle`, `destinations` are **not** addressable | they are the trip's spine; a tool that can rewrite them turns an eager model into data loss |
| A record is named by `id` (exact) or by fields (case- and whitespace-insensitive) | the field fallback is also the only way to reach a row created before ids were minted |
| `update_record` requires a **unique** match; ambiguity is refused and the refusal lists the ids | patching several rows from one patch is almost never what was meant |
| `remove_record` removes one row on a unique match, and every match only on an explicit `all: true` | eleven duplicates and one legitimate stay look identical from inside the loop; guessing wrong destroys data |
| A `match` with no values in it selects nothing | otherwise "all-null" would be a way to say "the whole collection" |
| A patch may only touch fields the wire carries for that collection | `tripdatajson` writes unknown keys into the `x` bag and reads them back, so an invented field would persist invisibly while the model believed it had succeeded |
| `add_lodging` refuses a stay already recorded for the same place and check-in, naming its id | the duplicate guard, at the one tool where the damage was observed |
| Every refusal is a `'Failed: …'` string, never a thrown error | `09-testing.md` §9; the model corrects itself instead of the loop dying |

**Removal is a new forward commit, not a rewrite.** `remove_record` edits the working payload through
`TP.store.edit` like every other tool, and the run lands as one commit — so the change is revertible
forward (`REQ-311`) and the commit the records came from still holds them. `PAT-INV-06` (history is
append-only) and `PAT-INV-13` are untouched. The word "remove" invites the opposite reading, which is
why it is stated here and tested: `ai.test.js` reconstructs the pre-removal commit and asserts the
removed rows are still in it.

**`minSocThresholds` is on the allowlist** even though `set_min_soc` is an EV tool, because it is the
same append-only shape: every call piles on another threshold. It can make exactly the mess this pair
of tools exists to clear.

## Consequences

- **This narrows the §8 rule "Nothing the AI produces is committed without confirmation."** That row
  already disagreed with the shipped code — a run auto-commits one line and the panel toasts "in one
  commit you can undo" — and the disagreement is now sharper, because the committed change can take
  data away. §8 has been corrected to describe what the code does: the run is user-initiated, it lands
  as one undoable commit, and a removal is a forward commit rather than a history rewrite.
- **The context grew.** Listing records costs roughly 600–1200 tokens on a realistic trip, against a
  context the day items already dominate. Each collection is capped at 50 rows; rows past the cap
  cannot be named by id, which is a real limitation and is accepted because the collections that
  realistically grow past it are the ones the agent added itself.
- **A patch cannot set a lodging `confirmation`.** It is in the row the UI writes but not in
  `COLLECTION_KEYS.lodging` nor the vendored `$defs.lodging`, so it round-trips inside the `x` bag.
  `add_lodging` could not set it either, so nothing regressed — but the agent must still put a
  confirmation number in `notes`. Making it first-class is a wire-format change (`ADR-0019`) and is
  carried separately.
- **Nothing dedupes records already on disk.** The guard is prospective. An existing pile is cleared
  by `remove_record` with a field match and `all: true`, which is now a single call and a single
  commit.
- The agent's tool surface grew by two, so every prompt that lists tools, and `get_trip_summary`'s
  value as the model's way to find a record's id, now carry more weight. The prompt rules name both.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| `update_lodging` / `remove_lodging` only | The append-only defect is not lodging's: eleven `add_*` tools route through the same `collection()`. Two generic tools cover all of them with one code path |
| A generic `set_field(collection, id, key, value)` | An id is the one thing a small model reliably gets wrong, and the row it needs to fix may have no id at all |
| `remove_record` always deleting every match | Silently deletes legitimate repeat stays; eleven duplicates and two real stays are indistinguishable from a field match |
| `remove_record` always deleting exactly one | Makes the motivating case eleven tool calls, which is not a fix |
| Match by fuzzy/substring name | No such utility exists in the codebase, and a substring match would let `Hotel` take out `Hotel X`, `Hotel Y` and `Hotel Z` at once |
| Let the model write any collection, including `days` | The failure mode is data loss on the trip's spine, for no planning capability gained |
| Dedupe collections on load instead | Changes records the person may have entered deliberately, on every open, with no way to tell a duplicate from a repeat stay |

## References

`specs/08-security.md` §8; `specs/09-testing.md` §9; `PATTERN.md` `PAT-INV-06`, `PAT-INV-13`;
`decisions/0018` (an absent field is not a null field), `decisions/0019` (a generation upgrade for
trip-data.json); `REQ-311`, `REQ-410`, `REQ-810`; `src/ai/tools.js`, `src/ai/prompt.js`,
`test/ai.test.js`.
