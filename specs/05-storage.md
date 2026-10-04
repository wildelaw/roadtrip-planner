# 05 — Storage

Implements `REQ-401`–`REQ-413`, `PAT-INV-01`, `PAT-INV-02`, `PAT-INV-12`, `PAT-INV-13`.

---

## 1. The file is the carrier; storage is a cache

The single most important rule in the set. Browser storage for `file://` documents is not standardised
and never was:

| Browser | Behaviour | Consequence |
|---|---|---|
| Chrome, Edge | **All** local files are one origin | Convenient — storage follows the file anywhere — and it means any local page can read it |
| Firefox | **Each file path** is its own origin | Safer, and storage does not follow a file that is moved, renamed, copied, or opened from a different folder |
| Safari | Inconsistent, historically restrictive | Neither behaviour can be assumed |

The consequence is a design rule, not a caveat: **the file carries everything required for
correctness.** Storage is an overlay that makes the common case fast and the multi-model case
possible. Every operation must reach a correct outcome with storage absent, empty, partitioned, or
hostile (`REQ-403`).

> **Test of the rule** (`PATTERN.md` §5.1): delete all local storage and reopen the file. Nothing
> should be lost — only convenience. If anything is lost, the design has slipped.
> That test is `REQ-404`, and it is a manual requirement precisely because it is the one thing a unit
> test cannot prove.

This is what makes the present design's largest failure visible: today, clearing a browser profile is
total data loss, because there is no file carrier at all — every trip lives only in IndexedDB
(`app/db.js`). `PAT-AP-01` in its purest form.

---

## 2. One adapter

`PATTERN.md` §4.2 (seam 4), `PAT-DEC-12`, `ADR-0012`. Implements `REQ-401`, `REQ-402`.

```js
// storage/adapter.js — the whole surface. Nothing else touches a storage API.
interface StorageAdapter {
  get(key)                     // -> value | null
  set(key, value)              // -> void; throws QuotaError
  del(key)                     // -> void
  keys(prefix)                 // -> string[]
  bytesUsed()                  // -> number
  available()                  // -> boolean
}
```

| Implementation | When chosen | Behaviour |
|---|---|---|
| `localStorage` | Default in a normal browsing session | The real store |
| `memory` | `localStorage` throws on access (some `file://` configurations, private windows, blocked site data) | Fully functional for the session; discarded on close. Every operation still reaches a correct outcome |
| `null` | Read-only mode — integrity failure (`REQ-317`) or an unknown newer container `format` (`REQ-212`) | Reads return nothing; writes are refused with an explanation |

**"Storage is unavailable" is a configuration, not a code path** (`PAT-DEC-12`). Three
implementations, chosen once at boot (`02-architecture.md` §6 step 3), mean the "cannot persist" case
is exercised by the same code as the normal case rather than by a branch inside every feature.

`PAT-DEC-12` notes IndexedDB "is blocked on some `file://` origins entirely" — which is the direct
reason this spec replaces IndexedDB rather than keeping it. It is also the reason `localStorage`, with
all its smallness, is the right backend: it is synchronous, which the deterministic boot sequence
needs (`REQ-612`, `02-architecture.md` §6), and its ~5 MB ceiling is a problem this design handles
(§6) rather than one it pretends not to have.

---

## 3. Key layout

Per-key commits, not one blob. This is what makes the write ordering in §5 possible and what keeps a
save from rewriting the entire history.

| Key | Holds |
|---|---|
| `tp.registry` | The index of known documents (§4) |
| `tp.doc.<docId>.meta` | The **pointer**: `{ format, head, lastOpenedAt }`. Written last, removed first |
| `tp.doc.<docId>.c.<commitId>` | One commit record, as its own key |
| `tp.app.settings` | Existing settings, unchanged (`app/settings.js:4`) |
| `tp.app.conv.<conversationId>` | AI conversations (§9) — app-local, never in the container |

One commit per key means appending a commit is a single `set` of a new key. Nothing existing is
rewritten, so an interrupted save cannot corrupt a commit that was already there — it can only leave
a commit that the pointer does not reference, which is an orphan and merely waste (`PAT-INV-13`).

