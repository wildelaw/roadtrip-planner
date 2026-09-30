# The Portable Versioned Document pattern

**PVD** — a reusable design pattern for single-file documents that carry their own data, their own
application, and their own revision history, so that edits made to separate copies can be reconciled
without a server.

**Status:** extracted and generalised · **Source:** [Threat-Model-Viewport](SPEC.md) · **Last updated:** 2026-09-29

---

## What this document is

This is a **pattern specification**, not a product specification. It describes a shape that one
application has already been built to, in enough detail that a second application in a different
domain can be built to the same shape without rediscovering its sharp edges.

It is written to be read on its own. Where a claim comes from a specific decision in the reference
implementation, the decision record is cited — but the reasoning is repeated here, because a citation
to a document you do not have is not an argument.

**Reading order.** §1–§3 tell you whether this pattern fits your problem at all. §4–§5 describe it.
§6 is the part that must not be broken. §7 is the decision catalogue — the reusable core, and the
part most likely to be useful even if you build nothing. §8 is the instantiation checklist. §9–§11 are
what goes wrong and what it costs.

### Identifier scheme

Rules here carry `PAT-` ids, in three namespaces: `PAT-INV-nn` (invariants, §6), `PAT-DEC-nn`
(decisions, §7), `PAT-AP-nn` (anti-patterns, §9).

They are deliberately **outside** the `REQ-*` registry. Requirements are a property of an *instance*
of this pattern, not of the pattern; a pattern document that minted `REQ-` ids would collide with the
instance it was extracted from. Nothing here is machine-checked — the reference implementation's
traceability test parses its own requirement document and does not read this file.

---

## 1. The problem

A document that must be **circulated** is in tension with an application that must **hold its state**.

The common answer is a hosted tool: the document lives in someone's database, behind an account, and
you share a link. That solves concurrent editing and access control, and it costs you everything else.
The document stops being a document. It expires with a licence, it cannot be attached to a ticket,
it cannot be read on a plane, and it cannot outlive the vendor.

The common alternative is a portable file — JSON, CSV, a spreadsheet. That solves circulation and
reintroduces the original problem: **a portable file has no memory.** Two people are sent the same
file, each edits their copy, and there is no mechanism to bring the two sets of changes back together
short of a human opening both and reconciling by eye.

The interchange formats that do exist are *transport* formats. They carry the content and nothing about
who changed what, when, or why. That is by design — they describe a thing, not its authorship. It also
means the property that makes the content portable is precisely the property that makes the edits
unmergeable.

> **The gap: a document can travel, or it can have history, but a plain file cannot do both.**

## 2. The pattern

**Put the version control system inside the document.**

A single file — in the reference implementation, one HTML file a user double-clicks — carries three
things:

| Carried | What it is | Why it must be in the file |
|---|---|---|
| **The payload** | The content itself, in the application's own canonical representation | It is the thing being circulated |
| **The history** | A content-addressed commit DAG: who changed what, when, why, and in what order | It is what makes two divergent copies reconcilable |
| **The application** | The reader, editor, and version-control client, as code | Otherwise the file is inert the moment the tool is unavailable |

Because the history travels *with* the payload, two people editing copies of the same file can be
reconciled **by the file itself**, on the user's own machine — no server, no account, no network call.

```
        ┌─────────────────────────────────────────┐
        │  one file                               │
        │  ┌───────────┐  ┌──────────┐  ┌───────┐ │
        │  │  payload  │  │ history  │  │  app  │ │
        │  └───────────┘  └──────────┘  └───────┘ │
        └─────────────────────────────────────────┘
                 │             │            │
             the content   the commits   the client
```

The file is a **document that behaves like a shared repository**, and can still be exchanged with the
wider ecosystem through whatever interchange formats the domain already has.

**Also called:** "the carrying file"; a self-hosting document; a document with embedded provenance.
The distinguishing feature is not that the file is self-contained — many are — but that it is
**self-reconciling**.

## 3. Is this the right pattern?

The pattern is worth its cost in a specific and narrower situation than it first appears. Answer these
before reading further.

### 3.1 It fits when

| Condition | Why it matters |
|---|---|
| **The unit of work is a document people send to each other** | The file *is* the transport. If nobody would attach it to an email or commit it beside something, the pattern is overhead |
| **Edits are asynchronous and low-frequency** | Days or weeks between changes, made offline, by people who are not simultaneously co-authoring |
| **Divergence is expected and real** | Two people genuinely annotating the same thing independently. If only one person ever edits, you need a file, not a DAG |
| **Losing an edit is unacceptable** | The whole design is built around "never silently discard." If a lost edit is cheap, this is too heavy |
| **The content is small enough to live in one file** | The reference implementation budgets ~100–500 KB of payload and a few MB of history. Past that, the file becomes the problem |
| **No authority can be assumed** | No server, no accounts, no shared network — air-gapped, adversarial, or simply untrusting environments |
| **The domain already has interchange formats** | This is what makes the file a *citizen* rather than a silo. If none exist, you are inventing one, which is a different project |

### 3.2 It does not fit when

| Condition | Why, and what to use instead |
|---|---|
| **Many people edit concurrently, in real time** | This pattern has no merge until a human triggers one. Use a collaboration server (CRDT/OT); the pattern's own reference implementation lists real-time collaboration as an explicit non-goal |
| **The dataset is large or high-write** | A file that must be rewritten whole on every save has a hard ceiling. Use a database |
| **Access must be revocable** | Whoever holds the file holds the data, permanently. There is no revocation, no expiry, no remote wipe. If that is a requirement, stop |
| **Confidentiality is contractual** | The payload is readable by anyone with the file, and — in the reference implementation — its history carries author names and emails forever. Disclosure is the mitigation; there is no "strip it" button that does not break the history |
| **A server-side audit trail is mandated** | A self-asserted history is not evidence of authorship (§10) |
| **Content is naturally a stream of events** | Append-only logs with millions of entries belong in a log store. This pattern's history is for *documents*, whose commits are few and meaningful |

