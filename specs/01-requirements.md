# 01 — Requirements

**This document is the source of truth.** Every other spec in this directory is downstream of it.
`REQ-*` ids are minted here and nowhere else — they are a property of this instance, not of the
pattern (`PATTERN.md` §"Identifier scheme").

Each requirement carries a **source** (the `PAT-*` id or `PATTERN.md` section it derives from) and a
**verification** method. That pairing is what makes `PAT-AP-08` ("a lossy import with no ledger")
mechanically checkable rather than a matter of opinion, and it is the table the traceability check
in `09-testing.md` parses.

Verification codes:

| Code | Method |
|---|---|
| `static` | Static check over the **built artifact** (not the sources) |
| `property` | Property test over generated inputs |
| `fault` | Fault injection at an interrupted-write boundary |
| `unit` | Unit test over pure logic |
| `matrix` | Executed browser × protocol matrix; findings recorded either way |
| `ledger` | Mechanical completeness check of the lossiness ledger against vendored schemas |
| `trace` | The traceability check |
| `manual` | A written end-to-end procedure a human runs |
| `review` | Judgement, recorded in the spec — no automated check exists |

---

## 1. Artifact and build — `REQ-1xx`

The file, its order, and how it is produced. `PATTERN.md` §4.1, §5.11.

| id | Requirement | Source | Verification |
|---|---|---|---|
| `REQ-101` | The application ships as **one HTML file** carrying payload, history, and application code together. | `PAT-INV-01`, §2 | `manual` |
| `REQ-102` | That file runs correctly when opened from `file://`, with no server, no install, and no network. | `PAT-INV-01`, §5.1 | `matrix` |
| `REQ-103` | The application script is **classic** — inline, one `<script>` element, no `type="module"` and no local `src`. | §4.1 rule C, `PAT-DEC-10` | `static` |
| `REQ-104` | The embedded data block is `<script type="application/json" id="app-data">` — inert, never executable. | §4.1 rule B | `static` |
| `REQ-105` | The CSP meta tag precedes every script it governs. | §4.1 rule A | `static` |
| `REQ-106` | No inline `on*=` handlers, no `eval`, no `new Function`, no dynamically created `<script>`. | §4.1 rule E | `static` |
| `REQ-107` | The build is zero-dependency and runs from a clean checkout: `node build.js`. No bundler, no install step. | §5.11 | `manual` |
| `REQ-108` | The build concatenates authored fragments in **one declared order**, and that same list feeds the test harness — so build and tests cannot drift. | §5.11 | `unit` |
| `REQ-109` | The build fails loudly on any unresolved `{{TOKEN}}` placeholder. | §5.11 | `unit` |
| `REQ-110` | Application code is **byte-identical** in every export. Only the data block differs. | `PAT-INV-08` | `property` |
| `REQ-111` | The app hash is computed over the **final** bytes and declared in `<meta name="app-hash">`. | §4.1, §5.11 | `static` |
| `REQ-112` | The policy hash is computed over the final script bytes, after any minification. | §5.11 | `static` |
| `REQ-113` | CSS is inlined into a single `<style>` element. There is no external stylesheet reference. | `PAT-DEC-02` ("choose differently when offline is a hard requirement"), `ADR-0002` | `static` |
| `REQ-114` | Shell markup is **static**; all dynamic content renders into one named region per panel. | §4.1 rule D | `review` |
| `REQ-115` | External schemas are vendored at build time and inlined, so validation works offline and a schema update is a deliberate act. | §5.11 | `manual` |

## 2. Canonical model and container — `REQ-2xx`

`PATTERN.md` §5.2, §5.3. The full model is in `03-data-model.md`.