---

## 4. The registry is a convenience, never an authority

`PATTERN.md` `PAT-AP-09`. Implements `REQ-405`, `REQ-406`.

```json
{ "version": 1,
  "docs": [ { "docId": "…", "title": "Kansai, April", "updatedAt": "…", "lastPath": null } ] }
```

| Rule | |
|---|---|
| **Re-seeded from files on every load** | Opening a document writes its registry entry. The registry follows the files; it does not lead them |
| **Deleting an entry never deletes a document** | The entry is an index row. The document is a file the app may no longer be able to see |
| **An empty registry is not data loss** | It means "no documents have been opened here". The sidebar says so in those words |
| **A stale entry is not an error** | A path that no longer resolves is shown as unavailable, not deleted |

`PAT-AP-09`'s symptom is exact: "deleting an entry appears to delete a document; an empty registry
appears to be data loss. Cause: confusing an index with a record." The fix is that **the file wins,
and the registry is re-seeded on every load**.

This is a behavioural change from today's sidebar, where the list *is* the store — deleting a trip
deletes it (`app/store.js:120-127`). `ADR-0016` carries that consequence.

---

## 5. Write ordering

`PATTERN.md` `PAT-INV-13`. Implements `REQ-407`, `REQ-803`.

| Operation | Order |
|---|---|
| **Append a commit** | 1. write each new commit object under its own key → 2. update `tp.doc.<id>.meta` (the pointer). An interruption leaves unreferenced commits — waste, not corruption |
| **Delete a commit or a document** | 1. update or remove the pointer → 2. remove the commit objects. An interruption leaves unreferenced commits again |

> **The pointer is written last and removed first.** An interrupted write leaves a dangling head —
> corruption — instead of orphans, which are merely waste.

The inverse ordering is the natural one to write and it is wrong in a way that is hard to see: if the
pointer lands first and the commit does not, every subsequent boot fails chain verification and
`REQ-317` puts the document into read-only mode because of a save that was cancelled.

Fault injection at **every** step of both orderings is `REQ-803`; the assertions are that the document
still opens, that chain verification passes, and that nothing reported as written is missing.

---

## 6. Quota

`PATTERN.md` §10 ("storage is a hard ceiling"), `PAT-INV-05`. Implements `REQ-408`.

`localStorage` is ~5 MB in the reference implementation and in most browsers here. The response to
approaching it is **disclosure and compaction**, never eviction:

| Situation | Response |
|---|---|
| `QuotaError` on write | The write fails **visibly**, naming the operation. The in-memory working copy is untouched, so nothing is lost from the session |
| Usage high | A Settings line reports bytes used per document (`bytesUsed()` on the adapter) |
| User wants room | Compaction (`04-versioning.md` §9.1) — user-initiated, preceded by a report of what it will remove, and it never changes a commit id |
| Still no room | The user is told, and offered export. **No commit is ever dropped to make space** |

**A full disk that says so is better than a quiet one that deletes** (`PAT-AP-11`). The failure this
prevents is specific and severe: an eviction policy that quietly drops old commits loses a month of
work with no notification, and the history may have been the only copy.

---

## 7. Concurrency

`PATTERN.md` §11 P-7 (cross-instance coordination is explicitly unresolved). Implements `REQ-409`.

Two tabs, two windows, one store. This spec takes the reference implementation's position: **detect
and refuse**, rather than coordinate.

| Mechanism | |
|---|---|
| `tp.doc.<docId>.meta.writer` | `{ instanceId, at }`, refreshed on write |
| On write | If the writer field names a different instance and is recent, refuse with an explanation and offer to reload |

Refusing is the conservative choice because the alternative is silent last-writer-wins — which is
`PAT-AP-02`'s failure (one person's work vanishes) arriving through a different door. Whether to
*coordinate* instead of refuse is open (`10-open-questions.md` Q-8).

---

## 8. Migration from IndexedDB

Implements `REQ-411`, `PAT-INV-05`.

