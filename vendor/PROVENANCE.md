# Vendored schemas

`PATTERN.md` §5.11 and `REQ-115`: **vendor external schemas at build time and inline them**, so
validation works offline and a schema update is a deliberate act rather than something that changes
underfoot. Nothing here is fetched at runtime; `build.js` reads these files and inlines them into the
artifact (see `src/validators/vendored.js`).

`ADR-0008` is the decision this directory serves: hand-written validators, covering only the keyword
subset the vendored schemas actually use, cross-checked in the test suite only.

| File | What it is | Where it came from | How it is updated |
|---|---|---|---|
| `trip-data-1.0.0.schema.json` | JSON Schema (2020-12) for the first-party `trip-data.json` wire | Written here. `trip-data.json` is this app's own format (`ADR-0014`), so there is no upstream to track — the mapper in `src/interchange/tripdatajson.js` is the authority | By hand, when the wire changes. The mapper's `TRIP_KEYS` / `DAY_KEYS` / `ITEM_KEYS` / `COLLECTION_KEYS` tables are what it must agree with |
| `container-1.0.0.schema.json` | JSON Schema for the PVD envelope (`payload` + `history`) | Written here, from `src/core/container.js` and `specs/04-versioning.md`. The URI is the one `TP.container.SCHEMA` already names | By hand, when the envelope changes; `TP.container.FORMAT` is the version it tracks |
| `icalendar-rfc5545.json` | A transcription of the parts of RFC 5545 a validator can check structurally — required properties per component, component nesting, property value types, the 75-octet line rule | **RFC 5545**, §3.6 (components) and §3.8 (properties) | By hand, against the RFC. The `notes` array records the three places where the RFC's rules are relations rather than tables, and are therefore checked in code |

## The rules that keep this honest

**It is deliberately incomplete, and it says so.** `ADR-0008` names the failure: "a subtly wrong
validator is worse than none because it gives confident wrong answers". An incomplete validator that
*looks* complete is that failure. So every schema here states in its own `description` what it does not
claim, and `src/validators/schema.js` refuses to silently ignore a keyword it does not implement —
`unsupportedKeywords()` reports them, and the test suite fails if the vendored schemas use one.

**The corpus is the deliverable too.** `ADR-0008` and `09-testing.md` §6: a cross-check only proves
agreement *on the corpus*, so a thin corpus ships a divergence with a passing test. The corpus in
`test/validators.test.js` includes an artifact this app exported, a `trip-data.json` from each
generation in the repo's history, a hand-written `.ics` with recurrence, alarms, attendees and time
zones, and every malformed case from the hostile-input sweep.

The generation-1 member is a real file rather than a hand-written one: a full export by the retired
app is committed at `test/fixtures/trip-data-generation-1.json` (trimmed to a three-day trip, with
the personal details removed and the types left exactly as the exporter wrote them). It is a corpus
member the validator must NOT accept as written — numeric day ids, boolean `nacs` and prose `minSoc`
are the previous generation's spellings — so what the corpus compares is the file after
`TP.tripdatajson.upgrade`, which is the state the import pipeline actually validates (`ADR-0019`).
That the two generations disagree about those spellings is asserted separately, in
`validators.test.js`.

**A schema update is a deliberate act.** The files are checked in, and `test/validators.test.js`
asserts the fragment the artifact carries is byte-for-byte the file here — so a schema edited without
being re-inlined fails the suite rather than shipping a discrepancy between what is validated and what
the reviewer read.