| id | Requirement | Source | Verification |
|---|---|---|---|
| `REQ-201` | The payload is exactly **one trip**. | §8.3, `ADR-0016` | `review` |
| `REQ-202` | The canonical model is the **union** of what `trip-data.json` and iCalendar can express — never their intersection. | `PAT-INV-11`, `PAT-DEC-07` | `ledger` |
| `REQ-203` | Canonical requires almost nothing: an id and a name. Format-specific required fields are satisfied by synthesis at export, and every synthesized value is disclosed. | §5.3 | `review` |
| `REQ-204` | Entity identity is stable and format-independent. An entity's internal id never changes because of an export; format-specific identifiers are derived deterministically. | §5.3 | `unit` |
| `REQ-205` | Every field the canonical model does not represent is preserved verbatim in a per-format **passthrough bag** (`x.tripDataJson`, `x.iCal`), keyed by source format. | `PAT-INV-10`, §5.3 | `property` |
| `REQ-206` | An empty passthrough bag is **omitted**, never emitted as `{}`. | §5.3 | `unit` |
| `REQ-207` | Passthrough bags are opaque to the UI: shown, attributed, preserved — never interpreted. | §5.3 | `review` |
| `REQ-208` | Structure follows the model, not the wire: where a format nests what is conceptually flat (or the reverse), the **mapper** does the nesting. | §5.3 | `review` |
| `REQ-209` | The container has a versioned envelope: `$schema`, `format`, `payload`, `history`, `build`. | §5.2 | `unit` |
| `REQ-210` | `payload` holds the canonical model **at the head commit** — never the working copy. | §5.2 | `unit` |
| `REQ-211` | The container deliberately omits the working copy, storage bookkeeping, and per-user preferences. | §5.2 | `review` |
| `REQ-212` | A container `format` newer than the app is opened **read-only, with an explanation**. The app never guesses at a format's semantics. | §5.2 | `unit` |
| `REQ-213` | `build.generatedAt` is informational and is **never** used to decide precedence. | §5.2, `PAT-INV-03` | `unit` |

## 3. History and versioning — `REQ-3xx`

`PATTERN.md` §5.4–§5.6, §5.10. The full design is in `04-versioning.md`.

| id | Requirement | Source | Verification |
|---|---|---|---|
| `REQ-301` | `payloadHash = H(canonicalSerialize(payload))`; `commitHash = H(canonicalSerialize({ parents: sorted, docId, author, timestamp, message, payloadHash }))`. | §5.4 | `unit` |
| `REQ-302` | Hashing inputs cover the **semantic payload only**. `snapshot` and `delta` are not inputs, and no storage representation is hashed. | `PAT-INV-07`, `PAT-AP-06` | `property` |
| `REQ-303` | Because `parents` is an input, a commit's id transitively covers its **entire ancestry**. Tampering is detectable, not merely visible. | §5.4 | `property` |
| `REQ-304` | History is a directed acyclic graph, not a list; a merge commit has two parents. | §5.4 | `unit` |
| `REQ-305` | Canonical serialization is specified: sorted keys, no insignificant whitespace, defined number and string normalization. | §5.11 | `property` |
| `REQ-306` | Canonical serialization has **one implementation**, shared by application and tests. | §5.11 | `review` |
| `REQ-307` | SHA-256 is synchronous, pure JavaScript, verified against published NIST vectors on every build. | `PAT-DEC-04`, `ADR-0004` | `unit` |
| `REQ-308` | A commit is stored as **exactly one** of a full snapshot or a patch against its parent. | §5.5 | `property` |
| `REQ-309` | A commit **must** be a keyframe when it is a root, has more than one parent, its patch would be larger than its snapshot, or the count since the last keyframe reaches `keyframeInterval`. | §5.5 | `unit` |
| `REQ-310` | `keyframeInterval` defaults to 20. | §5.5 | `unit` |
| `REQ-311` | Reconstruction replays from the **nearest preceding keyframe**, so cost is bounded by the interval, not by history length. | §5.5 | `property` |
| `REQ-312` | Ordering is by **ancestry**. Timestamps are displayed and never decisive. | `PAT-INV-03`, `PAT-DEC-05`, `PAT-AP-02` | `property` |
| `REQ-313` | Fast-forward is silent and safe. **Divergence stops and asks**; nothing is auto-merged. | `PAT-INV-04`, `PAT-DEC-06`, `PAT-AP-03` | `property` |
| `REQ-314` | A revert creates a new **forward commit**. Commit ids are never rewritten. | `PAT-INV-06`, `PAT-AP-05` | `unit` |
| `REQ-315` | Operation-level undo/redo is bounded by the commit boundary, and is a separate mechanism from revert. | `PAT-DEC-13` | `review` |
| `REQ-316` | Chain verification (stored fields hash to declared ids; every parent id exists) runs **at boot**. Payload verification runs at the head and on any commit the user inspects. | §5.4 | `unit` |
| `REQ-317` | An integrity failure enters **read-only mode**, names the offending commit, and never writes. A corrupted history is never silently repaired. | §5.4 | `fault` |
| `REQ-318` | No code path deletes commits without explicit, informed user confirmation — not on quota pressure, not on corruption, not on migration failure, not on "obviously unreachable" data. | `PAT-INV-05`, `PAT-AP-11` | `review` |
| `REQ-319` | Compaction is user-initiated, is preceded by a report of what it will remove, and cannot desynchronise a compacted copy from an uncompacted one. | §5.5, `PAT-INV-07` | `property` |
| `REQ-320` | The UI says **"chain intact"** and never **"verified"**. Author identity is disclosed as self-asserted. | §5.10, `PAT-DEC-09`, `ADR-0009` | `review` |
| `REQ-321` | Author name and email are carried in the history and disclosed in the UI as a permanence obligation. | §10 | `review` |

