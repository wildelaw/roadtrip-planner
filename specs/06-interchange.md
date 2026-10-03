# 06 — Interchange

Import, export, the lossiness ledger, and the validators.
Implements `REQ-501`–`REQ-519`, `PAT-INV-09`, `PAT-INV-10`, `PAT-DEC-08`, `PAT-DEC-14`.

---

## 1. The formats

`PATTERN.md` §8.1 step 2: choose the formats, vendor their schemas, and give each a **detection rule
based on structural markers, never the filename**. `PAT-DEC-14` says two is a good number and that
"formats with a broken upstream export path are deferred, not half-done".

| Format | Kind | Role | ADR |
|---|---|---|---|
| **Artifact** (`trip-planner.html`) | First-party container | The document itself. Payload + history + app | `ADR-0001` |
| **`trip-data.json`** | First-party interchange | The format this app already exchanges, and the one the AI agent writes into. Bespoke, but it is the incumbent and it is lossless by construction | `ADR-0014` |
| **iCalendar (`.ics`, RFC 5545)** | Genuine external interchange | The format the domain actually uses. The itinerary leaves as a calendar | `ADR-0014` |

`PAT-DEC-14`'s reference choice is "the two formats the domain's users actually exchange". Strictly,
this domain's formats are calendars and spreadsheets, and `trip-data.json` is nobody's format but this
app's. Treating it as first-party rather than pretending it is an interchange standard is the
deviation `ADR-0014` records. The practical consequence is that its ledger column is nearly all
`mapped` — it was designed as the app's own shape.

**GPX is deferred, not declined** (`10-open-questions.md` Q-9). A road-trip planner plausibly wants
routes and waypoints, but a half-done GPX mapper with no upstream import path is worse than none.

---

## 2. Detection rules

| Format | Rule | Never |
|---|---|---|
| Artifact | The text contains the literal `<script type="application/json" id="app-data">` | Never `.html` as an extension |
| `trip-data.json` | Parses as JSON; the root is an object; `typeof root.trip === 'object'` **or** `Array.isArray(root.days)` | Never `.json` as an extension |
| iCalendar | After an optional BOM and leading whitespace, the text begins `BEGIN:VCALENDAR` | Never `.ics` as an extension |

The present detection is extension- and content-sniffing for JSON only
(`app/ui/shell.js:140`, `accept=".json,application/json"` at `index.html:19`). The `accept` attribute
stays as a convenience for the file picker; it is never the check. `PATTERN.md` §8.1 step 2 is
explicit that the detection rule is structural, and the reason is that an extension is attacker- and
user-controlled while structure is a property of the bytes.

### 2.1 Which path a file takes

```
detect(text):
  if contains('id="app-data"')  -> ARTIFACT   -> import as a document (§5.2)
  if starts with BEGIN:VCALENDAR -> ICALENDAR -> import as a new document (§5.3)
  if parses as JSON with trip/days -> TRIPDATA -> import as a new document (§5.3)
  otherwise                     -> refuse, explaining what was looked for
```

Refusing matters. A file that is *nearly* a format is the case where a lenient parser silently
produces a nearly-empty document, and the user concludes the app lost their data.

**`trip-data.json` gains one step, and only that format.** It is first-party, so its spelling can
change between generations of this app without anyone outside noticing — and it is the format a
person is most likely to be holding an old copy of, because it is the one the app tells them to keep.

```
detect(text) -> TRIPDATA -> upgrade(value) -> check('tripdata', upgraded) -> toTrip
                                 ^                     ^
                    generation 1 becomes    |  the schema is asked about the
                    this generation here    |  document the app will actually read
```

`TP.tripdatajson.upgrade` is gated on **shape, never on a version field** — the files that need it
predate any such field. A document is the previous generation iff it shows a value this generation's
exporter cannot write (a numeric `days[].id`, a numeric `days[].chargeStops`, a boolean `days[].nacs`,
or text where a `minSoc` is expected); once one is found, the coercions are applied document-wide, with
any value this generation cannot type preserved verbatim in the passthrough bag rather than dropped.
The vendored schema is **not** widened: a schema that accepts a number where it means a string has
stopped saying what the format is, and it cannot express the prose cases at all. `ADR-0019` records
the marker set, the coercion table, and why each alternative was rejected.

