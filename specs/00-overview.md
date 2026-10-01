# 00 — Overview

**Instance:** Trip Planner, re-specified as a Portable Versioned Document.
**Pattern:** [`PATTERN.md`](../PATTERN.md) — The Portable Versioned Document pattern (PVD).
**Status:** specification. No application code has been changed to match it yet.
**Last updated:** 2026-09-29.

---

## What this document set is

`PATTERN.md` describes a shape — one file carrying its own payload, its own history, and its own
application — and ends with an instantiation checklist (§8). This directory is that checklist's
output for *this* application.

These are **specifications**, not descriptions of what the code does today. Where the two disagree,
the spec is the intent and the code is the work. Every claim about the present state of the code
carries a `file:line` citation so the gap can be measured.

The application is a trip planner. `PATTERN.md` §8.3 lists *vacation planning* as a worked fit,
which makes this instance the counterweight case the pattern itself highlights: it needs far less of
the machinery than the reference implementation, and the value comes almost entirely from the file
carrying its own history.

## Reading order

| If you want to… | Read |
|---|---|
| know what must be true | `01-requirements.md` — the `REQ-*` registry, and the source of truth |
| understand the shape of the artifact | `02-architecture.md` |
| understand the data | `03-data-model.md`, then `06-interchange.md` |
| understand the hard part | `04-versioning.md` |
| understand what breaks per platform | `07-ui.md` (§4), `05-storage.md` (§6) |
| know what is *not* settled | `10-open-questions.md`, and `decisions/` |
| know what to be afraid of | `08-security.md` |

§1–§3 of `PATTERN.md` decide *whether* this pattern fits. That question is settled for this
application and is not re-argued here.

## The instance in one paragraph

A user opens `trip-planner.html` — one file, double-clicked, no server. The file contains the trip
(one trip per file), the commit history of that trip, and the entire application. They edit the
itinerary, add a booking, move a charge stop. Each meaningful change is a commit. They send the file
to a travel companion, who edits their own copy. When the copies come back together, the file
reconciles them by ancestry — silently when one is a strict ancestor of the other, and by stopping
and asking when they have genuinely diverged. The same file can be exchanged with the wider world as
`trip-data.json` or as iCalendar. When it is served from a web origin instead of opened from disk,
an AI planner becomes available; from `file://` it is not, and the reason is stated rather than
implied.

## Identifier scheme

Three namespaces, and they do not overlap:

| Scheme | Lives in | Meaning |
|---|---|---|
| `REQ-<group><nn>` | `01-requirements.md` | A requirement on **this instance**. Groups: `1xx` artifact/build, `2xx` model/container, `3xx` history, `4xx` storage, `5xx` interchange, `6xx` UI/environment, `7xx` security, `8xx` testing. |
| `PAT-INV-nn`, `PAT-DEC-nn`, `PAT-AP-nn` | `PATTERN.md` | Properties of the **pattern**, not of this instance. Cited, never redefined here. `PATTERN.md` §"Identifier scheme" explains why the pattern deliberately mints no `REQ-` ids. |
| `ADR-nnnn` | `decisions/` | A decision made for this instance, with its cost. One per `PAT-DEC-nn`, plus two the pattern's catalogue does not cover (`ADR-0015`, `ADR-0016`). |

A requirement is never restated from `PATTERN.md`. It cites. If a `PAT-INV-*` is not honoured here,
that is recorded as a deviation in an ADR — never by quietly dropping the invariant.

## The five seams, concretely

`PATTERN.md` §4.2 requires five boundaries, each so a decision can change in one place. In this
application:

| Seam | Spec | Isolates |
|---|---|---|
| Container codec | `02-architecture.md` §5 | Parsing and serializing the embedded JSON block, and the escaping around it |
| Canonical model | `03-data-model.md` | The one internal representation everything agrees on |
| Version control core | `04-versioning.md` | Serialization, hashing, DAG, deltas, ancestry, merge base — pure logic, no DOM |
| Storage adapter | `05-storage.md` | All persistence behind one interface |
| Interchange adapters | `06-interchange.md` | One per external format, both directions |

Two further single-owner seams this instance adds, because the pattern's invariants require them:

| Seam | Spec | Rule |
|---|---|---|
| Environment | `07-ui.md` §4 | The only module permitted to read `location.protocol` |
| Render | `07-ui.md` §5 | The only path from data to DOM |

"The only module permitted to…" mirrors `PAT-INV-12`'s discipline for storage. It is the same idea
applied twice: a platform difference confined to one file is a configuration; the same difference
spread across forty files is a bug class.

## Conformance summary

Every invariant, and how this instance satisfies it or where it deliberately does not.

