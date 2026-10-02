# 02 — Architecture

The artifact, its boot sequence, its export path, and the build that produces it.
Implements `REQ-101`–`REQ-115`, `REQ-209`, `REQ-505`–`REQ-510`, `REQ-612`.

---

## 1. The artifact, in order

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <!-- 1. Policy first: must precede every script it governs. -->
  <meta http-equiv="Content-Security-Policy" content="...">

  <title>Trip Planner — {{tripTitle}}</title>
  <meta name="app-version" content="{{appVersion}}">
  <meta name="app-hash"    content="sha256-{{appHash}}">

  <!-- 2. No external reference of any kind (ADR-0002). -->
  <style>/* styles/main.css, inlined */</style>
</head>
<body>
  <!-- 3. Shell markup: static. -->
  <div id="app" class="app"> ... </div>

  <!-- 4. The container: payload + history + build metadata. Inert data. -->
  <script type="application/json" id="app-data">{{escapedJSON}}</script>

  <!-- 5. The application: classic, inline, hash-pinned. One script element. -->
  <script>{{concatenatedJS}}</script>
</body>
</html>
```

`{{tripTitle}}`, `{{appVersion}}`, `{{appHash}}` and `{{appData}}` are the only placeholders. The
build fails loudly on any unresolved placeholder (`REQ-109`), because a shipped `{{TOKEN}}` is a
defect that ships.

### 1.1 Why the order is load-bearing

| # | Rule | Breaks if violated | Requirement |
|---|---|---|---|
| A | Policy precedes the first `<script>` | The policy does not govern the script it was meant to pin | `REQ-105` |
| B | The data block is inert — `application/json`, never executable | The payload becomes code; every input becomes a potential script | `REQ-104` |
| C | The application script is classic — no `type="module"`, no local `src` | `file://` gives the page an opaque origin; module loading is CORS-blocked and the app does not start | `REQ-103` |
| D | Shell markup is static; all dynamic content renders into one named region | The pristine-DOM export (§5) stops being deterministic | `REQ-114`, `REQ-505` |
| E | No inline `on*=` handlers, no `eval`, no `new Function`, no dynamic `<script>` | The policy is a hash, and inline handlers are not covered by one | `REQ-106` |

Rules B and E together are why the payload can be untrusted. See `08-security.md`.

### 1.2 What this changes about the present app

| Present | Target |
|---|---|
| `<link rel="stylesheet" href="styles/main.css">` (`index.html:7`) | Inlined `<style>`; `styles/main.css` stays the authored source (`REQ-113`, `REQ-610`) |
| `<script type="module" src="app/main.js">` (`index.html:73`) | One classic inline `<script>` (`REQ-103`) |
| A second inline script — the boot watchdog (`index.html:64-71`) | Folded into the application script, so the artifact ships exactly **one** inline script to hash. The watchdog's job disappears anyway: under `file://` the app now genuinely starts |
| No container | `<script type="application/json" id="app-data">` (`REQ-104`, `REQ-209`) |
| No policy | Hash-pinned CSP meta (`REQ-105`, `REQ-112`) |

---

## 2. The five seams

`PATTERN.md` §4.2 requires five boundaries. Concretely, as a declared fragment order (§4):

| Seam | Fragments | Rule |
|---|---|---|
| **Container codec** | `core/container.js` | Parse/serialize the embedded block, and the escaping around it. Nothing else may read or write `#app-data` |
| **Canonical model** | `model/trip.js` | The one internal representation. Interchange formats are *mappings*, not the core |
| **Version control core** | `core/sha256.js`, `core/serialize.js`, `core/history.js`, `core/patch.js`, `core/merge.js`, `core/verify.js` | Pure logic. No DOM, no storage, no browser APIs — testable in Node |
| **Storage adapter** | `storage/*.js` | All persistence. No feature module touches `localStorage` or `indexedDB` |
| **Interchange adapters** | `interchange/*.js` | One per format, both directions. A new format is an addition, not a change |

Two further single-owner seams, because `PAT-INV-12`'s discipline generalises:

| Seam | Fragment | Rule |
|---|---|---|
| **Environment** | `environment.js` | The **only** module permitted to read `location` (`REQ-601`). Answers `aiEnabled`, `isFile`, `canSaveInPlace` |
| **Render** | `ui/render.js` | The **only** path from data to DOM (`REQ-701`). Everything else builds nodes through it |

`PATTERN.md` §4.2 is explicit that seams are "not architectural decoration … each one is where a
platform difference is confined". The Environment seam is the clearest instance in this application:
three separate platform behaviours (`file://` gating, `file://` download suppression, File System
Access availability) collapse into one module with three booleans.

---

## 3. Module layout and the declared fragment order

`PATTERN.md` §5.11: author in fragments, emit one classic script, concatenate in a **declared
single-source order** that feeds the build *and* the test harness so the two cannot drift
(`REQ-108`, `REQ-808`).

