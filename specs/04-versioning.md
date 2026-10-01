# 04 — Versioning

Canonical serialization, hashing, the commit DAG, keyframes, ordering, reconciliation, and the
honest labels. This is the part with the least room for error — `PATTERN.md` §8.1 calls it "the part
with the least room for error" and describes it as pure logic, testable without a DOM or a browser.

Implements `REQ-301`–`REQ-321`.

---

## 1. History is a DAG

Not a list. It must be a DAG because reconciliation creates commits with two parents, and because
nothing is ever discarded.

```
            ┌── C4 ── C5 ──┐
C1 ── C2 ── C3              M      ← M has parents C5 and C7
            └── C6 ── C7 ──┘
```

A merge is the **only** operation that produces more than one parent, and it is only ever created by
an explicit user action during reconciliation (§7). Nothing creates one automatically.

---

## 2. Canonical serialization

`PATTERN.md` §8.1 step 5. Implements `REQ-305`, `REQ-306`.

| Rule | |
|---|---|
| Object keys sorted | Lexicographic by code unit, at every depth |
| No insignificant whitespace | No spaces, no newlines, no trailing commas |
| Numbers normalized | Finite numbers only; `-0` → `0`; no exponent form for values whose decimal form is shorter; integers emitted without a decimal point |
| Strings normalized | As-is (no Unicode normalization — normalizing would change a user's text, and two implementations that disagree about NFC would desynchronise every copy) |
| `undefined` values omitted; `null` preserved | The distinction is meaningful in this model (a cleared field versus an absent one) |
| Arrays keep order | Order is content in this model: day order, item order within a day, checklist order |
| Passthrough bags included | They are part of the payload, so they are part of what the hash covers |

**One implementation.** Two implementations that "should" agree are two that will eventually
disagree, and the failure presents as every commit in every circulated file failing to verify — a
bug that looks like corruption. The same fragment is loaded by the app and by the tests
(`REQ-306`, `REQ-108`).

---

## 3. Commit ids

`PATTERN.md` §5.4. Implements `REQ-301`–`REQ-303`.

```
payloadHash = H( canonicalSerialize(payload) )
commitHash  = H( canonicalSerialize({
                parents:     sorted(commit.parents),
                docId, author, timestamp, message,
                payloadHash
              }) )
```

| Property | Why it is the design |
|---|---|
| `parents` is an input | A commit's id transitively covers its **entire ancestry**. Changing any historical commit changes the id of every commit after it. That is what makes tampering **detectable** rather than merely visible |
| `parents` is **sorted** | Two copies of the same merge, reached by different routes, hash identically |
| `payloadHash`, not the payload | The id is stable across a re-serialization of the payload itself |
| **`snapshot` and `delta` are not inputs** | The hash covers the *semantic payload*, never the storage representation. This single choice makes compaction, re-keyframing and representation changes free — they cannot desynchronise two copies of the same history, because the ids do not depend on how the history is stored (`REQ-302`, `PAT-INV-07`, `PAT-AP-06`) |
| `timestamp` **is** an input | It is part of the record. It is also excluded from every *decision* (§6) — being hashed and being decisive are different things |
| `author` **is** an input | Changing an author name changes every subsequent id. It does not make authorship verifiable (§11) |

### 3.1 SHA-256, synchronous and pure

`PATTERN.md` `PAT-DEC-04`, `ADR-0004`. Implements `REQ-307`.

A pure-JavaScript synchronous SHA-256, **verified against published NIST vectors on every build**.
The reason is the shape of the call sites, not a preference:

| Need | Why `crypto.subtle` does not serve |
|---|---|
| Hashing at boot, inside the deterministic boot sequence | It is asynchronous; the boot sequence would gain an await point in the middle of integrity verification |
| Hashing in the test suite | It is only present in secure contexts; a Node-based test would need a shim, and the shim would be the thing under test |
| Hashing during reconciliation, per comparison | Each await is a point where the UI could paint before reconcile completes (`REQ-612`) |

Hand-written cryptographic primitives are a classic bug source. The mitigation is the vector test,
and the fact that the only property required — collision resistance for content addressing — is
provided regardless of implementation language.

---

## 4. Deltas and keyframes

`PATTERN.md` §5.5, `PAT-DEC-03`. Implements `REQ-308`–`REQ-311`, `ADR-0003`.

A commit is stored as **either** a full snapshot **or** a patch against its parent. Exactly one.

| Approach | Fails because |
|---|---|
| Snapshots only | A 100–500 KB payload over a hundred commits is tens of MB, against a ~5 MB storage budget |
| Deltas only | Reconstruction replays from the root — O(N) per access — and one corrupted patch destroys everything after it |
| **Both** | Reconstruction replays from the nearest preceding keyframe, so cost is bounded by the interval, not by the history length |

### 4.1 Patch format

```json
[
  { "op": "replace", "path": ["days", 2, "items", 0, "title"], "value": "Ferry to Miyajima" },
  { "op": "add",     "path": ["days", 2, "items", 1], "value": { } },
  { "op": "remove",  "path": ["expenses", 4] }
]
```

`path` is an **array of segments**, not a JSON Pointer string. Two reasons, both about validation:
array segments make bounds checking direct, and rejecting a `__proto__` / `constructor` / `prototype`
segment is a comparison rather than a string-parse of an escaped pointer (`REQ-705`).

### 4.2 The four keyframe rules

Implements `REQ-309`. A commit **must** be a keyframe when:

| # | Condition | Kind |
|---|---|---|
| 1 | It is a **root** — no parent to patch against | Correctness |
| 2 | It has **more than one parent** (a merge) — a patch would be ambiguous between two parents | Correctness |
| 3 | Its patch would be **larger than the snapshot** — compared before writing | Correctness |
| 4 | The count since the last keyframe reaches `keyframeInterval` (default **20**) | Heuristic |

Rule 3 is what keeps a payload that changes shape drastically — every id rewritten — from producing
an enormous patch chain. Rules 1–3 are correctness; only rule 4 is a heuristic, and it is stated as
one so that changing it is not mistaken for changing behaviour.

Rule 2 is why a merge is always a keyframe, which in turn means reconstruction never has to choose
between two parents.

---

## 5. Verification

`PATTERN.md` §5.4. Implements `REQ-316`, `REQ-317`.

Full verification is expensive and mostly unnecessary, so it is two-level:

| Level | Checks | Cost | When |
|---|---|---|---|
| **Chain** | Stored fields hash to each commit's declared id; every parent id exists | O(N), no reconstruction | **Always, at boot** |
| **Payload** | Reconstruct the payload, recompute its hash | O(N) reconstructions | Head, plus any commit the user inspects |

An integrity failure enters **read-only mode**, names the offending commit, and never writes. A
corrupted history must not be silently "repaired": repairing means guessing, and a guess that parses
is a guess that gets written back and circulated as fact (`REQ-317`).

Read-only mode is reachable through the **null storage adapter** (`05-storage.md` §2) — which is why
that adapter is a requirement and not a nicety. "Cannot write" is a supported configuration, so the
code path that needs it already exists.

---

## 6. Ordering: ancestry decides, a clock never does

`PATTERN.md` §5.6, `PAT-DEC-05`. Implements `REQ-312`.

```
compare(A, B):
  if A == B              → IDENTICAL
  if isAncestor(A, B)    → B is newer   (fast-forward to B)
  if isAncestor(B, A)    → A is newer   (fast-forward to A)
  otherwise              → DIVERGED     (stop and ask)
```

**Ancestry decides. A clock never does.**

Timestamps are displayed, because humans need them, and are excluded from every decision, because
they come from untrusted client clocks. A machine with a wrong clock would otherwise silently win
every reconcile and overwrite its peer's work — a failure mode that is invisible until the work is
gone.

> This is the single most tempting shortcut in the whole pattern and the most expensive.
> `PATTERN.md` §7 marks `PAT-DEC-05` as the one decision to choose differently from **never**.

The consequence is honest and must be stated in the UI: a user cannot express "mine is newer"
without a merge. The app sometimes asks when a timestamp would have answered. That is the cost, and
it is the point.

---

## 7. Reconciliation

`PATTERN.md` §5.8. Implements `REQ-313`, `REQ-615`.

```
reconcile(embeddedHistory, localHistory):
  if local is absent                → adopt embedded, write to local
  if docIds differ                  → register separately, never merge
  if no common ancestor in either   → register separately, never merge
  case compare(embeddedHead, localHead):
    IDENTICAL      → nothing
    embedded newer → fast-forward: adopt embedded into local
    local newer    → keep local; offer "export an updated file"
    DIVERGED       → block; require a clean working copy; open compare
```

Two properties this flow must hold:

### 7.1 It must not depend on shared storage

Every branch is computed from the file's history and whatever local history exists — **including
none**. If storage is empty the flow still reaches a correct outcome, because the file carries
everything needed (`PAT-INV-02`).

### 7.2 It must explain itself when storage is partitioned

"No local history" and "your browser gives every file its own storage" look identical from inside the
app and mean very different things to the user. The second case earns a **specific explanation naming
the browser behaviour** and pointing at the file-based path (`REQ-615`).

> `PATTERN.md` §5.8 calls this "the single most likely point of confusion in the whole design, and the
> app should be *built expecting it* rather than discovering it in support."

The distinction is detectable: if the embedded history's `docId` is one the registry has seen before
(from a different path, or from a prior session) but no local history exists under its storage keys,
storage was partitioned. That is the signal, and it is a `review`-class requirement because the
wording is the deliverable.

### 7.3 Divergence

Divergence stops. Both sides contain real work and only a human knows which is intended. The
application does not pick a winner and does not auto-merge (`REQ-313`, `PAT-INV-04`, `PAT-AP-03`).

The compare view is a **three-way** compare — base, A, B — with per-field suggestions. Suggestions may
be pre-selected; **nothing is written until confirmed** (`PAT-DEC-06`).

`PATTERN.md` §8.2 permits deferring the three-way view: "a 'choose one side entirely' prompt is
coarse but safe". This spec requires the coarse prompt in the first version and defers the three-way
view — see `10-open-questions.md` Q-5. What may **not** be deferred is that divergence stops.

---

## 8. Append-only, and what revert means

`PATTERN.md` `PAT-INV-06`, `PAT-DEC-13`. Implements `REQ-314`, `REQ-315`.

| Rule | |
|---|---|
| History is **append-only** | Reverting creates a new commit; ids are never rewritten |
| Reverting restores the payload; it does not erase the record | The abandoned commits remain reachable and remain shown |
| Rewriting history desynchronises every copy in circulation | It makes reconciliation against any previously exported file impossible (`PAT-INV-06`) |

A "strip authors" or "redact" button that fragments every copy is `PAT-AP-05`. The correct answer to
the privacy problem it tempts you to solve destructively is a **head-only export** — a separate
feature with a separate name — and that is deferred, not declined (`10-open-questions.md` Q-6).

### 8.1 Undo versus revert

Two mechanisms, deliberately not conflated:

| Mechanism | Scope | Produces |
|---|---|---|
| Undo / redo | **Bounded by the commit boundary** — a journal of operations since the head | No new commit until one is made |
| Revert | History-wide | A **forward commit** whose payload equals the target commit's |

Conflating them makes "change my mind about this edit" and "change the record of history"
indistinguishable. `PATTERN.md` marks this "choose differently: never — the boundary is what keeps
`PAT-INV-06` comprehensible to users".

Committing clears the operation journal. The journal is **not persisted** and is not part of the
container: it is per-user working state (§5.2 of `03-data-model.md`).

---

## 9. Nothing is discarded silently

`PATTERN.md` `PAT-INV-05`, §5.5. Implements `REQ-318`, `REQ-319`.

> **No code path deletes commits without explicit user confirmation.** Not on quota pressure, not on
> corruption, not on migration failure, not on "obviously unreachable" data.

An eviction policy that quietly drops old commits to make room is defensible in a cache. It is not
defensible here, because the history may be the only copy and its whole purpose is to survive being
passed around. **A full disk that says so is better than a quiet one that deletes** (`PAT-AP-11`).

### 9.1 Compaction

Compaction rewrites the representation **without touching ids**:

| May do | May not do |
|---|---|
| Re-keyframe a run of commits | Change any commit id |
| Drop redundant keyframes (one superseded by a later keyframe on the same line) | Drop a commit that is reachable from the head |
| — | Drop unreachable commits without confirmation |

It is always user-initiated, always preceded by a report of what it will remove, and cannot
desynchronise a compacted copy from an uncompacted one (`REQ-319`). That last property falls directly
out of §3's rule that the hash never covers the storage representation — it is the payoff for
`REQ-302`.

---

## 10. Honest labels

`PATTERN.md` §5.10, `PAT-DEC-09`, `ADR-0009`. Implements `REQ-320`, `REQ-321`.

Commit ids incorporate the author field, so changing an author name changes every subsequent id. An
attacker must rebuild the chain — which is trivial, because **nothing signs it**.

| Property | Provided? |
|---|---|
| The history has not been altered since it was written | **Yes** |
| It is internally consistent and complete | **Yes** |
| Corruption or truncation is detected | **Yes** |
| The named author actually wrote it | **No** |
| The history was not fabricated wholesale from scratch | **No** |

This is **integrity, not authorship**. The UI says *"chain intact"* and never *"verified"*
(`REQ-320`).

> The honest label costs nothing and should be present from the first version, because retrofitting
> it after users have trusted the stronger word is not possible.

Author names and emails live in every commit forever. For a document leaving an organisation this is
a disclosure obligation, not a footnote (`REQ-321`). It is stated where the author is entered and in
`08-security.md`'s residual-risk list.

Signing is deferred. `PATTERN.md` `PAT-DEC-09` is explicit that if the document is evidence, it must
be signed — "and accept that the file and its tooling both grow a key-management surface". A trip
plan is not evidence, so deferral is a choice rather than neglect; it is recorded as Q-7.

---

## 11. Present state

There is none. `app/` contains no hashing, no DAG, no diff, no patch, no commit — the only "version"
constructs are IndexedDB's `DB_VERSION = 1` migration counter (`app/db.js:5`) and the
`source: {format, version: 1, importedAt}` stamp on an imported trip (`app/io.js:83`).

This is the largest single body of new pure logic in the project. `PATTERN.md` §8.1 step 6 describes
it as "the part with the least room for error", and it is the one phase whose behaviour can be
verified entirely without a browser — which is why `01-requirements.md` puts it at phase 3, after the
model exists and before anything is persisted.