| Rule | |
|---|---|
| A validator must not refuse what the detector accepts | §2. On a generation-1 file it did, by 48 counts — the two disagreed about one document |
| A format's own older spelling is an upgrade, not a malformed file | It is neither hostile input nor a mistake by the user; it is a file this app wrote |
| A value this generation cannot type is **P**, never silently dropped | `REQ-504`, and the `costRaw`/`timeRaw` precedent for exactly this |
| A modern file is not coerced | The gate is the point. A hand-edited wrong type in a modern file is still refused, and the refusal names the path |
| The upgrade is idempotent | Every marker is gone from its own output, so importing an exported file twice cannot change it twice |
| Both readers run it | `readTripData` and the AI's `guardResult` — one answer to "what is this file", not one in the picker and another to the model |

---

## 3. The lossiness ledger

`PATTERN.md` §8.1 step 3: **write the ledger before the mappers.** One table, both directions, every
field classified. It is what makes "did we forget a field?" a mechanical check (`REQ-511`,
`REQ-512`, `PAT-AP-08`).

Classifications:

| Code | Meaning |
|---|---|
| **M** mapped | Round-trips with the same meaning |
| **F** folded | Represented, but combined with other fields; un-folded on import |
| **D** dropped | Not representable in that format. **Disclosed at export**; not recovered on import |
| **P** passthrough | Preserved verbatim in a bag (`x`), never interpreted |

There is no **M** on the iCalendar side for anything with no `VEVENT` counterpart, and every **D** is
a disclosure obligation, not a silent omission.

The tables below are the ledger `src/interchange/ledger.js` holds, in the same order and the same
words; a reviewer comparing the two should find them identical. They are also what the mapper's key
tables must agree with — `trip-data.json` writes a **closed list** of fields, on purpose, and a field
missing from that list is one a panel can write and the exporter will silently drop. Five such fields
had accumulated; `ADR-0022` records the class, why the completeness check could not see it, and the
two-part guard that now can.

### 3.1 Trip-level

| Canonical field | `trip-data.json` | iCalendar | Note |
|---|---|---|---|
| `trip.id` | M | P | iCal has no trip-level id. On `.ics` import a `docId` is minted |
| `trip.docId` | D | D | Document identity, not trip content. Never exported (`REQ-211`) |
| `trip.title` | M (`trip.title`) | M (`X-WR-CALNAME`, and each `SUMMARY` carries the item title) | |
| `trip.subtitle` | M (`trip.subtitle`) | D | Disclosed |
| `trip.currency` | M | D | Disclosed. Synthesized as `USD` when absent (`03-data-model.md` §7) |
| `trip.startDate` / `endDate` | M | D | Derivable from the earliest/latest `VEVENT`; **derived on import**, never stored from the `.ics` |
| `trip.destinations[]` | M | D | Disclosed |
| `trip.travelers[]` | M | F | Folded into `ATTENDEE` where an email exists; the names travel in `X-TP-TRAVELERS`, one per line, which restores their order too. The address, which the model has no field for, is kept in the traveller's bag. Un-folding is best-effort: two travellers with the same name and only one address come back paired the other way round |
| `trip.vehicle` (all six fields) | M | D | Disclosed. EV planning has no calendar representation |

### 3.2 Days and items