### 3.3 The one-sentence test

> If you handed the file to two people who will never meet, and both would be upset to lose their
> work, and neither can reach a server — this pattern fits. Otherwise it probably does not.

---

## 4. Structure of the artifact

Domain-neutral. Concrete element names vary; the anatomy does not.

### 4.1 The file, in order

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <!-- 1. Policy first: must precede every script it governs. -->
  <meta http-equiv="Content-Security-Policy" content="…">

  <title>…</title>
  <meta name="app-version" content="…">
  <meta name="app-hash"    content="sha256-…">   <!-- declares the build -->

  <!-- 2. The only permitted external reference (see PAT-DEC-02). -->
  <link rel="stylesheet" href="https://…/styles.css" integrity="sha384-…" crossorigin="anonymous">

  <style>/* application CSS, inlined */</style>
</head>
<body>
  <!-- 3. Shell markup: static. -->
  <header>…</header>
  <nav>…</nav>
  <main id="app-content"></main>

  <!-- 4. The container: payload + history + build metadata. Inert data. -->
  <script type="application/json" id="app-data">…escaped JSON…</script>

  <!-- 5. The application: classic, inline, hash-pinned. -->
  <script>/* application JS, concatenated */</script>
</body>
</html>
```

The **order is load-bearing**, not stylistic:

| # | Rule | Breaks if violated |
|---|---|---|
| A | Policy precedes the first `<script>` | The policy does not govern the script it was meant to pin |
| B | The data block is inert — `application/json`, never executable | Payload becomes code; every input is a potential script |
| C | The application script is **classic** (no `type="module"` with a local `src`) | `file://` gives the page an opaque origin; module loading is CORS-blocked and the app does not start |
| D | Shell markup is static; all dynamic content renders into one named region | The pristine-DOM export (§5.7) stops being deterministic |
| E | No inline `on*=` handlers, no `eval`, no `new Function`, no dynamic `<script>` | The policy is a hash, and inline handlers are not covered by one |

Rule B and rule E together are the reason the payload can be untrusted. See §5.9.

### 4.2 The five seams

Everything in the application sits behind one of five boundaries. Each exists so that a decision can
change in one place.

| Seam | Isolates | Consequence of having it |
|---|---|---|
| **Container codec** | Parse/serialize the embedded block, and the escaping rules around it | The payload format can change without touching features |
| **Canonical model** | The one internal representation everything else agrees on | Interchange formats become *mappings*, not the core |
| **Version control core** | Serialization, hashing, DAG, deltas, ancestry, merge base | Pure logic, testable without a DOM or a browser |
| **Storage adapter** | All persistence behind one interface | "Storage is unavailable" is a configuration, not a code path |
| **Interchange adapters** | One per external format, both directions | A new format is an addition, not a change |

The seams are not architectural decoration. Each one is where a platform difference is confined — and
platform differences are where this class of application actually breaks.

---

## 5. Core mechanisms

Each mechanism is stated generically, with the failure it prevents.

### 5.1 The file is the carrier; storage is a cache

The single most important rule. Browser storage for `file://` documents is not standardised and never
was:

- Chrome and Edge treat **all** local files as one origin. Convenient — storage follows the file
  anywhere — and it means any local page can read it.
- Firefox treats **each file path** as its own origin. Safer, and storage does not follow a file that
  is moved, renamed, copied, or opened from a different folder.
- Safari is inconsistent and has historically been restrictive.

Consequence: **the file carries everything required for correctness.** Storage is an overlay that makes
the common case fast and the multi-model case possible. Every operation must reach a correct outcome
with storage absent, empty, partitioned, or hostile.

> **Test of the rule:** delete all local storage and reopen the file. Nothing should be lost — only
> convenience. If anything is lost, the design has slipped.

### 5.2 The container

The embedded JSON has a fixed, versioned envelope:

```json
{
  "$schema": "…/container-1.0.0.schema.json",
  "format": "1.0.0",
  "payload": { },
  "history": {
    "keyframeInterval": 20,
    "head": "sha256:…",
    "commits": [ ]
  },
  "build": {
    "appVersion": "0.1.0",
    "appHash": "sha256-…",
    "generatedAt": "…"
  }
}
```

| Field | Rule |
|---|---|
| `format` | Container format version, independent of the app version and of the payload's own version |
| `payload` | The canonical model **at the head commit** — never the working copy (§5.6) |
| `history.commits` | The DAG, in topological order |
| `build.generatedAt` | Informational. **Never** used to decide precedence |
| Unknown `format` newer than the app | **Read-only, with an explanation.** Never guess at a format's semantics |

The container deliberately omits: the working copy, storage bookkeeping, and per-user preferences.
Those are not properties of a portable document.

### 5.3 The canonical model, and why it is a superset

Every application of this pattern sits between formats it does not control. The internal
representation must therefore satisfy two rules at once:

> **P1 — Neutral superset, never a lowest common denominator.** The canonical model represents the
> union of what the external formats can express. Where only one format has a concept, the concept
> still exists internally; the other format's export reports it as unrepresentable.

> **P2 — Nothing is dropped on import.** Every field the canonical model does not natively represent
> is preserved verbatim in a **passthrough bag**, keyed by source format.

```json
"x": {
  "formatA": { "…": "fields only format A has" },
  "formatB": { "…": "fields only format B has" }
}
```

A lowest-common-denominator model is the tempting mistake: map both formats onto their intersection and
the code is simple. It is also silently destructive. A converter that maps field to field will drop
data that has no counterpart, and the loss is invisible — the resulting document still validates, still
renders, and is simply missing what someone wrote.

