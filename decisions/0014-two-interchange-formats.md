# ADR-0014 — Two formats: a first-party JSON and a genuine calendar

- **Status:** Accepted
- **Pattern decision:** `PAT-DEC-14` — Which interchange formats to support first
- **Specified in:** `06-interchange.md` §1
- **Deviation:** **Partial** — `trip-data.json` is treated as first-party rather than as a domain interchange format

## Context

Every format costs two mappers, a validator, a ledger column, and test corpus entries.

`PAT-DEC-14`'s reference choice is "the two formats the domain's users actually exchange, and no others,
in the first version. Formats with a broken upstream export path are deferred, not half-done."

Strictly applied to this domain, the formats users actually exchange are **calendars** and
**spreadsheets**. They are not `trip-data.json`, which is nobody's format but this application's.

## Decision

**Two formats.**

| Format | Kind | Role |
|---|---|---|
| **Artifact** (`trip-planner.html`) | First-party container | The document itself — payload, history, and application |
| **`trip-data.json`** | **First-party interchange** | The format this app already exchanges, and the one the AI agent writes into |
| **iCalendar (`.ics`, RFC 5545)** | Genuine external interchange | The itinerary leaves as a calendar |

## The deviation

`trip-data.json` is **not** a domain interchange format, and pretending it is would be a false
statement about where a user's data can go. The honest framing is that it is the application's own
format — bespoke, stable, and by construction lossless for this model.

The practical consequence is stated rather than hidden: **its ledger column is nearly all `mapped`.**
It was designed as the app's own shape, so it loses almost nothing. `06-interchange.md` §3.5 names
exactly what remains — the UI-only `done` flags and derived roll-ups — which is a much shorter list
than the present code's implicit one.

This matters because the ledger's value depends on it being read honestly. A reader who assumes
`trip-data.json` is a third-party format would expect a long list of dropped fields, find a short one,
and conclude the ledger was written carelessly. It was written correctly; the format is first-party.

## Consequences

- **GPX is deferred, not declined** (`10-open-questions.md` Q-9). A road-trip planner plausibly wants
  routes and waypoints — but deferral is about the **upstream export path**, not the format. A
  half-done GPX mapper produces nearly-empty documents and the user concludes the app lost their data.
- Spreadsheets are **not** supported, despite being a format this domain exchanges. Omitted from the
  first version, and the omission is deliberate rather than forgotten.
- The iCalendar side carries an extensive ledger (`06-interchange.md` §3) and a **disclosure obligation**
  for every dropped field, stated in the UI before the file is written. The disclosure's last sentence
  points at the format that *is* complete, because enumerating losses without that pointer leaves a user
  reasonably concluding their data is gone.
- The passthrough bags (`ADR-0007`) carry unmodelled `VEVENT` properties — `VALARM`, `RRULE`, `ATTENDEE`
  — so importing a calendar and re-exporting it does not silently strip someone's alarms.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| One format (the artifact only) | A user cannot get their itinerary into a calendar, which is the most obvious thing to want |
| iCalendar only, dropping `trip-data.json` | Breaks the AI agent's output path and the existing import/export round-trip |
| Add GPX now | No upstream export path, so it would be a half-done mapper — the failure `PAT-DEC-14` names |
| Add CSV/spreadsheet now | A third and fourth set of mappers, validators and ledger columns for a need nobody has stated |

## References

`PATTERN.md` §8.3, `PAT-DEC-14`; `specs/06-interchange.md` §1, §3; `REQ-514`, `REQ-515`;
`specs/10-open-questions.md` Q-9.