## 4. Storage — `REQ-4xx`

`PATTERN.md` §5.1, `PAT-DEC-12`. Full design in `05-storage.md`.

| id | Requirement | Source | Verification |
|---|---|---|---|
| `REQ-401` | All persistence goes through **one storage adapter**. No feature module touches a storage API directly. | `PAT-INV-12` | `static` |
| `REQ-402` | Adapters exist for `localStorage`, in-memory, and **null** (read-only), so "storage is unavailable" is a configuration rather than a code path. | `PAT-DEC-12` | `unit` |
| `REQ-403` | Every operation reaches a correct outcome with storage absent, empty, partitioned, or throwing. | `PAT-INV-02` | `fault` |
| `REQ-404` | Delete all local storage and reopen the file: nothing is lost, only convenience. | `PAT-INV-02` (§5.1 "test of the rule") | `manual` |
| `REQ-405` | The registry is **re-seeded from files on every load**. | `PAT-AP-09` | `unit` |
| `REQ-406` | Deleting a registry entry never deletes a document; an empty registry is not data loss. | `PAT-AP-09` | `unit` |
| `REQ-407` | The pointer is **written last and removed first**, so an interrupted write leaves orphans rather than a dangling head. | `PAT-INV-13` | `fault` |
| `REQ-408` | Quota exhaustion is met with disclosure and compaction, never eviction. | `PAT-INV-05`, `PAT-AP-11` | `fault` |
| `REQ-409` | Two instances writing one store is detected and refused rather than reconciled silently. | §11 P-7 | `review` |
| `REQ-410` | AI conversations are **app-local and excluded from the container**. Per-user state is not a property of a portable document. | §5.2 | `review` |
| `REQ-411` | A one-time migration imports existing IndexedDB trips as documents, **in served mode only**, and fails with an explanation rather than a blank page when IndexedDB is unreachable. | `PAT-INV-02`, `PAT-INV-05` | `manual` |
| `REQ-412` | The cloud API key is never persisted when running from `file://`, because the AI subsystem is unavailable there. | §5.9, `ADR-0015` | `unit` |

## 5. Interchange — `REQ-5xx`

`PATTERN.md` §5.7–§5.9. Full design and the ledger are in `06-interchange.md`.