The superset is more work, and it is what makes **import lossless** (§5.8). Export is where loss lives,
and export is where it can be disclosed.

Supporting rules that fall out of P1/P2:

| Rule | |
|---|---|
| Canonical requires almost nothing — an id and a name | Format-specific required fields are satisfied by **synthesis at export**, and every synthesized value is disclosed |
| Identity is stable and format-independent | An entity's internal id never changes because of an export; format-specific identifiers are *derived*, deterministically |
| Structure follows the model, not the wire | If an external format nests things that are conceptually flat (or vice versa), the mapper does the nesting, not the model |
| An empty bag is omitted | Never emitted as `{}` |
| Bags are opaque to the UI | Shown, attributed, and preserved — not interpreted |

### 5.4 Content-addressed history

History is a **directed acyclic graph**, not a list. It must be a DAG because reconciliation creates
commits with two parents, and because nothing is ever discarded.

```
            ┌── C4 ── C5 ──┐
C1 ── C2 ── C3              M      ← M has parents C5 and C7
            └── C6 ── C7 ──┘
```

```
payloadHash = H( canonicalSerialize(payload) )
commitHash  = H( canonicalSerialize({
                parents: sorted(commit.parents),   // ← the chain
                docId, author, timestamp, message, payloadHash
              }) )
```

Because `parents` is an input, a commit's id transitively covers its **entire ancestry**: changing any
historical commit changes the id of every commit after it. That is what makes tampering *detectable*
rather than merely visible.

**The hash covers the semantic payload, never the storage representation.** `snapshot` and `delta` are
not inputs. This single choice is what makes compaction, re-keyframing, and representation changes free
— they cannot desynchronise two copies of the same history, because the ids do not depend on how the
history is stored. See PAT-INV-07.

**Verification is two-level**, because full verification is expensive and mostly unnecessary:

| Level | Checks | Cost | When |
|---|---|---|---|
| **Chain** | Stored fields hash to each commit's declared id; every parent id exists | O(N), no reconstruction | Always, at boot |
| **Payload** | Reconstruct the payload, recompute its hash | O(N) reconstructions | Head, plus any commit the user inspects |

An integrity failure enters **read-only mode**, names the offending commit, and never writes. A
corrupted history must not be silently "repaired."

### 5.5 Deltas and keyframes

A commit is stored as **either** a full snapshot **or** a patch against its parent. Exactly one.

| Approach | Fails because |
|---|---|
| Snapshots only | A 100–500 KB payload over a hundred commits is tens of MB, against a ~5 MB storage budget |
| Deltas only | Reconstruction replays from the root — O(N) per access — and one corrupted patch destroys everything after it |
| **Both** | Reconstruction replays from the nearest preceding keyframe, so cost is bounded by the interval, not the history length |

A commit **must** be a keyframe when:

1. It is a **root** — no parent to patch against.
2. It has **more than one parent** (a merge) — a patch would be ambiguous between two parents.
3. Its patch would be **larger than the snapshot** — compared before writing.
4. The count since the last keyframe reaches `keyframeInterval` (default 20).

Rules 1–3 are correctness. Rule 4 is a heuristic. Rule 3 is what keeps a payload that changes shape
drastically — every id rewritten — from producing an enormous patch chain.

**Compaction** rewrites the representation without touching ids: re-keyframe, drop redundant keyframes,
drop unreachable commits. It is always user-initiated, always preceded by a report of what it will
remove, and it cannot desynchronise a compacted copy from an uncompacted one.

### 5.6 Ordering, and the rule that timestamps never decide

```
compare(A, B):
  if A == B              → IDENTICAL
  if isAncestor(A, B)    → B is newer   (fast-forward to B)
  if isAncestor(B, A)    → A is newer   (fast-forward to A)
  otherwise              → DIVERGED     (stop and ask)
```

**Ancestry decides. A clock never does.**

Timestamps are displayed, because humans need them, and are excluded from every decision, because they
come from untrusted client clocks. A machine with a wrong clock would otherwise silently win every
reconcile and overwrite its peer's work — a failure mode that is invisible until the work is gone.
This is the single most tempting shortcut in the whole pattern and the most expensive.

**Fast-forward** is silent and safe: one history is a strict ancestor of the other, so adopting the
descendant discards nothing.

**Divergence** stops. Both sides contain real work and only a human knows which is intended. The
application does not pick a winner and does not auto-merge.

### 5.7 Self-export from a pristine DOM

Exporting the whole application means writing a new file that contains the current payload and a
byte-identical copy of the application itself.

```
1. Capture PRISTINE = clone of the document root
   — the FIRST statement of the application, before any DOM mutation,
     before any theme class, before any rendering.

export(container):
  clone = PRISTINE.cloneNode(true)
  clone.querySelector('#app-data').textContent = escapeForScriptBlock(serialize(container))
  return '<!DOCTYPE html>\n' + clone.outerHTML
```

Capturing first is unrecoverable if done late. An export built from the live DOM carries whatever state
the session happened to be in — rendered rows, an applied theme, a dirty indicator — and stops being
deterministic.

**The export verifies itself before offering a download.** Re-parse the assembled document; assert the
data block re-parses; assert the extracted container equals the one passed in; assert the script text is
**byte-identical** to the running artifact's own; assert the declared app hash matches.

That last check is what makes the whole approach auditable: the application code is a constant. Only the
data block changes between exports, so the policy hash baked into the artifact stays valid in every file
it produces. **The hash is a property of the build, not of the export.**

Where a download is blocked — some configurations suppress downloads from `file://` — the fallback
presents the full document text with a copy action, and that fallback is reachable deliberately rather
than only on failure.

### 5.8 Reconciliation on open

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

