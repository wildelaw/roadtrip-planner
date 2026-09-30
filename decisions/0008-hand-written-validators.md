# ADR-0008 — Hand-written validators, cross-checked once

- **Status:** Accepted
- **Pattern decision:** `PAT-DEC-08` — Validating imported documents
- **Specified in:** `06-interchange.md` §7, `09-testing.md` §6
- **Deviation:** None

## Context

Schema validation wants a real validator. A real validator is a dependency. And **a subtly wrong
validator is worse than none**, because it gives confident wrong answers: it accepts a malformed
document that then fails somewhere less explicable, or rejects a valid one and the user concludes their
file is corrupt.

The artifact is one file with one policy origin. A runtime validator dependency would be a second origin
and a second supply chain.

## Decision

**Format-specific hand-written validators, covering the documented keyword subset the vendored schemas
actually use, cross-checked in the test suite only against a reference implementation over a corpus.**

| Rule | |
|---|---|
| Hand-written, per format, covering only the keyword subset actually used | `REQ-516` |
| Vendored and inlined at build time, so validation works offline | `REQ-115` |
| Cross-checked against a reference implementation **in the test suite only** | `REQ-806`, `REQ-807` |
| No runtime validator dependency | `REQ-516` |

## Consequences

- The cross-check only proves agreement **on the corpus**. A thin corpus ships a divergence with a
  passing test. This is the cost `PAT-DEC-08` names, and it is addressed by making the corpus a
  deliverable rather than an afterthought (`09-testing.md` §6).
- Minimum corpus: an artifact exported by this app; a `trip-data.json` of each generation present in the
  repo's history; a hand-written `.ics` with recurrence, alarms, attendees and time zones; and every
  malformed case from the hostile-input sweep.
- The hand-written validator must be **deliberately incomplete** — covering only the keywords the
  vendored schemas use — and that incompleteness must be stated, because an incomplete validator that
  looks complete is the "confident wrong answers" failure.
- A schema update is a deliberate act (re-vendor, re-cross-check), not something that changes underfoot.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| A runtime validator library | A second policy origin inside a file whose premise is that it has one, and a permanent size cost |
| A CDN-loaded validator | Breaks offline (`ADR-0002`) and fails the same policy test |
| No validation at all | Imports malformed documents and fails later, less explicably. `PATTERN.md` §5.9 requires limits to fail with an explanation |
| Validate by attempting a full parse and catching | Catches syntax, not structure. A document with a string where an array belongs parses fine |

## References

`PATTERN.md` `PAT-DEC-08`, §5.11; `specs/06-interchange.md` §7; `specs/09-testing.md` §6;
`REQ-115`, `REQ-516`, `REQ-806`.