| Canonical field | `trip-data.json` | iCalendar | Note |
|---|---|---|---|
| `day.id` | M | D | Derived on import from `DTSTART`; the `UID` this app writes embeds it (`03-data-model.md` §3), so a day from our own file keeps its id, but a calendar carries no day id. The previous generation's exporter minted a **number** here; the upgrade stringifies it, because `canonical.serialize` distinguishes `1` from `"1"` and the id is what the `UID` embeds (`ADR-0019`) |
| `day.date` | M | M | `DTSTART` / `DTEND` of the day's all-day event |
| `day.title` | M | F | Folded into that event's `SUMMARY` |
| `day.stay` | M | F | Folded into `DESCRIPTION` |
| `day.drive` | M | F | Folded into `DESCRIPTION` |
| `day.chargeStops` | M | F | Folded into `DESCRIPTION`. Written as a number by the previous generation; the upgrade stringifies it (`ADR-0019`) |
| `day.nacs` | M | F | Folded into `DESCRIPTION`. Written as a **boolean** by the previous generation; the upgrade restores the text its UI rendered for `true` and omits the field for `false` (`ADR-0018`, `ADR-0019`) |
| `day.summary` | M | F | Folded into `DESCRIPTION` |
| `day.dining[]` | M | F | Folded into `DESCRIPTION` as a list |
| `day.tips[]` | M | F | Folded into `DESCRIPTION` as a list |
| `item.id` | M | P | The `UID` is **derived** from it (`03-data-model.md` §3) and stored in `x.iCal` |
| `item.title` | M (`activity`) | M (`SUMMARY`) | |
| `item.time` | M (`time`) | M (`DTSTART` time) | |
| `item.timeRaw` | M | D | The original unparsed string. Disclosed |
| `item.type` | M (derived) | D | Not a `VEVENT` concept. Disclosed |
| `item.location` | M | M (`LOCATION`) | |
| `item.cost` | M | D | Disclosed |
| `item.currency` | M | D | Disclosed |
| `item.durationMin` | M | F | Folded into `DTEND − DTSTART` |
| `item.confirmation` | M | F | Folded into `DESCRIPTION` |
| `item.link` | M | M (`URL`) | Carried only when the value is already an absolute URL this app would use verbatim. The link field takes any text and a `URL` property must be a URI, so a value that is not one stays on the item — `trip-data.json` keeps it, the calendar does not carry it |
| `item.notes` | M (`desc`) | M (`DESCRIPTION`) | |
| `item.flags` (8 keys: `charge`, `overnight`, `tour`, `warn`, `minSoc`, `minSocCritical`) | M | D | Disclosed. Unrepresentable in a calendar. A `minSoc` the wire spelled in prose — which the previous generation did, `"54% — FLOOR for the day"` — is kept verbatim in the bag as `minSocRaw` and written back, exactly as a non-numeric `cost` is, so `M` holds rather than becoming a silent **D** (`ADR-0019`) |
| `item.x.iCal` (unmodelled `VEVENT` properties) | M | P / M | `VALARM`, `RRULE`, `ORGANIZER`, `SEQUENCE`, `STATUS`, `GEO`, `CATEGORIES`, `CLASS`, `TRANSP`, `PRIORITY`, `CREATED`, `LAST-MODIFIED` → **P** on `.ics`; **M** on `trip-data.json` (they ride along in the bag). `ATTENDEE` is **not** in this bag — see the row below. Nor is `URL`, which carries `item.link` and so has a row of its own above |
| `ATTENDEE` (not a bag member; consumed into `trip.travelers[]`) | M | F | The `CN` becomes the traveller's name and the `mailto:` the address in the traveller's bag. A line carrying anything else — `PARTSTAT`, `ROLE`, `RSVP` — names something the model has no field for, so the **whole line** is kept on the traveller and written back verbatim. Bagging it per event instead would duplicate every traveller once per event, since this app writes them on every one (`ADR-0017`) |

Two properties the calendar carries belong to this app and are not fields, so they have no row: `X-TP-TRAVELERS`
(the traveller names, in order — it is what makes the fold of §3.1 reversible at all, including for a
traveller with no address) and `X-TP-KIND: ITEM` (marks a date-only `VEVENT` that is a **timeless item**
rather than a day heading, which is the one shape the calendar cannot otherwise tell apart). Both are
`X-` properties, which is where RFC 5545 puts a producer's own conventions, and both are ignored by a
reader that does not know them (`ADR-0017`).

### 3.3 Collections

| Canonical collection | `trip-data.json` | iCalendar | Note |
|---|---|---|---|
| `lodging[]` (7 fields) | M | D | Disclosed. A lodging stay is not an itinerary entry in this model |
| `reservations[]` (8 fields + `done`) | M / D | D | All eight `trip-data.json` fields **M**; `done` is **D**. Disclosed |
| `noReservationNeeded[]` (2 fields) | M | D | Disclosed |
| `preTripActions[]` (4 fields + `done`) | M / D | D | `done` is **D**. Disclosed |
| `bucketList[]` (3 fields) | M | D | Disclosed |
| `chargingNetworks[]` (6 fields) | M | D | Disclosed. The previous generation wrote `nacsAdapter` as free text (`"True"`, `"Tesla SC: Yes"`); text this generation cannot read as a boolean is kept verbatim in the bag as `nacsAdapterRaw` (`ADR-0019`) |
| `minSocThresholds[]` (6 fields) | M | D | Disclosed. The previous generation wrote `minSoc` as free text (`"100%"`, `"60%+"`), kept verbatim in the bag as `minSocRaw` (`ADR-0019`) |
| `locations[]` (8 fields incl. nested `activities[]`) | M | D | Disclosed |
| `contacts[]` (2 fields) | M | D | Disclosed |
| `keyTips[]` | M | F | Folded into `X-WR-CALDESC` |
| `criticalAlerts[]` (3 fields) | M | D | Disclosed. A `VALARM` is *not* an alert here — it is an alarm on an event, and conflating them would be the "folded" category used dishonestly |
| `checklists[]` → `{category: string[]}` | M / D | D | `done` per item is **D**; the format has no place for it. This is today's behaviour (`app/io.js:235`) made explicit |
| `budgetEstimates[]` (4 fields) | M | D | Disclosed |
| `budget.categories` | D | D | **Derived, never stored** (`03-data-model.md` §2.3) |
| `expenses[]` (5 fields) | M | D | Disclosed |

