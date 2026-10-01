# ADR-0017 — The calendar's private properties, and the ATTENDEE fold

- **Status:** Accepted
- **Pattern decision:** Not a `PAT-DEC` — instance-specific (how the chosen format's fields reach the model)
- **Specified in:** `06-interchange.md` §3.1, §3.2
- **Deviation:** **Yes** — three departures from §3's `iCalendar` column, one of them from `REQ-515`'s letter

## Context

`06-interchange.md` §3 is the lossiness ledger, and `PATTERN.md` §8.1 step 3 says to write it *before*
the mappers. It was: the tables in §3 are the specification the mapper was built against.

Building it surfaced three places where the ledger, as written, could not be implemented — and one
place where the implementation silently ignored the ledger instead of disagreeing with it out loud.
The export dialog is generated from the ledger (`TP.ledger.disclosures('ical')`), so a mapper that
deviates without the ledger saying so makes the disclosure a lie in one direction or the other. Hence
this record, and the edits it made to §3.

## Decision

| # | Departure | Where it is now |
|---|---|---|
| 1 | `ATTENDEE` is **not** a bag member on the event; it folds into `trip.travelers[]` | §3.1 travellers row, §3.2 `ATTENDEE` row |
| 2 | `X-TP-KIND: ITEM` is written, and read back | §3.2, the paragraph after the table |
| 3 | `X-TP-TRAVELERS` is written, and read back | §3.1 travellers row, same paragraph |

### 1. ATTENDEE folds into the travellers, and a rich one is kept whole

`REQ-515` names `ATTENDEE` among the properties preserved "in the `x.iCal` bag", and §3.2 listed it as
**P** alongside `VALARM` and `RRULE`. Implemented literally, that is wrong twice:

- **It duplicates the travellers.** The model already claims the property — §3.1 folds `trip.travelers[]`
  into `ATTENDEE` "where an email exists" and back. A bagged copy on the event, beside the one the fold
  writes, produces two `ATTENDEE` lines per person per event. And this app writes the travellers on
  *every* event (a trip can be a day with a drive and no items, and writing them on item events alone
  loses every addressed traveller of such a trip), so the bag would grow with the event count and every
  import of the app's own file would find a foreign `ATTENDEE` in it.

- **It was losing the parameters.** `ATTENDEE` was therefore put in the mapper's own list — the list that
  stops `carryBag` from bagging a property the mapper accounts for — and the fold reads only `CN` and the
  `mailto:`. Everything else an `ATTENDEE` can carry (`PARTSTAT`, `ROLE`, `RSVP`, a value that is not a
  `mailto:` at all) was dropped on the floor, and the ledger went on promising **P**. A calendar that
  said the guest had declined came back saying nothing about it.

The fix keeps the fold and closes the loss: a line in **exactly the shape this app writes** — a `CN`
parameter and a `mailto:` value — needs no bag, because the traveller already holds everything in it.
Anything else is kept **whole, on the traveller**, under `x.iCal.ATTENDEE`, and written back verbatim
(`REQ-207`: a bag is never interpreted). The traveller is the entity the property is about, so this is
also where `EMAIL` already lives, and it survives a `trip-data.json` leg in the carrier like any other
calendar bag (§3.5).

`REQ-515`'s substance holds — nothing is dropped — but its *placement* does: the unmodelled parameters
are preserved in the **traveller's** `x.iCal` bag, not the event's. That is the deviation from the
requirement's letter, and §3 now says so.

Two smaller consequences of the same work are recorded here rather than in a separate ADR:

- **A traveller with an address but no `mailto:` URI** keeps its address in the bag's `ATTENDEE` line and
  not in `EMAIL`: `EMAIL` is what the model means by an address, and a URN is not one.
- **A parameter value containing `:`, `;` or `,` is re-quoted when a bagged line is written.** The parser
  strips quotes and the writer did not put them back, so `X-CODE="a:b"` was re-emitted as `X-CODE=a:b` —
  and the next read split at that colon, silently corrupting the value. Only values that need quotes get
  them, so a line that was conformant and unquoted (`CN=Ann Other`) is unchanged.

### 2. X-TP-KIND: ITEM — the app's own marker for a shape a calendar cannot distinguish

A date-only `VEVENT` is a day (§3.2: `day.date` is "`DTSTART`/`DTEND` of the day's all-day event"). That
is also the shape this app writes for an **item with no time**. Without a marker the two are
indistinguishable and a timeless item comes back as a day heading — the item is gone, and the day is
wrong. `X-TP-KIND: ITEM` is the marker.

It is private to this app's own files. A calendar from anywhere else has no such line, and its date-only
events are read as days, which is the only honest reading of a foreign file. It is read case-insensitively
and only for the exact value `ITEM`.

### 3. X-TP-TRAVELERS — what makes the fold of §3.1 reversible at all

§3.1 says the names travel in `X-TP-TRAVELERS`, one per line, and that this is what restores their
**order**. It is also the only thing that carries a traveller who has **no address** — such a traveller
has no `ATTENDEE` to fold into, and without the list the name is lost, which would make the row a **D**
rather than an **F**.

It carries **all** the names, not only the addressless ones, for exactly the reason it exists: the list is
what restores the order, and `ATTENDEE` lines cannot (they are unordered with respect to a traveller that
has none). It is a `VCALENDAR` property, so it cannot ride in `X-WR-CALDESC` without breaking the exact
fold the key tips rely on — and `X-` is where RFC 5545 puts a producer's own conventions.

## Consequences

- The two private properties are the answer to "why does this app write lines no other calendar writes?"
  They are also why a **foreign** calendar is read correctly: both are absent there, and the mapper's
  reading of a foreign file does not depend on them.
- A reader that does not know them ignores them, which is what `X-` is for. Neither is required for the
  file to be a valid calendar: an `.ics` from this app opens in any calendar application.
- `ADR-0014`'s last bullet — "the bags carry … `ATTENDEE` — so importing a calendar and re-exporting it
  does not silently strip someone's alarms" — should be read as covering `VALARM` and `RRULE`, which are
  bagged verbatim. `ATTENDEE` is the one property the model claims for itself, and it is preserved as a
  traveller rather than as a bag line. The sentence's *conclusion* stands; this ADR corrects its
  mechanism.
- §3.2's `ATTENDEE` row and the two-property paragraph are the ledger's side of this ADR, and the
  disclosure the user sees is generated from them, so the dialog and the mapper cannot drift apart.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Bag every `ATTENDEE` on the event, as `REQ-515` reads | Duplicates every traveller once per event, and every import of the app's own file finds a foreign one |
| Drop the parameters and keep the ledger's **P** | The loss the ADR exists to record — a declined invitation silently becomes an unanswered one |
| Write a second private property for each unmodelled parameter (`X-TP-PARTSTAT`) | One private property per parameter, per format, forever, and each one needs a reader. The bag already exists and is opaque |
| Read a date-only `VEVENT` as an item when the summary is non-empty | A guess, and the one shape (`X-TP-KIND`) that states the answer costs one line |

## References

`specs/06-interchange.md` §3.1, §3.2, §3.5, §5.1; `REQ-205`, `REQ-207`, `REQ-504`, `REQ-515`;
`ADR-0007`, `ADR-0014`; RFC 5545 §3.1 (SAFE-CHAR), §3.8.8.2 (the `X-` property namespace), RFC 6868.