```
fragments = [
  'environment.js',
  'core/sha256.js',
  'core/serialize.js',
  'utils/id.js',
  'utils/dates.js',
  'utils/format.js',
  'core/container.js',
  'core/patch.js',
  'core/history.js',
  'core/merge.js',
  'core/verify.js',
  'model/trip.js',
  'interchange/ledger.js',
  'interchange/tripdatajson.js',
  'interchange/ical.js',
  'storage/adapter.js',
  'storage/localstorage.js',
  'storage/memory.js',
  'storage/null.js',
  'storage/registry.js',
  'io/import.js',
  'io/export.js',
  'store.js',
  'ui/render.js',
  'ui/shell.js',
  'ui/trip-list.js',
  'ui/trip-editor.js',
  'ui/itinerary-day.js',
  'ui/checklists.js',
  'ui/lodging.js',
  'ui/bookings.js',
  'ui/places.js',
  'ui/charging.js',
  'ui/budget.js',
  'ui/history.js',
  'ui/reconcile.js',
  'ui/settings-view.js',
  'ui/ai-panel.js',
  'ui/toast.js',
  'ui/modal.js',
  'ai/transport.js',
  'ai/ollama.js',
  'ai/webgpu.js',
  'ai/agent.js',
  'ai/tools.js',
  'ai/prompt.js',
  'ai/mock.js',
  'boot.js',
]
```

The order is topological: a fragment may only use names defined above it. This replaces the ES
module graph, and the discipline it costs is stated as a cost in `ADR-0010`.

**No bundler.** The build concatenates; it does not transform. Minification, if ever added, precedes
hashing (`REQ-112`).

---

## 4. The build

`PATTERN.md` §5.11: from a clean checkout, with no install step, produce the artifact.

```
node build.js
  ├─ read fragments in the declared order
  ├─ read styles/main.css
  ├─ read index.html (the shell template)
  ├─ inline CSS            -> <style>
  ├─ concatenate JS        -> <script>
  ├─ compute appHash       -> sha256 over the concatenated JS bytes
  ├─ compute policyHash    -> sha256 over the final script bytes
  ├─ write meta tags
  └─ write dist/trip-planner.html
```

| Rule | Why | Requirement |
|---|---|---|
| Zero dependencies | "It builds from nothing" is a claim a reviewer can check in one command | `REQ-107` |
| Fail on unresolved placeholder | See §1 | `REQ-109` |
| Hash the final bytes | Hashing before minification produces a policy that rejects the app | `REQ-112` |
| One order list, shared with tests | Build and harness cannot drift | `REQ-108` |
| Vendor schemas at build time and inline them | Validation works offline; a schema update is deliberate | `REQ-115` |

The **initial** artifact's container is empty in the sense that matters: it carries the shell's
build metadata and a payload for a new, empty trip. Every subsequent export carries a real history
(§5).

Development dependencies — the test runner, the validator cross-check, the browser matrix driver —
are permitted and never enter the artifact (`REQ-807`). `PATTERN.md` §5.11 states the split
explicitly because "dependency-free" is otherwise read as applying to the whole repository, which
would make browser-matrix testing impossible.

---

## 5. Export from the pristine DOM

`PATTERN.md` §5.7. Implements `REQ-505`–`REQ-510`.

```
1. PRISTINE = clone of the document root
   — the FIRST statement of the application (boot.js fragment, before any other),
     before any DOM mutation, before any theme class, before any rendering.

export(container):
  clone = PRISTINE.cloneNode(true)
  clone.querySelector('#app-data').textContent = escapeForScriptBlock(serialize(container))
  return '<!DOCTYPE html>\n' + clone.outerHTML
```

Capturing first is unrecoverable if done late. An export built from the live DOM carries whatever
state the session happened to be in — rendered rows, an applied theme, a dirty indicator — and stops
being deterministic.

### 5.1 The export verifies itself before offering a download

| Check | Catches |
|---|---|
| Re-parse the assembled document | Escaping that broke the block boundary |
| The data block re-parses as JSON | A payload that cannot be read back |
| The extracted container equals the one passed in | Silent serialization loss |
| The script text is **byte-identical** to the running artifact's own | A clone that captured mutated markup |
| The declared app hash matches the computed one | A build/export mismatch |

The last check is what makes the approach auditable: the application code is a constant, only the
data block changes between exports, so the policy hash baked into the artifact stays valid in every
file it produces. **The hash is a property of the build, not of the export** (`PAT-INV-08`,
`REQ-110`).

### 5.2 The fallback

