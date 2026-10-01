# ADR-0019 — A generation upgrade for `trip-data.json`, gated on shape

- **Status:** Accepted
- **Pattern decision:** Not a `PAT-DEC` — instance-specific (what to do when a first-party format's own
  spelling changes)
- **Specified in:** `06-interchange.md` §2.1, §3.2, §3.3
- **Deviation:** **Yes** — `REQ-504`'s "import is lossless" and §2's "the validator accepts what the
  detector accepts" are met only *through* the upgrade pass, not by the reader alone

## Context

`trip-data.json` is first-party: this app is its only writer and its only reader (`ADR-0014`). That
makes it the one format here whose *spelling* can change between generations of the app without
anyone outside noticing — and it is also the format a person's file is most likely to be old, because
it is the one the app tells them to keep.

It changed. The retired app (`app/io.js`) wrote:

| Wire field | Generation 1 wrote | This generation's schema says |
|---|---|---|
| `days[].id` | a number, minted by the exporter | string |
| `days[].chargeStops` | a number (`3`) | string |
| `days[].nacs` | a boolean | string |
| `days[].items[].minSoc` | free text (`"100%"`, `"54% — FLOOR for the day"`) | number |
| `minSocThresholds[].minSoc` | free text (`"100%"`, `"60%+"`) | number |
| `chargingNetworks[].nacsAdapter` | free text (`"True"`, `"Tesla SC: Yes"`) | boolean |