### 3.4 The disclosure

Every **D** is surfaced, not buried. The `.ics` export dialog states, in the UI before the file is
written:

> This file is a calendar. It carries your itinerary — each day and each activity, with its time,
> location and notes. It cannot carry your budget, expenses, checklists, lodging, bookings, contacts,
> charging plan, or alerts, and it does not carry the trip's history. Those stay in
> `trip-planner.html`. **Export that file for a complete copy.**

The last sentence is the important one: the disclosure must point at the format that *is* complete,
not merely enumerate what is missing. Otherwise a user reasonably concludes their data is gone.

### 3.5 Round-trip guarantees

| Property | Held for | Requirement |
|---|---|---|
| Import is lossless | **Both** formats | `REQ-504` |
| Export is lossy and discloses it | `.ics` (extensively), `trip-data.json` (only `done` flags and derived fields) | `REQ-511` |
| Unedited imports round-trip without loss | `trip-data.json` | `REQ-513` |
| Bags survive a round-trip through the format they came from | Both | `REQ-205` |

An `x.iCal` bag also survives a round-trip through `trip-data.json`, where it rides in the carrier
(§3.2's `item.x.iCal` row). The reverse does not hold and cannot: a calendar has no place for a JSON
bag, so a `x.tripDataJson` bag is dropped by an `.ics` export, which is what the **D** in §3.1's and
§3.2's bag rows discloses.

`trip-data.json`'s remaining loss is exactly two things — the UI-only `done` flags and derived
roll-ups — and both are named above. That is a much shorter list than the present code's implicit one,
which is the point of writing the ledger first.

**Why that column is so short, stated so it is not mistaken for carelessness.** The present export is
already clone-based passthrough: `buildExportObject` (`app/io.js:100`) clones each collection item
wholesale and removes exactly two things — the UI-only `done` (`app/io.js:130`) and any synthetic id
the model invented when the source file had none (`app/io.js:126-132`). Everything else rides through
untouched. That is why nearly every row reads **M**: the format *is* the model, so the mapper is
mostly a copy. The ledger's job on this side is to prove nothing is lost and to name the two
exceptions, not to enumerate a long list of casualties.

---

## 4. Synthesis and blocking

Defined per field in `03-data-model.md` §7. Not repeated here; the rule is that synthesis happens
where a neutral default is honest and is disclosed, and blocking happens per-entity where any invented
value would be a false statement.

---

## 5. Import

`PATTERN.md` §5.9. Implements `REQ-501`–`REQ-504`, `REQ-517`, `REQ-518`.

### 5.1 Text only, always

> **An exported document is an executable HTML file.** Opening one means running its code.

That is not incidental — it is the design. So import is the primary mitigation, and it is
**layer 1**: read the file as *text*, locate the data block by string scanning, never insert the
document into the DOM, never parse it as markup, never execute it.

| Rule | |
|---|---|
| Read with `FileReader.readAsText` (or `file.text()`) | Never `DOMParser`, never `innerHTML`, never an `<iframe>` |
| Locate the block by **string scanning** for the marker, then take the text between the marker's closing `>` and the following `</script>` | A DOM parse would execute nothing by itself but would build a document from hostile markup, and one subsequent mistake turns that into execution |
| `JSON.parse` into a **null-prototype** object, or copy fields explicitly | `JSON.parse` produces `__proto__` keys happily. Any deep merge over it is a prototype-pollution primitive (`REQ-503`, `REQ-706`) |
| Never deep-merge | Field-by-field copying only |

The hostile file's code never runs, because nothing ever treats it as code. `PATTERN.md` §5.9 is
explicit that **a hostile file writes its own policy** — the CSP meta in the file permits the author's
own script's hash — so the policy contributes nothing here. Layer 1 is the mitigation; the policy is
secondary.

### 5.2 Importing an artifact

```
1. text = read as text
2. block = scan(text, 'id="app-data"')
3. container = nullProtoJSON(block)
4. guard: size, commit count, patch op count, nesting depth   (REQ-517)
5. verify chain                                                (04-versioning.md §5)
6. reconcile against local history                             (04-versioning.md §7)
7. register the document
```

Note step 6: importing an artifact is a **reconcile**, not a replace. That is the whole point of the
pattern — two copies of one file come back together without a server.

### 5.3 Importing an interchange file

`trip-data.json` and `.ics` produce a **new document** by default (`REQ-616`): a fresh `docId`, a
root commit whose payload is the mapped trip, and a registry entry. Replacing the current document's
payload is a separate action requiring explicit confirmation, because it discards real work
(`PAT-INV-05`).

### 5.4 Resource guards

`PATTERN.md` §5.9: "A hostile file can hang a tab. Every limit fails with an explanation and an offer
to export what was readable, never a blank page." Implements `REQ-517`, `REQ-518`.

| Guard | Bounds |
|---|---|
| Container size | Reject beyond a declared ceiling, with the actual figure named |
| Commit count | Reject beyond a declared ceiling |
| Patch operation count | Per commit, and in total |
| Nesting depth | On both the payload and any patch path |
| Embedded source length | For content shown as source text (§6 of `08-security.md`) |
| iCalendar property count and line length | RFC 5545 folds long lines; unfolding is a loop, and a loop fed hostile input is a hang |

---

## 6. Export

`PATTERN.md` §5.7. Full mechanism in `02-architecture.md` §5. Implements `REQ-505`–`REQ-510`.

| Step | |
|---|---|
| Clone `PRISTINE` | Captured as the application's first statement (`REQ-506`) |
| Write the container into `#app-data` (`REQ-507`) | `escapeForScriptBlock` — the escaping rule is part of the **container codec seam**, so it changes in one place (`02-architecture.md` §2) |
| Serialize | `'<!DOCTYPE html>\n' + clone.outerHTML` |
| **Verify before offering** | Five checks (`02-architecture.md` §5.1) |
| Offer | Download when served or when File System Access is available; **text + copy** under `file://`, and always reachable deliberately (`REQ-509`) |

`outerHTML` on the *clone* is the one permitted use of an HTML-serialization API in the codebase. It
serializes a document the app itself built, from a fixed shell template. `REQ-702`'s static check must
therefore be written to permit exactly this call site and no other — which is itself a reason the check
runs over the **built artifact** with a known allowlist rather than over sources with a grep
(`REQ-703`).

Export also reports **what the export lost**, using the ledger (§3.4). Self-verification proves the
file is well-formed; the ledger tells the user what is not in it. Both are needed.

---

## 7. Validators

`PATTERN.md` `PAT-DEC-08`. Implements `REQ-516`, `REQ-806`, `REQ-115`.

| Rule | |
|---|---|
| Hand-written, format-specific validators | Covering the documented keyword subset the vendored schemas actually use |
| Vendored and inlined at build time | Validation works offline; a schema update is a deliberate act, not something that changes underfoot |
| Cross-checked **in the test suite only** against a reference implementation over a corpus | `PAT-DEC-08` |

`PAT-DEC-08` names the force honestly: "a subtly wrong validator is worse than none because it gives
confident wrong answers", and the cross-check "only proves agreement on the corpus". A thin corpus
ships a divergence. The corpus must therefore include, at minimum, an artifact exported by this app,
a trip-data.json of each generation present in the repo's history, and a hand-written `.ics` with
recurrence, alarms and attendees.

A runtime validator dependency is **not** taken: it would be a second policy origin inside a file whose
whole premise is that it has one.

---

## 8. Present state

| Requirement | Today |
|---|---|
| `REQ-501`, `REQ-502` | `readFileAsJSON` (`app/io.js:249`) is text-read then `JSON.parse` — no DOM parse, which is closer to correct than most. But it targets a JSON interchange file, not the artifact, and there is no artifact to import |
| `REQ-503` | `JSON.parse` into ordinary objects; `clone()` is `JSON.parse(JSON.stringify(…))` (`app/io.js:289`) |
| `REQ-504` | Lossless for `trip-data.json`, via `importedRaw` (`app/io.js:82`) plus per-entity `_src` |
| `REQ-505`–`REQ-508` | `downloadJSON` (`app/io.js:240`) creates a `Blob` and clicks a synthetic `<a download>`. No pristine clone, no self-verification |
| `REQ-509`, `REQ-510` | No fallback path. If the download is suppressed, nothing happens |
| `REQ-511`, `REQ-512` | No ledger. Losses are implicit in the mapper code |
| `REQ-514`, `REQ-515` | No iCalendar support of any kind |
| `REQ-516` | No validators and no schemas |
| `REQ-517`, `REQ-518` | No guards. A large or deeply nested file is parsed until it fails |
| Detection | Content sniffing for JSON only (`app/ui/shell.js:140`); the picker filters on `.json` (`index.html:19`) |