**It must not depend on shared storage.** Every branch is computed from the file's history and whatever
local history exists — *including none*. If storage is empty the flow still reaches a correct outcome,
because the file carries everything needed.

**It must explain itself when storage is partitioned.** "No local history" and "your browser gives every
file its own storage" look identical from inside the app and mean very different things to the user.
The last case earns a specific explanation naming the browser behaviour and pointing at the file-based
path. Otherwise the user concludes the application is broken. This is the single most likely point of
confusion in the whole design, and the app should be *built expecting it* rather than discovering it in
support.

### 5.9 The security posture

State this plainly, because the natural reading is wrong:

> **An exported document is an executable HTML file.**

That is not incidental — it is the design. The file carries the application so the payload and its
viewer cannot be separated. The consequence is that *opening* a document means *running its code*, with
whatever privileges a local page has.

In the reference implementation's threat model, any local page can read every document in the shared
storage origin. A payload worth circulating — an assessment, an inventory, a security architecture — is
also worth stealing. Put together: **a crafted "document" is a plausible exfiltration vector, and this
pattern makes the format routine.**

Three layers of mitigation, in descending order of what they actually achieve:

| Layer | Mitigation | Strength |
|---|---|---|
| 1 | **Import, don't open.** Read the file as *text*, locate the data block by string scanning, never insert the document into the DOM, never parse it as markup, never execute it | **Strong.** The hostile file's code never runs |
| 2 | Warn on unrecognized builds; default to read-only, require explicit acknowledgement to edit | Moderate |
| 3 | A hash-pinned policy, escaping, sanitization, no network egress | Protects the **authentic** file; does nothing against a hostile one |

> **A hostile file writes its own policy.** An attacker authoring a malicious document writes the CSP
> meta tag themselves and permits their own script's hash. The policy in the file cannot constrain the
> file's author.

This is why layer 1 is the primary mitigation and layer 3 is secondary, and why the UI must give the
import path prominence rather than burying it in documentation. Stating it the other way round is a
comfortable lie, and it is the specific overclaim this pattern most invites.

Supporting rules that follow:

| Rule | |
|---|---|
| Every payload-derived string enters the DOM as text (`textContent` / `createTextNode`) | Never as markup |
| No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` — anywhere, enforced statically over the **built artifact** | The failure mode is one missed field |
| URL-valued fields validated against a scheme allowlist | `javascript:`, `data:`, `vbscript:` rejected |
| Untrusted JSON is reconstructed into null-prototype objects or by explicit field copying | `JSON.parse` produces `__proto__` keys happily; any deep merge over it is a prototype-pollution primitive |
| Patch application validates `op`, `path` bounds, and rejects `__proto__`/`constructor`/`prototype` segments | Same |
| Resource guards: container size, commit count, patch operation count, nesting depth, embedded-source length | A hostile file can hang a tab. Every limit fails with an explanation and an offer to export what was readable, never a blank page |
| Code-carrying content types (SVG, diagram languages) sanitized or sandboxed, or shown as source text | A diagram you cannot see is a small loss; a script that runs is not |
| Third-party assets pinned to exact versions with integrity attributes | A compromised stylesheet can deface; a compromised script can exfiltrate |

### 5.10 Identity, and what the chain does not prove

Commit ids incorporate the author field, so changing an author name changes every subsequent id. An
attacker must rebuild the chain — which is trivial, because **nothing signs it**.

| Property | Provided? |
|---|---|
| The history has not been altered since it was written | **Yes** |
| It is internally consistent and complete | **Yes** |
| Corruption or truncation is detected | **Yes** |
| The named author actually wrote it | **No** |
| The history was not fabricated wholesale from scratch | **No** |

The reference implementation calls this **integrity, not authorship**, and its UI says *"chain intact"*
and never *"verified"*. Cryptographic signing is the fix and is deferred. The honest label costs nothing
and should be present from the first version, because retrofitting it after users have trusted the
stronger word is not possible.

### 5.11 The build

The reference implementation's build is the pattern's auditability claim: **from a clean checkout, with
no install step, produce the artifact.**

| Rule | Why |
|---|---|
| No bundler, no build dependency for the artifact itself | "It builds from nothing" is a claim a reviewer can check in one command |
| Author in modules; **emit one classic script** | `file://` blocks module `src` on an opaque origin. Modules are a source-time convenience |
| Concatenate in a declared, single-source order | The same list feeds the build *and* the test harness, so the two cannot drift |
| Fail loudly on any unresolved placeholder | A silent `{{TOKEN}}` in a shipped artifact is a defect that ships |
| Compute the policy hash over the **final** bytes | Any minification must precede hashing |
| Vendor external schemas at build time and inline them | Validation works offline, and a schema update is a deliberate act rather than something that changes underfoot |

Development dependencies (test tooling, a cross-check validator) are permitted and never enter the
artifact. The split is worth stating explicitly, because "dependency-free" is otherwise read as
applying to the whole repository, which would make browser-matrix testing — where the hardest bugs
live — impossible.

---

## 6. Invariants

**These are the pattern.** An implementation that breaks one is a different design wearing the same
shape, and it will fail in the way the invariant predicts.