A real generation-1 export — nine days, 63 KB, every collection populated — was handed to this app and
did not import. It could not be committed (it is somebody's actual trip), so the corpus member is
`test/fixtures/trip-data-generation-1.json`: a three-day trip carrying every divergent shape the real
file carried, with the personal content replaced and the **types left exactly as the exporter wrote
them**. `TP.io.import.detect` identifies the real file correctly as `trip-data.json`, and the validator
then refuses it with 48 problems.

That is the failure this ADR is about, and it is worse than a refusal:

- **The validator and the detector disagreed about one file.** `06-interchange.md` §2's own rule is
  that a validator must not reject what the detector accepts. Here it rejected by 48 counts.
- **Two of the six divergences lost data in silence.** Bypassing the validator, `toItem` runs
  `numOrUndef("100%")` → `undefined`, and `minSoc` is named in `ITEM_KEYS`, so `copyUnknown` skips it
  as well. The value is gone and nothing says so. Thirteen items carried a `minSoc` in the file that
  prompted this, and **not one** of them survived the mapper; the ledger calls `item.flags` **M** while
  `REQ-504` says import is lossless.
- **`days[].id` stayed a number** through `toDay` and `normalize`, though the model's day id is a
  string — and `canonical.serialize` distinguishes `1` from `"1"`, so the same day became two
  different days to the payload hash, to history, and to `findDay`.

## Decision

**An older generation of `trip-data.json` is upgraded to this one before validation, and the upgrade
is gated on the file's shape.**

```
detect(text) -> TRIPDATA -> upgrade(value) -> check('tripdata', upgraded) -> toTrip
                                 ^                 ^
                    generation 1 becomes  |  the schema is asked about the
                    this generation here  |  document the app will actually read
```

The pass lives in `src/interchange/tripdatajson.js`, because that file is already the wire's authority
(`TRIP_KEYS`/`DAY_KEYS`/`ITEM_KEYS`/`COLLECTION_KEYS`) and the upgrade is a statement about the wire.
Both callers run it — `TP.io.import.readTripData` and `TP.ai`'s `guardResult` — so the app gives one
answer to "what is this file", and not one answer in the picker and another to the model.

### The gate: shape, not a version marker

`trip-data.json` carries no version field, and adding one now would not help the files that predate
it. So a document is generation 1 **iff it shows a value this generation's exporter cannot write**:

| Marker | Why it is one |
|---|---|
| `days[].id` is a number | This generation writes the model's day id, which is a string |
| `days[].chargeStops` is a number | The schema types it `text` |
| `days[].nacs` is a boolean | The schema types it `text` |
| `days[].items[].minSoc` is a string | The schema types it `number` |
| `minSocThresholds[].minSoc` is a string | Same |

Any one is enough, and once one is found the coercion is applied **document-wide**, because a file
that is generation 1 is generation 1 everywhere in it.

`chargingNetworks[].nacsAdapter` is deliberately **not** a marker. It is a divergence like the others,
but the only thing that distinguishes `"True"` from `"yes"` is the writer's intent, and a lone odd
string there is the hostile-input case the validator should still refuse. A real generation-1 file
carries a day-level signal, so nothing legitimate depends on this one being a marker. The malformed
corpus keeps `{chargingNetworks: [{nacsAdapter: 'yes'}]}` and both validators still refuse it.

### The coercions

| Field | Generation 1 → this generation |
|---|---|
| `days[].id`, `days[].chargeStops` | number → `String(n)` — mechanical, no invention |
| `days[].nacs` | `true` → `"NACS"`, the text the incumbent UI rendered for the flag; `false` → **absent**, not the string `"false"` (`ADR-0018`) |
| `days[].items[].minSoc`, `minSocThresholds[].minSoc` | a finite `Number()` → the number; anything else → the value moves to `minSocRaw` beside it and `minSoc` is deleted |
| `chargingNetworks[].nacsAdapter` | boolean, or `"true"`/`"false"` case-insensitively, → the boolean; anything else → `nacsAdapterRaw` beside it |

**`…Raw` is not a new mechanism.** It is the one this mapper already uses for a `cost` or a `time` the
wire spelled in prose (`toItem`, the `costRaw`/`timeRaw` bags), and it is why the round trip is exact
without a schema change: `minSocRaw` and `nacsAdapterRaw` are keys no key table names, so
`copyUnknown` bags them on the way in and `emitUnknown` writes them back on the way out. The schema is
open about unknown properties, so they validate. **Nothing about the vendored schema changed.**

The value is written back only while the field it stands in for is **absent** (`dropBag`, the same
guard `costRaw` uses). A person who later edits `"54% — FLOOR for the day"` to a number must not leave
the old prose in the file beside the number.

### Why the schema is not widened

The tempting alternative is to accept all six spellings. It is rejected because `06-interchange.md` §7
and `PAT-DEC-08` make the schema the app's statement about what a `trip-data.json` **is**, and a
schema that accepts a number where it means a string is a schema that has stopped saying anything.
Every downstream reader — the AI tools, a person reading the file, the next generation — would inherit
the ambiguity, and the ambiguity is not free: `1` and `"1"` hash differently, which is the
`days[].id` defect itself. Widening also cannot express the *prose* cases at all: `minSoc` is either a
number or it is not, and `"54% — FLOOR for the day"` is not one under any reading.

## Consequences

- **`REQ-504` ("import is lossless") now holds for generation 1**, and it holds through a mechanism the
  ledger can describe: the values this generation cannot type are **P** — preserved verbatim in the
  bag — which is exactly the classification `item.cost` already has for its prose case. §3.2 and §3.3
  say so.
- **The upgrade is idempotent**, and that is a property the tests assert rather than a hope: every
  marker is gone from its own output, so a second pass finds nothing and returns the input. Importing
  an exported file twice cannot change it twice.
- **`TP.model.normalize` stringifies a present `day.id`** as well, independently of the wire. The
  model says its day id is a string; a second import path that forgot the upgrade would otherwise put
  a number back in the model, and the failure would be a hash that changes on save.
- **A file is only upgraded when it is recognisably old.** A modern file that a person has hand-edited
  into a wrong type is still refused by the validator, still importable by nothing, and the refusal
  still names the path — the behaviour `REQ-516` exists for.
- The upgrade is a **document-wide pass over untrusted JSON**: it copies rather than mutates (a
  mapper that mutated the object `detect` returned would be editing a value another caller holds), it
  never deep-merges, and it skips `__proto__`/`constructor`/`prototype` (`REQ-503`).

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Widen the vendored schema to accept both generations' spellings | The schema stops being a statement about what the format is, and cannot express the prose cases at all. Also inherits the `1` vs `"1"` ambiguity into every reader |
| Coerce every file, marker or not | Silently rewrites the wrong types of a modern file a person hand-edited, turning a refusal that names a path into a quiet rescue — and it is the same code path an attacker's file would take |
| Detect by a `format`/`version` field in the document | The files that need this predate any such field; a marker that old files do not carry identifies nothing |
| Refuse generation-1 files with an apology | An app that cannot re-read the format it told the user to keep has broken the one promise the format exists for. `06-interchange.md` §2.1 already says a nearly-readable file refused is how a user concludes their data is lost |
| Drop the prose `minSoc` with a disclosure instead of bagging it | `REQ-504` says import is lossless, and the disclosure is an **export** obligation. There is a place to put the value and no reason to lose it |
| Mint new ids for the numeric `days[].id` | The id is what the day's calendar `UID` embeds (`03-data-model.md` §3). Renumbering an imported trip silently breaks every reference a person's other copy of the file holds |

## References

`specs/06-interchange.md` §2, §2.1, §3.2, §3.3, §7; `REQ-205`, `REQ-503`, `REQ-504`, `REQ-513`,
`REQ-516`; `ADR-0008`, `ADR-0014`, `ADR-0018`; `test/fixtures/trip-data-generation-1.json`;
`app/io.js:173` (the numeric day id), `src/interchange/tripdatajson.js` (`upgrade`).