The app has existing users with trips in IndexedDB (`trip-planner` / `trips`, `app/db.js:4-28`). The
migration is one-time and explicit.

```
migrate():
  1. if !idbAvailable()  -> stop, explain, do not touch anything
  2. read the existing 'trips' store
  3. for each trip:
       - mint a docId
       - build a root commit from the trip, normalised into the canonical model
       - write commits, then the pointer
       - register the document
  4. report: "N trips imported. Each is now its own document."
  5. DO NOT delete the IndexedDB data
```

| Rule | Why |
|---|---|
| **Served mode only** | IndexedDB is blocked on some `file://` origins (`PAT-DEC-12`). Under `file://` the migration stops and says so, rather than appearing to have nothing to migrate |
| **The original data is not deleted** | `PAT-INV-05`. A migration that fails halfway must leave the source intact. The user deletes it themselves, later, deliberately |
| Failure is explained, never blank | `PATTERN.md` §5.9: "never a blank page" |

Step 1 is the one that matters for the `file://` boundary. `idbAvailable()` exists today
(`app/db.js:63-64`) and is used only for a sidebar status line (`app/main.js:15`). Here it gates a
migration, and the failure it prevents is a user concluding their trips were lost when the browser
simply could not reach the database.

---

## 9. AI conversations are app-local

Implements `REQ-410`.

Conversations are stored today alongside trips, in IndexedDB (`app/db.js:19-21`, written by
`agent.js:66`, read by `ai-panel.js:52`). They move to `tp.app.conv.<id>` behind the same adapter, and
they **never enter the container**:

| Reason | |
|---|---|
| They are per-user state | `PATTERN.md` §5.2: the container "deliberately omits … per-user preferences. Those are not properties of a portable document" |
| They are unreachable in the portable form anyway | The AI subsystem does not run under `file://` at all (`ADR-0015`), so a conversation cannot exist in a document that is only ever a file |
| They are the largest and least valuable payload | Transcripts of web searches would inflate every exported file against the size budget in §10 |

Two independent reasons reach the same conclusion, which is a good sign the conclusion is right. The
storage key prefix `tp.app.` distinguishes app-local state from document state (`tp.doc.`) at a glance,
so a future contributor cannot easily put the wrong thing in the container.

**Deleting conversations.** The AI panel's clear-chat action (`REQ-413`) removes every
`tp.app.conv.<id>` whose `tripId` is the current document, and no other document's — the same scope
`listConversations` applies, and `deleteConversations` refuses a falsy `tripId` outright so a missing
document id cannot become a browser-wide wipe. It empties the on-screen transcript at the same time,
and it is confirmed first, because the screen is not the only copy and the deletion cannot be undone
from the app. With storage absent or read-only the transcript still clears and nothing is reported as
deleted: an empty result is a correct outcome, not an error (`PAT-INV-02`).

---

## 10. Present state

| Requirement | Today |
|---|---|
| `REQ-401` | No adapter. `app/store.js` and `app/db.js` call IndexedDB directly; `app/settings.js:38,47` calls `localStorage` directly |
| `REQ-402` | IndexedDB only. No memory adapter, no null adapter. `idbAvailable()` (`app/db.js:63`) detects absence and the app then simply refuses to persist, with a banner (`app/main.js:15-17`) |
| `REQ-403` | An unavailable store is a degraded mode with a warning, not a supported configuration |
| `REQ-404` | **Fails outright.** Clearing storage is total data loss |
| `REQ-405`, `REQ-406` | No registry. The trip list (`app/ui/trip-list.js`) reads IndexedDB directly and *is* the store |
| `REQ-407` | No write ordering exists to get wrong — writes are single-object `put`s (`app/db.js:50-52`) |
| `REQ-408` | No quota accounting. IndexedDB's larger ceiling means the problem has not arrived yet; moving to `localStorage` is what makes it real |
| `REQ-409` | No concurrency detection |
| `REQ-410` | Conversations live beside trips in IndexedDB and are part of the same `wipeAll()` (`app/store.js:318-324`) |
| `REQ-411` | No migration, because there is nothing to migrate to |