| # | Invariant | The failure it prevents |
|---|---|---|
| **PAT-INV-01** | **The file is the primary carrier.** Correctness never depends on storage being shared across files or surviving a move, copy, or rename | Firefox per-file origins silently strand the user's work |
| **PAT-INV-02** | **Storage is a cache.** Every outcome is reachable with storage absent, empty, or throwing | A cleared profile becomes data loss |
| **PAT-INV-03** | **Ordering is by ancestry.** Timestamps are displayed and never decisive | A wrong clock silently wins every reconcile and overwrites a peer |
| **PAT-INV-04** | **Divergence always prompts.** Nothing is auto-merged; fast-forward is the only silent adoption | A mechanical merge overrides someone's judgement, invisibly |
| **PAT-INV-05** | **Nothing is discarded silently.** No eviction, no pruning, no truncation, no destructive reconcile without an explicit, informed confirmation | The history *is* the user's work; a policy that drops it is not defensible in a document |
| **PAT-INV-06** | **History is append-only.** Reverting creates a new commit; ids are never rewritten | Rewriting history desynchronises every copy in circulation and makes reconciliation against any previously exported file impossible |
| **PAT-INV-07** | **The id covers the semantic payload, never the storage representation** | Compaction or re-keyframing would invalidate ids and force a DAG rebuild |
| **PAT-INV-08** | **Application code is byte-identical in every export.** Only the data block differs | The policy hash stops being constant and self-verification becomes meaningless |
| **PAT-INV-09** | **Every input is untrusted.** Import reads text and never executes; nothing payload-derived reaches the DOM as markup | One crafted document reads every other document in the origin |
| **PAT-INV-10** | **Import is lossless; export is lossy and discloses the loss.** Passthrough bags plus a per-format lossiness ledger | A field-by-field converter silently drops what one format cannot say |
| **PAT-INV-11** | **The canonical model is a neutral superset**, never a lowest common denominator | The intersection model is simple and quietly destructive |
| **PAT-INV-12** | **All persistence goes through one adapter.** No feature module touches storage APIs directly | Storage-unavailable and read-only become special cases at every call site instead of one |
| **PAT-INV-13** | **The pointer is written last and removed first** | An interrupted write leaves a dangling head — corruption — instead of orphans, which are merely waste |
| **PAT-INV-14** | **Boot is deterministic:** the pristine DOM is captured before any mutation, and container → integrity → storage → reconcile happen before the UI is interactive | Exports carry session state; reconciliation runs against a half-initialised store |

### On INV-05, the rule that overrides the others

> **No code path deletes commits without explicit user confirmation.** Not on quota pressure, not on
> corruption, not on migration failure, not on "obviously unreachable" data.

An eviction policy that quietly drops old commits to make room is defensible in a cache. It is not
defensible here, because the history may be the only copy and its whole purpose is to survive being
passed around. **A full disk that says so is better than a quiet one that deletes.**

---

## 7. Decision catalogue

The reusable core. Each entry is a decision any instance must make, the choice the reference
implementation made and why, what it cost, and — most importantly — **when to choose differently**.

`PAT-DEC-01` **Where the source of truth lives**
- *Forces:* platform storage is unreliable and browser-dependent; users expect edits to persist.
- *Reference choice:* the file; storage is an overlay. (§5.1)
- *Cost:* the file must be re-exported and re-sent for changes to travel; users will be surprised that
  the app "forgot" a change they did not export.
- *Choose differently when:* you control the deployment (a single origin, an intranet) and can
  guarantee storage — then storage may be authoritative, and this is no longer this pattern.

`PAT-DEC-02` **How external assets are delivered**
- *Forces:* inlining a large design system inflates **every exported file**; a CDN breaks offline use
  and adds a supply-chain dependency.
- *Reference choice:* pin one stylesheet to a CDN with an integrity hash, isolate it behind a single
  seam, and accept degraded-but-functional styling offline.
- *Cost:* the artifact is **not fully offline** — the one accepted deviation from the stated
  requirements in the reference implementation. It is recorded as a deviation, not reinterpreted.
- *Choose differently when:* the domain's files are small, or offline is a hard requirement, or the
  payload is confidential enough that a network reference is itself a leak. Then inline everything and
  accept the file size.

`PAT-DEC-03` **How history is stored**
- *Forces:* storage is small and bounded; reconstruction cost grows with history.
- *Reference choice:* deltas with periodic keyframes and the four keyframe rules. (§5.5)
- *Cost:* reconstruction logic, a fidelity guarantee to test, and a re-keyframing path.
- *Choose differently when:* history is short (snapshots alone are simpler) or the payload is tiny.

`PAT-DEC-04` **Hash function and runtime**
- *Forces:* the obvious API (`crypto.subtle`) is asynchronous, secure-context-dependent, and differs
  across browser and Node; the application needs synchronous hashing at boot and in tests.
- *Reference choice:* a pure-JavaScript synchronous SHA-256, verified against published NIST vectors on
  every build.
- *Cost:* hand-written cryptographic primitives are a classic bug source. The mitigation is the vector
  test and the fact that the only property required — collision resistance for content addressing — is
  provided regardless of implementation language.
- *Choose differently when:* you can rely on a secure context everywhere **and** can afford async
  throughout. Verify the assumption rather than inheriting it.

`PAT-DEC-05` **What "newer" means**
- *Forces:* users say "the newer one"; the only clock available is untrusted.
- *Reference choice:* ancestry. Timestamps are informational. (§5.6)
- *Cost:* a user cannot express "mine is newer" without a merge; the app sometimes asks when a
  timestamp would have answered.
- *Choose differently when:* never, for a distributed document. This is the pattern's least negotiable
  decision.

`PAT-DEC-06` **Divergence policy**
- *Forces:* auto-merge is convenient; the merge base is computable; both sides contain real work.
- *Reference choice:* stop and ask, with a three-way compare (base, A, B). Suggestions may be
  pre-selected; **nothing is written until confirmed.**
- *Cost:* more user work per reconcile.
- *Choose differently when:* the payload has a formal, unambiguous merge semantics (rare) or only one
  person ever edits (then you do not need this pattern).

`PAT-DEC-07` **Canonical model strategy**
- *Forces:* external formats disagree structurally, not just in naming.
- *Reference choice:* neutral superset with per-format passthrough bags. (§5.3)
- *Cost:* a larger internal model, and mapping code in both directions for every format.
- *Choose differently when:* you own all the formats, or there is exactly one — then the canonical model
  *is* the format and the mappers disappear.

