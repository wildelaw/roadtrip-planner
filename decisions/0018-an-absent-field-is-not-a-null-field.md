# ADR-0018 — An absent field is not a null field

- **Status:** Accepted
- **Pattern decision:** Not a `PAT-DEC` — instance-specific (what a field that is not there means)
- **Specified in:** `03-data-model.md` §2, §7; `REQ-203`, `REQ-305`
- **Deviation:** **No** — but the rule had to be stated, because three parts of the app were answering it differently

## Context

The canonical model is written to be **honest about absence**. `REQ-203` says canonical requires almost
nothing — "an id and a name" — and that everything a format needs beyond that is synthesized at export
and disclosed. A model that filled its optional fields with `""`, `0` or `null` would be saying
something it does not know, and the synthesized-at-export machinery would have nothing to notice.

`PATTERN.md` §5.3's superset rule and `REQ-305`'s canonical serialization push the same way: the payload
hash is taken over a canonical serialization, so two payloads that mean the same thing must produce the
same bytes. `JSON.stringify` drops a key whose value is `undefined`, and `TP.canonical.serialize` sorts
and stringifies — so `{a: undefined}` and `{}` are **the same document** to the hash, to the file, and to
every reader.

Three parts of the app disagreed with that, in three different ways, and each disagreement was invisible
until something depended on it.

## Decision

**A field whose value is `undefined` is absent. A field whose value is `null` is present, and says
"nothing here".** The two are not interchangeable, and only the schema may declare which is which.

| Site | Rule | Why it was wrong before |
|---|---|---|
| The schema validator (`src/validators/schema.js`) | A property with an `undefined` value is not a field: it is skipped by the walk, not counted by `minProperties`, and does not satisfy `required` | It was **stricter than the app that writes the file**. `history.append` sets `docId` from `meta.docId`, which is `undefined` when the caller supplies none — so a document this app exported failed the app's own import check, over a key that is not in the document |
| `TP.model.normalize` (`src/model/trip.js`) | An absent `trip.vehicle` is **deleted**, never written as `null` | `null` is not "no vehicle": the vendored `trip-data.json` schema declares `vehicle` as an object and nothing else, so a payload carrying `null` failed the schema the app validates imports against. The defect was only in what the app believed about its own payload — every wire writer pruned nulls on the way out, so the invalid value never left the process |
| `TP.store.edit` (`src/store.js`) | A mutation that changes nothing **is not an edit**: no undo step, no dirty flag, no autosave, no commit | A mutator that refuses (an AI tool reporting a day it could not find returns an error *without* touching the trip) still marked the document dirty, so the autosave ran and an agent that accomplished nothing reported a change and asked for a commit. The comparison is canonical, the same one `commit` uses to avoid an empty line in the history |

The middle row is the reason this is an ADR and not three code comments. It is the case where the
distinction has teeth: `null` and absent are both "no value" to a reader, but a **schema** can only
declare one of them, and the app was writing the one the schema does not allow.

## The `docId` default, and why it is not derived

A separate instance of the same question, because it was tempting and was rejected. `trip.docId`
identifies the **document** — the thing history binds to (`03-data-model.md` §1, `ADR-0016`) — and a
wire format carries no such identity, so `.ics` and `trip-data.json` import with `docId` absent.

The tempting default is `docId: opts.docId || trip.id`: the trip's own id is right there, and the field
is only used to bind history, so why mint a new one? **Because it makes two different documents claim the
same identity.** Importing the same file twice would produce two documents that `merge` cannot tell
apart, and `05-storage.md` §4 registers them under one key. The id is minted **per import**
(`REQ-616`: importing creates a new document), and `normalize` writes `''` — absent, awaiting the
document the caller is about to create — rather than borrowing an id that means something else.

## Consequences

- **The rule is stated once and applied at three levels**: the validator (presence), the model
  (normalization), and the canonical serializer (bytes). The test suite carries it as a property —
  "a key that is present with an `undefined` value is absent, and a null is not" (`canonical.test.js`)
  — so a fourth disagreement is a failing test rather than a latent one.
- **The schema is the authority on which of the two a field is.** Where the vendored schema declares a
  type and nothing else, absent is the only honest encoding; where it declares `null` (the trip's dates
  are the one such field), `null` is a value the model means and the validator must accept.
- `store.edit`'s canonical comparison costs one serialization per edit. That is deliberate: the
  alternative is a second, cheaper equality that can disagree with the one the hash uses, which is the
  class of bug this ADR is about.
- The two private calendar properties of `ADR-0017` obey the same rule at the wire: a bag member is
  absent, not `null`, when there is nothing to keep (`REQ-206` — an empty bag is omitted, never `{}`).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Treat `undefined` and `null` as the same absence everywhere | The schema cannot. `vehicle: null` is a type error against a schema that says `object`, and a validator that accepted it would accept a payload the file format does not permit |
| Fill absent optional fields with `null` in the model | "Nothing here" is a claim; absence is the truth. It would also make every synthesized-at-export field indistinguishable from one a person cleared |
| Derive `docId` from `trip.id` on import | Two imports of one file become one document, which is precisely the identity collision `ADR-0016` and §4 of `05-storage.md` exist to prevent |
| Skip the canonical comparison in `store.edit` and always mark dirty | Cheaper, and wrong: a refused mutation marks the document dirty, the autosave commits a no-op, and an agent that changed nothing reports a change |

## References

`specs/03-data-model.md` §1, §2, §7; `specs/05-storage.md` §4; `specs/06-interchange.md` §3.5, §5.3;
`REQ-203`, `REQ-205`, `REQ-206`, `REQ-305`, `REQ-616`; `ADR-0016`, `ADR-0017`; `PATTERN.md` §5.3.