| id | Requirement | Source | Verification |
|---|---|---|---|
| `REQ-501` | Import reads the file as **text**. The document is never inserted into the DOM, never parsed as markup, never executed. | `PAT-INV-09` (§5.9 layer 1), `PAT-AP-07` | `review` |
| `REQ-502` | The data block is located by **string scanning**, never by a DOM parser. | `PAT-INV-09` | `unit` |
| `REQ-503` | Untrusted JSON is reconstructed into null-prototype objects or by explicit field copying. `JSON.parse` output is never deep-merged. | §5.9 | `property` |
| `REQ-504` | Import is **lossless**: nothing the canonical model does not represent is dropped. | `PAT-INV-10` | `property` |
| `REQ-505` | Export is built from the **pristine DOM clone**, not from the live DOM. | §5.7 | `unit` |
| `REQ-506` | The pristine DOM is captured as the application's **first statement**, before any mutation, any theme class, any rendering. | `PAT-INV-14` | `unit` |
| `REQ-507` | Export writes payload and history into the clone's data block and serializes the document. | §5.7 | `unit` |
| `REQ-508` | Export **verifies itself** before offering a download: re-parse the assembled document; assert the data block re-parses; assert the container equals the one passed in; assert the script text is byte-identical; assert the declared app hash matches. | §5.7, `PAT-INV-08` | `property` |
| `REQ-509` | The text + copy fallback is reachable **deliberately**, not only on failure. | §5.7 | `review` |
| `REQ-510` | Under `file://` — where some configurations suppress downloads — the text/copy fallback is preferred over the download path. | §5.7 | `matrix` |
| `REQ-511` | A **lossiness ledger** classifies every interchange field, in both directions, as mapped, folded, or dropped. | `PAT-INV-10`, `PAT-AP-08` | `ledger` |
| `REQ-512` | The ledger is written **before** the mappers. | §8.1 step 3 | `review` |
| `REQ-513` | `trip-data.json` round-trips unedited imports without loss. | §5.7, present behaviour in `app/io.js` | `property` |
| `REQ-514` | iCalendar export emits `VEVENT`s for itinerary entries; day notes fold into `DESCRIPTION`. | `ADR-0014` | `unit` |
| `REQ-515` | iCalendar import preserves unmodelled properties (`VALARM`, `RRULE`, `ATTENDEE`, …) in the `x.iCal` bag. | `PAT-INV-10` | `property` |
| `REQ-516` | Imported documents are validated by hand-written format validators covering the documented keyword subset the vendored schemas actually use. | `PAT-DEC-08` | `unit` |
| `REQ-517` | Resource guards bound container size, commit count, patch operation count, nesting depth, and embedded source length. | §5.9 | `unit` |
| `REQ-518` | Every guard failure **explains itself** and offers to export what was readable — never a blank page. | §5.9 | `unit` |
| `REQ-519` | Where a download is unavailable, the fallback presents the full document text with a copy action. | §5.7 | `review` |

## 6. UI and environment — `REQ-6xx`

The `file://` boundary, styling preservation, and boot. Full design in `07-ui.md`.