Some configurations suppress downloads from `file://` (`PATTERN.md` §5.7; see `10-open-questions.md`
Q-2). Where that happens — and *deliberately*, as a first-class path rather than only on failure —
export presents the **full document text with a copy action** (`REQ-509`, `REQ-519`). Under `file://`
this is the preferred path (`REQ-510`); the download path is used when served, and additionally when
the File System Access API is available (`REQ-607`).

---

## 6. Boot sequence

`PATTERN.md` §5.7 and `PAT-INV-14`. Implements `REQ-506`, `REQ-612`, `REQ-404`.

```
boot():
  0. PRISTINE = clone(document.documentElement)     <- FIRST statement, nothing before it
  1. container = containerCodec.read()
       - locate the block by string scanning of the raw document source
       - parse into null-prototype objects (REQ-503)
       - guard: size, commit count, nesting depth   (REQ-517)
  2. integrity = verify.chain(container.history)
       - failure -> read-only mode, name the offending commit, stop  (REQ-317)
  3. storage = adapter.choose()                      (REQ-402)
       - unavailable/throwing is a configuration, not an error path  (REQ-403)
  4. reconcile(container.history, storage.localHistory())
       - one of: adopt / keep-and-offer-updated-file / register-separately
       - DIVERGED -> block and ask
  5. interactive = true
       - only now does any view render, any listener attach, any toast fire
```

Three properties this sequence must hold:

1. **Nothing mutates the DOM before step 0.** The pristine capture is the first statement of the
   first fragment. A single earlier mutation — a theme class, a "loading" state — silently poisons
   every future export.
2. **Storage is reached fourth, not first.** Every outcome is computed from the file's history plus
   whatever local history exists, *including none* (`PAT-INV-02`). If storage throws at step 3, the
   sequence continues with the null adapter and still reaches a correct outcome.
3. **The UI is not interactive before step 4 completes** (`REQ-612`). Reconciliation running against
   a half-initialised store is the failure `PAT-INV-14` names.

### 6.1 The present boot

`app/main.js:8-38` today: clear the watchdog, print a storage banner, `initStore()`, register the
change listener, `initShell()`, `renderAll()`. Storage is reached **first**, there is no container,
no integrity step, no reconcile, and the DOM has already been mutated by the time anything
interesting happens. It is a correct boot for a hosted app and the wrong shape for this one.

---

## 7. The policy

`PATTERN.md` §5.9 layer 3, §11 P-1/P-2. Implements `REQ-105`, `REQ-112`, `REQ-708`, `REQ-713`.

```
default-src 'none';
script-src  'sha256-{{policyHash}}' 'wasm-unsafe-eval' {{scriptEndpoints}};
style-src   'sha256-{{styleHash}}';
img-src     data:;
connect-src {{aiEndpoints}};
form-action 'none';
base-uri    'none';
frame-ancestors 'none';
```

Four things must be stated plainly rather than implied:

1. **The policy in the file cannot constrain the file's author.** An attacker authoring a hostile
   document writes the CSP meta tag themselves and permits their own script's hash. This is why the
   import path, not the policy, is the primary mitigation (`REQ-710`, `08-security.md`).
2. **`connect-src` is a build-time constant**, taken from a declared `AI_ENDPOINTS` list, because a
   CSP is static bytes and cannot be computed from user configuration at runtime. The default list is
   the endpoints this app can actually be configured to use: the Ollama Cloud host, the local Ollama
   origin, the WebGPU CDN, and the model-weight hosts. **A user-supplied base URL or CORS proxy
   outside that list cannot be covered by a static policy** — recorded as Q-4 in
   `10-open-questions.md`.
3. **`script-src` is not only the hash.** The WebGPU transport loads `@mlc-ai/web-llm` with a runtime
   `import()`, and **a dynamic module import is a script fetch, governed by `script-src` (specifically
   `script-src-elem`), not by `connect-src`**. Naming the CDN only as a connect target — which is what
   this policy did before `ADR-0020` — refuses the module before any network request, and the served
   AI cannot load. So `script-src` also carries `'wasm-unsafe-eval'` (web-llm runs on a WASM runtime,
   and `WebAssembly.instantiate` is governed by `script-src` too) and a declared `SCRIPT_ENDPOINTS`
   list, kept **separate** from `AI_ENDPOINTS` because naming a script host grants it
   code-execution rights inside our page, while naming a connect host grants only reachability.
   `esm.run` 301s to `cdn.jsdelivr.net` and CSP checks the redirect target, so both hosts are named.
4. **The policy is not the feature gate.** Under `file://` the AI subsystem is disabled
   *behaviourally* — the tab is not rendered and no code path reaches a fetch (`ADR-0015`). The
   policy's `connect-src` exists for the served case. Conflating the two would mean the same bytes
   could not serve both environments, which `REQ-606` requires.

Whether a `<meta>`-delivered policy is enforced *at all* on `file://` is unresolved by the pattern
and unresolved here — `PATTERN.md` §11 P-2, carried as Q-3.