`PAT-DEC-08` **Validating imported documents**
- *Forces:* schema validation wants a real validator; a validator is a dependency; a subtly wrong
  validator is worse than none because it gives confident wrong answers.
- *Reference choice:* format-specific hand-written validators covering the documented keyword subset the
  vendored schemas actually use, cross-checked in the **test suite only** against a reference
  implementation over a corpus.
- *Cost:* the cross-check only proves agreement on the corpus; a thin corpus ships a divergence.
- *Choose differently when:* you can afford the runtime dependency and a second policy origin.

`PAT-DEC-09` **Identity and authorship**
- *Forces:* users want attribution; verification requires signing; signing requires key management,
  which is a large amount of work that is easy to do badly.
- *Reference choice:* self-asserted identity inside the hash chain, disclosed as such, with signing
  deferred. (§5.10)
- *Cost:* authorship is forgeable, and the UI must be careful never to imply otherwise.
- *Choose differently when:* the document is evidence. Then sign — and accept that the file and its
  tooling both grow a key-management surface.

`PAT-DEC-10` **Module strategy**
- *Forces:* modern JavaScript reaches for `import`; `file://` blocks module loading on an opaque origin.
- *Reference choice:* author as plain script fragments attaching to one global namespace; concatenate in
  a declared order; no bundler. (§5.11)
- *Cost:* no module isolation — discipline is required to keep fragments out of each other's internals.
- *Choose differently when:* the artifact never runs from `file://`. Then a bundler is fine — but if the
  point is the double-clickable file, it is not.

`PAT-DEC-11` **UI stack**
- *Forces:* a framework would make the UI far faster to build; the artifact must be one file with no
  runtime to install; a design system's *styles* may be available without its *behaviour*.
- *Reference choice:* a CSS-only design system plus hand-written vanilla JS toggling its documented state
  classes. This is the largest workstream in the reference implementation by a wide margin.
- *Cost:* every table, tab, side nav, modal, dropdown, and tree is hand-written. Budget for it
  explicitly; it is not a footnote.
- *Choose differently when:* you inline a framework bundle (and accept the file size), or the UI is
  simple enough that the design system is optional.

`PAT-DEC-12` **Storage backend**
- *Forces:* `localStorage` is small (~5 MB), synchronous, and partitioned unpredictably;
  IndexedDB is blocked on some `file://` origins entirely.
- *Reference choice:* `localStorage` behind an adapter, with a memory adapter and a null adapter for
  read-only — so "storage is unavailable" is a supported configuration.
- *Cost:* a hard quota ceiling, addressed by compaction and disclosure rather than eviction.
- *Choose differently when:* you can require a served origin. Then IndexedDB is a straightforward
  upgrade behind the same adapter.

`PAT-DEC-13` **Undo versus revert**
- *Forces:* users expect "undo" to cover everything; history must be append-only.
- *Reference choice:* operation-level undo/redo **bounded by the commit boundary**, plus revert
  (a forward commit) for history. Conflating them makes "change my mind about this edit" and "change the
  record of history" indistinguishable.
- *Cost:* two mechanisms and a clear explanation in the UI.
- *Choose differently when:* never — the boundary is what keeps INV-06 comprehensible to users.

`PAT-DEC-14` **Which interchange formats to support first**
- *Forces:* every format is two mappers, a validator, a ledger, and a test corpus.
- *Reference choice:* the two formats the domain's users actually exchange, and no others, in the first
  version. Formats with a broken upstream export path are deferred, not half-done.
- *Cost:* users of a third format are unserved.
- *Choose differently when:* the domain has one dominant format. Support one, well, and let the
  passthrough bags carry the rest.

---

## 8. Instantiating the pattern

### 8.1 Checklist

Ordered. Steps 1–4 are design and are cheap to change; steps 5–11 are expensive to change later.

| # | Step | Output |
|---|---|---|
| 1 | **Define the payload and its canonical model.** Start from the union of your interchange formats, not from one of them | A schema, with ids and a name required and almost nothing else |
| 2 | **Choose the interchange formats.** Two is a good number. Vendored schemas, pinned | A detection rule per format (structural markers, never the filename) |
| 3 | **Write the lossiness ledger before the mappers.** One table, both directions: every field classified as mapped, folded, or dropped | The table that makes "did we forget a field?" a mechanical check |
| 4 | **Decide synthesis vs blocking.** Synthesize when a neutral default is honest and disclosed; block when any invented value would be a false statement | A per-field rule set |
| 5 | **Canonical serialization.** Sorted keys, no insignificant whitespace, defined number and string normalization. Two implementations must agree — share the source | The hashing input |
| 6 | **History core:** commit records, hashing, DAG, ancestry, keyframes, patch application, merge base. Pure logic; test with generated histories | The part with the least room for error |
| 7 | **Storage adapter** + the write-ordering invariant + the registry + quota accounting | Persistence that degrades instead of failing |
| 8 | **Shell, views, and the edit path.** Commit, revert, discard, stash, undo/redo bounded by the commit boundary | The interactive product |
| 9 | **Import (text-only) and export (pristine DOM + self-verify)** | The circulation path |
| 10 | **Security pass:** the built-artifact static checks, the parameterised escaping test over *every* field, prototype pollution, the resource guards | The disclosures and the residual-risk list |
| 11 | **Tests:** property tests for reconstruction and serialization, fault injection for interrupted writes, a browser × protocol matrix, and traceability | The suite |

### 8.2 The minimum viable instance

Not every application needs every mechanism. The smallest thing still recognisably this pattern:

**Required** — the file carries payload + history + app; content-addressed commit DAG; ancestry
ordering; divergence prompts; import is lossless; export is self-verified and byte-identical;
nothing is silently discarded; import is text-only.

**Deferrable** — deltas (snapshots alone are correct, merely larger); compaction; the merge-base
three-way view (a "choose one side entirely" prompt is coarse but safe); a second interchange format;
signing; a model registry.

Cutting a **required** item does not produce a smaller instance. It produces a different design with a
plausible name, and it will fail in the predicted way.

### 8.3 Worked fits

| | Threat modelling *(reference)* | Vacation planning | Inventory tracking | NIST-style assessment |
|---|---|---|---|---|
| **Payload** | Threat model: zones, components, flows, threats, controls, risks | Trip: travellers, legs, bookings, activities, budget, documents | Items, locations, quantities, movements, reorder points | Control assessments, findings, evidence, POA&Ms, risk ratings |
| **Interchange formats** | OTM, TML | iCalendar, GPX, CSV, booking confirmations | CSV, ERP export, barcode/scan datasets | **OSCAL**, CSV/Excel, ticketing export |
| **Canonical superset is needed because** | One format models coordinates, the other source text; one has actors, the other trust ratings | Calendars have no budget; spreadsheets have no time zones or recurrence | Counting systems have no provenance; ERPs have no "two people counted this shelf differently" | OSCAL models assessment results in a structure no spreadsheet matches; every vendor's CSV disagrees |
| **Unit of the edit** | A threat, a control, a component | An activity or a booking | A count or a movement | A finding or a control's assessment |
| **Who diverges** | Reviewer and model owner | Two people planning halves of a trip | Two people counting different aisles, or one at the shelf and one in the office | Assessor and system owner, or two assessors on different control families |
| **Merge conflicts look like** | Same control status, two opinions | Same day double-booked | Same item, two quantities | Same control, two ratings |
| **The honest hard part** | Authorship is forgeable; the file is executable | Bookings are real-world commitments; a merge can double-book | Quantities are derived from the real world, so a merge is a reconciliation of *counts*, not of text | Assessment evidence has a validity window; history is not a substitute for an audit trail |
| **Fits?** | Yes — this is the reference | Yes. Keep it small; defer deltas and the registry | Yes, with care: the payload is a *record of observations*, so commits are cheap and frequent | Yes — closest cousin. But if the assessment is evidence, sign (PAT-DEC-09) or keep server-side records too |

**The vacation planner is the useful counterweight.** It shows how little of the pattern is needed:
one interchange format (a calendar), no signing, no registry, snapshots without deltas, and the entire
value delivered by the file carrying its own history. Most instances should look like this, not like
the reference implementation.

---

## 9. Anti-patterns

`PAT-AP-01` **Trusting storage as the record.** *Symptom:* a "shared models" feature works in testing
and silently loses data on Firefox. *Cause:* the shared-origin assumption. *Fix:* PAT-INV-01/02.

`PAT-AP-02` **Resolving conflicts by timestamp.** *Symptom:* occasionally, and unreproducibly, one
person's work vanishes and the other's survives. *Cause:* a clock. *Fix:* PAT-INV-03 — ancestry.

`PAT-AP-03` **Auto-merging a divergence.** *Symptom:* a clean merge that silently drops a decision
someone made deliberately. *Cause:* treating merge as a text operation instead of a judgement. *Fix:*
PAT-INV-04.

`PAT-AP-04` **Reintroducing a server "just for sync."** *Symptom:* the pattern's entire premise erodes
one convenience at a time; the file becomes a cache of the server. *Cause:* async reconciliation is
less pleasant than instant. *Fix:* decide consciously — either this pattern, or a hosted tool. Both are
defensible; drifting between them is not.

`PAT-AP-05` **Rewriting history to remove something.** *Symptom:* a "strip authors" or "redact" button
that fragments every copy in circulation. *Cause:* treating history as mutable storage. *Fix:*
PAT-INV-06. Add a forward commit, or export a head-only document — a separate feature with a separate
name.

`PAT-AP-06` **Hashing the storage representation.** *Symptom:* compaction changes ids, and no two copies
reconcile any more. *Cause:* an id computed over a delta or a snapshot. *Fix:* PAT-INV-07.

`PAT-AP-07` **Parsing the imported document to read it.** *Symptom:* the app is convenient and executes
attacker code. *Cause:* using a DOM parser where string scanning was required. *Fix:* PAT-INV-09.

`PAT-AP-08` **A lossy import with no ledger.** *Symptom:* re-exporting a document loses fields nobody
noticed were there. *Cause:* a field-by-field mapper with no classification. *Fix:* PAT-INV-10, and the
mechanical completeness test over the vendored schemas.

`PAT-AP-09` **Treating the local registry as authority.** *Symptom:* deleting an entry appears to delete
a document; an empty registry appears to be data loss. *Cause:* confusing an index with a record. *Fix:*
the file wins, and the registry is re-seeded on every load.

`PAT-AP-10` **Claiming the file is safe to open.** *Symptom:* a security review finds the documentation
promises sandboxing it cannot deliver. *Cause:* describing the policy without describing what a hostile
file does to it. *Fix:* §5.9, and a residual-risk section that a reviewer can press on.

`PAT-AP-11` **Deleting commits to make room.** *Symptom:* a full disk that quietly isn't, and a user who
loses a month of work with no notification. *Cause:* treating history as a cache. *Fix:* PAT-INV-05.

---

## 10. Costs and honest limitations

Stated so they are chosen rather than discovered.