| id | Requirement | Source | Verification |
|---|---|---|---|
| `REQ-601` | `location.protocol` is read in **exactly one module** (`environment`). No other module may read `location`. | `PAT-INV-12` applied to the platform | `static` |
| `REQ-602` | `aiEnabled` is true when the document is served over `http(s)` and false under `file://`. | `ADR-0015` | `unit` |
| `REQ-603` | Under `file://` the **AI Planner tab is hidden**. | `ADR-0015` | `matrix` |
| `REQ-604` | Under `file://` the Settings **Ollama connection card, Test connection, and CORS proxy are hidden**. | `ADR-0015` | `matrix` |
| `REQ-605` | Under `file://` Settings **explains** that AI planning requires a served origin. The absence is stated, never silent. | §5.8 | `review` |
| `REQ-606` | Serving the *same* code over `http(s)` enables the AI subsystem with no other change. | `ADR-0015` | `matrix` |
| `REQ-607` | Save-in-place via the File System Access API is offered **only in served mode**. | §5.7 | `matrix` |
| `REQ-608` | Every non-AI feature works fully under `file://`: all seven trip tabs, history, import, and export. | `PAT-INV-01`, `REQ-102` | `matrix` |
| `REQ-609` | Tab visibility uses the existing `activeTabs()` filter (`app/ui/shell.js:77`); in-panel visibility uses the existing display toggle (`app/ui/settings-view.js:121`). Gating introduces no new mechanism. | `PAT-DEC-11` | `review` |
| `REQ-610` | `styles/main.css` remains the authored stylesheet, unchanged in content, and is inlined at build. | `ADR-0002` | `review` |
| `REQ-611` | New UI reuses existing class families (`card`, `btn`, `info`, `badge`, `muted`, `subtle`, `empty`, `flex gap`). A genuinely new class is appended in the file's existing section-comment style. | `ADR-0002` | `review` |
| `REQ-612` | Boot order is container → integrity → storage → reconcile → interactive. The UI is not interactive before reconcile completes. | `PAT-INV-14` | `unit` |
| `REQ-613` | Views attach listeners by delegation on a stable container, or by query-and-rebind after render — matching the two conventions already in `app/ui/`. | `PAT-DEC-11` | `review` |
| `REQ-614` | One trip per document: **New Trip** creates a new document; the sidebar is the **registry**, and opening a document is opening a file. | §8.3, `ADR-0016` | `review` |
| `REQ-615` | The reconciliation flow explains a partitioned store: "no local history" and "your browser gives every file its own storage" are distinguished in the UI, naming the browser behaviour. | §5.8 | `review` |
| `REQ-616` | Importing `trip-data.json` or `.ics` creates a **new document** by default; replacing the current document's payload is a separate, explicitly confirmed commit. | `PAT-INV-05`, `ADR-0016` | `review` |

## 7. Security — `REQ-7xx`

`PATTERN.md` §5.9. Full posture in `08-security.md`.

| id | Requirement | Source | Verification |
|---|---|---|---|
| `REQ-701` | Every payload-derived string enters the DOM as **text** (`textContent` / `createTextNode`), never as markup. | `PAT-INV-09` | `property` |
| `REQ-702` | `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `document.write` do not appear in the built artifact. | `PAT-INV-09` | `static` |
| `REQ-703` | That check runs over the **built artifact**, not over the sources — the failure mode is one missed field. | `PAT-INV-09` | `static` |
| `REQ-704` | URL-valued fields are validated against a scheme allowlist; `javascript:`, `data:`, `vbscript:` are rejected. | §5.9 | `unit` |
| `REQ-705` | Patch application validates `op`, `path` bounds, and rejects `__proto__`/`constructor`/`prototype` path segments. | §5.9 | `property` |
| `REQ-706` | No deep merge is ever performed over untrusted JSON. | §5.9 | `review` |
| `REQ-707` | Code-carrying content types (SVG, diagram languages) are sanitized, sandboxed, or shown as source text. | §5.9 | `review` |
| `REQ-708` | The AI subsystem performs **no network egress from `file://`**, because it is unavailable there. | §5.9, `ADR-0015` | `matrix` |
| `REQ-709` | The threat model states plainly that an exported document is an **executable HTML file**, and that opening one means running its code. | §5.9, `PAT-AP-10` | `review` |
| `REQ-710` | It states that a hostile file writes its own policy, so **import-don't-open is the primary mitigation** and the CSP is secondary. | §5.9 | `review` |
| `REQ-711` | Residual risks are enumerated: a hostile document can read every other document in the origin; authorship is forgeable; platform assumptions are unverified. | §10 | `review` |
| `REQ-712` | Author names and emails live in every commit forever, and this is described as a disclosure obligation rather than a footnote. | §10 | `review` |

## 8. Testing and traceability — `REQ-8xx`

`PATTERN.md` §5.11, §8.1 step 11. Full suite in `09-testing.md`.