| Invariant | Satisfied by |
|---|---|
| `PAT-INV-01` file is the primary carrier | `02-architecture.md`, `REQ-101`; `ADR-0001` |
| `PAT-INV-02` storage is a cache | `05-storage.md`, `REQ-403`, `REQ-404`; `ADR-0001`, `ADR-0012` |
| `PAT-INV-03` ordering is by ancestry | `04-versioning.md` §6, `REQ-312`; `ADR-0005` |
| `PAT-INV-04` divergence always prompts | `04-versioning.md` §7, `REQ-313`; `ADR-0006` |
| `PAT-INV-05` nothing discarded silently | `04-versioning.md` §9, `REQ-318`, `REQ-319` |
| `PAT-INV-06` history is append-only | `04-versioning.md` §8, `REQ-314` |
| `PAT-INV-07` id covers the semantic payload | `04-versioning.md` §3, `REQ-302` |
| `PAT-INV-08` app code byte-identical in every export | `02-architecture.md` §6, `REQ-110` |
| `PAT-INV-09` every input is untrusted | `08-security.md`, `REQ-501`–`REQ-503`, `REQ-701`–`REQ-706` |
| `PAT-INV-10` import lossless, export discloses loss | `06-interchange.md` §3, `REQ-504`, `REQ-511` |
| `PAT-INV-11` canonical model is a neutral superset | `03-data-model.md` §2, `REQ-202`; `ADR-0007` |
| `PAT-INV-12` all persistence through one adapter | `05-storage.md` §2, `REQ-401`; `ADR-0012` |
| `PAT-INV-13` pointer written last, removed first | `05-storage.md` §5, `REQ-407` |
| `PAT-INV-14` boot is deterministic | `02-architecture.md` §6, `07-ui.md` §9, `REQ-506`, `REQ-612` |

Anti-patterns this instance is specifically on watch for, because the present code already leans
toward them:

| Anti-pattern | Present-state risk |
|---|---|
| `PAT-AP-01` trusting storage as the record | The app has no file carrier at all today — every trip lives only in IndexedDB (`app/db.js`), so clearing the browser profile is total data loss |
| `PAT-AP-07` parsing the imported document to read it | `readFileAsJSON` (`app/io.js:249`) uses `FileReader.readAsText` + `JSON.parse` into ordinary objects. Closer to correct than a DOM parse, but the parse targets a mutable prototype and the path assumes a JSON interchange file rather than the artifact |
| `PAT-AP-08` a lossy import with no ledger | Import/export is field-by-field (`app/io.js`), with `importedRaw` as an ad-hoc passthrough and no classification of what is dropped |
| `PAT-AP-10` claiming the file is safe to open | Nothing today states the posture either way. `08-security.md` must not soften it |
| `PAT-AP-04` reintroducing a server "just for sync" | Nothing today, and nothing proposed. It is on the watchlist because this instance **refuses** cross-instance coordination (`Q-8`), which invites exactly this proposal — and `PAT-AP-04` says to decide consciously rather than drift |

## Deviations from the reference implementation

Called out here so a reader comparing this set to `PATTERN.md` §12 finds them immediately. The table
records **three kinds** of difference: a genuine deviation (rows 1–3), a reference choice this instance
**confirms** for a domain-specific reason worth stating (row 4), and something this instance adds that
the pattern has no decision id for (rows 5–6). Each is justified in its ADR.

| # | Reference chooses | This instance chooses | ADR |
|---|---|---|---|
| 1 | Pin one stylesheet to a CDN with an integrity hash; accept degraded offline styling | Inline **everything**; no external reference of any kind. Offline is the point of the file, so `PAT-DEC-02`'s own "choose differently when" clause applies | `ADR-0002` |
| 2 | `localStorage` behind an adapter | Same choice, but it replaces a working IndexedDB store, so the ADR carries a migration | `ADR-0012` |
| 3 | The domain's two real interchange formats | `trip-data.json` is bespoke; it is treated as a first-party format rather than a domain interchange format, with iCalendar as the genuine external one | `ADR-0014` |
| 4 | Deltas with periodic keyframes | Kept. History length is unknown for a long trip and the payload is large enough that snapshots alone would grow badly | `ADR-0003` |
| 5 | — | **AI is served-only.** The pattern has no decision id for "a capability that cannot exist in the portable form"; this instance does | `ADR-0015` |
| 6 | — | **One trip per document.** The pattern's §8.3 implies it; this instance makes it explicit against a current codebase that stores many trips | `ADR-0016` |

## Glossary

Terms are `PATTERN.md`'s. These are the instance-specific bindings.

| Term | Here |
|---|---|
| Artifact | `trip-planner.html` |
| Payload | One trip, in the canonical model of `03-data-model.md` |
| Canonical model | The superset of `trip-data.json` and iCalendar VEVENT |
| Container | The `<script type="application/json" id="app-data">` block |
| Commit | A trip snapshot, an author, a message, parent links, a content-derived id |
| Keyframe | A commit stored as a full snapshot (roots, merges, oversized patches, every 20th) |
| Passthrough bag | `x.tripDataJson` and `x.iCal` on canonical entities |
| Pristine DOM | The document clone captured as the application's first statement |
| Registry | The local index of known documents (`tp.registry`) |
| Working copy | The editable trip in memory, derived from the head commit; clean or dirty |
| Environment | The single module that reads `location.protocol` and answers `aiEnabled` |

## What this set deliberately leaves open

`10-open-questions.md`. The pattern is explicit that a spec listing what it does not know is more
trustworthy than one that appears to know everything, and three of the questions there are load
bearing for the `file://` design.