| Cost | Detail |
|---|---|
| **The file grows with history** | Every export carries its own past. Compaction bounds it; it does not remove it |
| **Sharing is whole-file** | Every reconciliation is a file exchange, and every exchange is a merge candidate — never a small delta |
| **No real-time collaboration** | Reconciliation is asynchronous and file-based by construction. If two people must see each other's keystrokes, this is the wrong pattern |
| **Authorship is forgeable** | The chain proves integrity, not identity (PAT-DEC-09). Signing is a real, deferred project |
| **No access control and no revocation** | Whoever holds the file holds the data, permanently. There is no un-share |
| **The artifact is executable** | A structural property of the pattern, mitigated but not eliminated (§5.9) |
| **History carries identity** | Author names and emails live in every commit forever. For documents leaving an organisation this is a disclosure obligation, not a footnote |
| **Platform behaviour is load-bearing** | The design is shaped by `file://` origin rules that were never standardised. Some of these must be *verified empirically per browser* before dependent code is written — and the answers may force a design change |
| **The UI is often hand-written** | Without a framework, component behaviour is a large line item (PAT-DEC-11). Underestimating it is the most common way an instance of this pattern stalls |
| **Storage is a hard ceiling** | ~5 MB in the reference implementation. Compaction and disclosure manage it; only a different backend removes it |

### The residual risks a reviewer should press on

1. **A hostile document opened directly can read every other document in the origin.** Mitigated by the
   import path and the build warning. Not eliminable while a document is executable HTML.
2. **Authorship is forgeable.** Disclosed in the UI. Signing is the fix.
3. **Some platform assumptions may not hold** (§11). Each must be verified, and the finding recorded
   whether or not it is convenient.

---

## 11. Open questions

A pattern document should say what it does not settle. These are genuinely unresolved across instances,
not merely unresolved in the reference implementation.

| # | Question | Why it matters |
|---|---|---|
| **P-1** | **Is a non-executable data block exempt from a hash-only script policy on `file://`?** | If not, the export path must hash the data block too — a change to every exported file's policy string |
| **P-2** | **Is a `<meta>`-delivered policy enforced on `file://`?** | If not, tamper detection holds only over HTTP, and the documentation must say so rather than claiming it universally |
| **P-3** | **What are the actual state classes of the pinned design system?** | The documentation usually describes the *framework's* conventions, not the CSS that ships. Verify against the stylesheet |
| **P-4** | **What are the pinned diagram renderer's security defaults?** | Defaults have changed across versions and have historically permitted injection |
| **P-5** | **Signing.** Which scheme, which key management, and is the chain the right substrate? | The one feature that converts integrity into authenticity, and a large project |
| **P-6** | **Head-only export.** How does a document travel without its history? | The correct answer to the privacy problem that PAT-AP-05 tempts you to solve destructively |
| **P-7** | **Cross-instance coordination.** Two tabs, two windows, one store | The reference implementation detects and refuses; whether to coordinate is open |
| **P-8** | **A second storage backend.** IndexedDB or the File System Access API, behind the same adapter | Would lift the quota ceiling and, on some platforms, the whole file-exchange model with it |

The reference implementation carries twenty such questions in `specs/10-open-questions.md`, prioritised
and each with the reason it is unanswered and the cost of being wrong. That document is itself part of
the pattern: **a spec that lists what it deliberately does not know is more trustworthy than one that
appears to know everything.**

---

## 12. Reference implementation crosswalk

Where to read the mechanism in full, in the application this pattern was extracted from.

| Pattern element | Reference |
|---|---|
| The artifact, boot sequence, self-export, policy | [`specs/02-architecture.md`](specs/02-architecture.md) |
| Canonical model, passthrough bags, container, commit records | [`specs/03-data-model.md`](specs/03-data-model.md) |
| Commit DAG, hash chain, deltas, keyframes, merge base, revert | [`specs/04-versioning.md`](specs/04-versioning.md) |
| Storage adapter, registry, origins, quota, concurrency | [`specs/05-storage.md`](specs/05-storage.md) |
| Import/export mappings, the lossiness ledger, synthesis vs blocking | [`specs/06-interchange.md`](specs/06-interchange.md) |
| The application's own threat model, residual risk | [`specs/08-security.md`](specs/08-security.md) |
| Traceability, the browser × protocol matrix, verification tasks | [`specs/09-testing.md`](specs/09-testing.md) |
| Deferred decisions, and why each is deferred | [`specs/10-open-questions.md`](specs/10-open-questions.md) |
| The decisions behind this catalogue | [`decisions/`](decisions/) — 14 ADRs |

The two ADRs to read first regardless of your domain: **file-first storage** (the invariant everything
else depends on) and **divergence always prompts** (the one most often got wrong).

---

## Glossary

| Term | Meaning |
|---|---|
| **Artifact** | The single file: payload + history + application |
| **Canonical model** | The application's internal, format-neutral representation of the payload |
| **Commit** | An immutable node in the history DAG: a payload snapshot, an author, a message, parent links, and a content-derived id |
| **Container** | The versioned JSON envelope embedded in the artifact |
| **Divergence** | Two histories where neither is an ancestor of the other; requires an explicit decision |
| **Fast-forward** | A reconcile where one history is a strict ancestor of the other; the descendant is adopted silently |
| **Head** | The commit the working copy was last synchronised to |
| **Keyframe** | A commit storing a full snapshot, used as a base for reconstructing the patches that follow |
| **Lossiness ledger** | The table classifying every interchange field as mapped, folded, or dropped |
| **Merge base** | The lowest common ancestor of two heads |
| **Passthrough bag** | A per-source-format object preserving fields the canonical model does not interpret |
| **Pristine DOM** | A clone of the document root captured before any mutation, used for self-export |
| **Registry** | A local index of known documents. A convenience, never an authority |
| **Working copy** | The editable payload in memory, derived from the head; clean or dirty |

---

*Extracted from [Threat-Model-Viewport](SPEC.md). The pattern is general; the reference
implementation's platform findings, sizes, and library choices are its own.*