| id | Requirement | Source | Verification |
|---|---|---|---|
| `REQ-801` | A traceability check parses this document and asserts every `REQ-*` is cited by at least one spec, and every `PAT-*` cited anywhere in `specs/` exists in `PATTERN.md`. | §12 | `trace` |
| `REQ-802` | Property tests cover canonical serialization (round-trip) and payload reconstruction (snapshot/patch equivalence). | §8.1 step 11 | `property` |
| `REQ-803` | Fault injection covers an interrupted write at every step of the write ordering. | `PAT-INV-13` | `fault` |
| `REQ-804` | A browser × protocol matrix is executed, and its findings recorded whether or not they are convenient. | §10, §11 | `matrix` |
| `REQ-805` | A parameterised escaping test runs over **every** field of the canonical model. | §8.1 step 10 | `property` |
| `REQ-806` | A validator cross-check runs against a reference implementation over a corpus, **in the test suite only**. | `PAT-DEC-08` | `unit` |
| `REQ-807` | Test tooling and development dependencies never enter the artifact. | §5.11 | `static` |
| `REQ-808` | The declared fragment order feeds the build and the harness from one source. | §5.11, `REQ-108` | `unit` |
| `REQ-809` | The lossiness ledger is checked mechanically for completeness against the vendored schemas. | `PAT-AP-08` | `ledger` |
| `REQ-810` | The mock transport exercises the full agent loop with no network and no spend. | present behaviour, `test/mock-scenarios.js` | `unit` |

---

## Traceability

Requirements to pattern sources, grouped. The reverse mapping (every `PAT-INV`/`PAT-DEC` reaches at
least one requirement) is asserted by `REQ-801` and summarised in `00-overview.md` §"Conformance
summary".

| Group | Primary `PAT-INV` | Primary `PAT-DEC` | `PAT-AP` guarded against |
|---|---|---|---|
| `REQ-1xx` | 01, 08 | 02, 10 | — |
| `REQ-2xx` | 10, 11 | 07, 08 | 08 |
| `REQ-3xx` | 03, 04, 05, 06, 07, 13 | 03, 04, 05, 06, 09, 13 | 02, 03, 05, 06, 11 |
| `REQ-4xx` | 01, 02, 05, 12 | 01, 12 | 01, 09, 11 |
| `REQ-5xx` | 08, 09, 10, 14 | 08, 14 | 07, 08 |
| `REQ-6xx` | 01, 14 | 11 | — |
| `REQ-7xx` | 09 | — | 07, 10 |
| `REQ-8xx` | — | 08 | 08 |

### Present-state gaps, measured

Each row names something that is true today and false under this spec. They are the work.

| Requirement | Present state |
|---|---|
| `REQ-102`, `REQ-103` | `index.html:73` loads `app/main.js` as `type="module"`. The app cannot start from `file://`; `index.html:64-71` ships a watchdog whose only job is to say so. |
| `REQ-101`, `REQ-209` | No artifact and no container exist. Trips live only in IndexedDB (`app/db.js:12-28`). |
| `REQ-3xx` (all) | No hashing, no DAG, no diffs, no commits anywhere in `app/`. |
| `REQ-401`, `REQ-402` | Persistence is IndexedDB only, called directly from `app/store.js` and `app/db.js`. No adapter, no memory or null implementation. |
| `REQ-404` | Clearing the browser profile is total data loss. This is the current design's largest failure. |
| `REQ-501`–`REQ-503` | `readFileAsJSON` (`app/io.js:249`) is text-read then `JSON.parse` into an ordinary object. No size or depth guards; no null-prototype reconstruction. |
| `REQ-505`–`REQ-508` | Export is `downloadJSON` (`app/io.js:240`) writing a `trip-data.json` of one section tree. There is no self-verification and no artifact to clone from. |
| `REQ-511`, `REQ-512` | No ledger. `importedRaw` (`app/io.js:82`) is an ad-hoc passthrough with no classification of loss. |
| `REQ-514`, `REQ-515` | No iCalendar mapper. |
| `REQ-601`–`REQ-608` | No protocol check exists anywhere. The AI planner is unconditionally present in the tab bar (`index.html:41`). |
| `REQ-701`–`REQ-703` | ~40 `innerHTML` sites across `app/ui/`, guarded by `escapeHTML` (`app/utils/format.js:3`) rather than avoided. `renderMarkdown` (`:35`) returns an HTML string. |
| `REQ-614`, `REQ-616` | The sidebar is a list of trips in IndexedDB; "Export all trips" (`app/store.js:312`) emits a JSON array. |
| `REQ-801`–`REQ-810` | The only test artifact is `test/mock-scenarios.js`, explicitly not auto-run. No runner, no CI, no property tests. |

---

## Phased build order

Steps 1–4 of `PATTERN.md` §8.1 are design and are already done — they are these specs. The phases
below are steps 5–11 in an order where each phase is independently verifiable. Phase 0 is a
prerequisite for everything else and is the largest single workstream.

| Phase | Work | Requirements | Done when |
|---|---|---|---|
| **0** | **Render seam.** Replace every `innerHTML` site in `app/ui/` with element construction; convert `renderMarkdown` to build nodes. Pure refactor, no behaviour change. | `REQ-701`–`REQ-703`, `REQ-611` | The UI is visually and behaviourally identical, and a static grep over the sources finds no `innerHTML`. |
| **1** | **Fragment build.** Drop ES-module syntax; attach fragments to one namespace; write `build.js`; emit `dist/trip-planner.html` with CSS and JS inlined and a classic script. | `REQ-103`, `REQ-107`–`REQ-113` | The artifact opens from `file://` and the existing app runs — still storage-only, still no history. |
| **2** | **Canonical model.** Define the trip model as the superset; add passthrough bags; define the container envelope and canonical serialization. | `REQ-201`–`REQ-209`, `REQ-305`, `REQ-306` | Serialization is round-trip stable under a property test. |
| **3** | **History core.** SHA-256, commit records, DAG, ancestry, keyframes, patch application, merge base. Pure logic, no DOM. | `REQ-301`–`REQ-311`, `REQ-316` | Generated histories reconstruct to identical payloads; a tampered commit is detected. |
| **4** | **Storage adapter.** One interface, three implementations, write ordering, registry, quota. | `REQ-401`–`REQ-409` | Delete all storage, reopen the file, lose nothing. |
| **5** | **Edit path.** Commit, revert, discard, undo/redo bounded by the commit boundary; a history view. | `REQ-314`, `REQ-315`, `REQ-318`, `REQ-319`, `REQ-320` | Edits produce commits; revert is a forward commit; the UI says "chain intact". |
| **6** | **Import and export.** Text-only import; pristine-DOM capture; self-verified export; the text fallback. | `REQ-505`–`REQ-510`, `REQ-501`–`REQ-504`, `REQ-519` | An exported file reopens with its history intact and its app byte-identical. |
| **7** | **Reconciliation.** Compare on open; silent fast-forward; blocking divergence. | `REQ-312`, `REQ-313`, `REQ-615` | Two copies of one file, edited apart, reconcile without loss and stop when they truly diverge. |
| **8** | **Interchange.** The ledger first, then the `trip-data.json` and iCalendar mappers. | `REQ-511`–`REQ-518` | The ledger is complete against the vendored schemas; round-trip tests pass. |
| **9** | **Environment gating.** The `environment` module; hide AI under `file://`; the explanatory callout; served-mode save-in-place. | `REQ-601`–`REQ-609`, `REQ-412` | The same artifact opened two ways behaves correctly in both. |
| **10** | **Migration and hardening.** IndexedDB trip migration; resource guards; the security pass; the browser × protocol matrix. | `REQ-411`, `REQ-517`, `REQ-709`–`REQ-712`, `REQ-804` | Existing trips become documents; the matrix is recorded. |
| **11** | **Test suite.** Property tests, fault injection, escaping sweep, traceability check, ledger check. | `REQ-801`–`REQ-810` | `REQ-801` passes. |

Phase 0 and Phase 1 are independently shippable and change no behaviour a user can see. Phase 6 is
the first phase that delivers the pattern's actual value.
