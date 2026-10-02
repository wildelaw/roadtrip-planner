# 08 — Security

The threat model, the two layers, the guards, and the residual risks.
Implements `REQ-701`–`REQ-712`, `PAT-INV-09`, `PAT-AP-07`, `PAT-AP-10`.

---

## 1. The posture, stated plainly

Two facts drive everything below, and neither is a caveat:

1. **An exported document is an executable HTML file.** Opening one means running its code, with the
   same privileges as any page the user visits.
2. **A hostile file writes its own policy.** The CSP meta tag is *in* the file. An attacker exporting
   a modified artifact simply writes a policy that permits their own script's hash. `PATTERN.md`
   §5.9 is explicit about this: the policy "cannot constrain the file's author."

So the CSP is **not** the mitigation. It is defence in depth against a mistake the app might make,
not against a document someone else crafted.

> **Layer 1 is the mitigation: import, don't open.**

The app reads hostile input as *text* (`06-interchange.md` §5.1) and never as code. Everything in this
spec is downstream of that. If layer 1 is right, the rest is belt and braces; if layer 1 is wrong, no
policy saves it.

This is also, unavoidably, a **user-facing instruction**, and the spec has to own that rather than
pretend the software can enforce it: the README and the import dialog both say *import a document
someone sent you; do not open it.* `PATTERN.md` §10 counts this honesty as one of the pattern's real
costs.

---

## 2. Threat model

Assets, in the order a reviewer should care about them:

| Asset | Where it lives |
|---|---|
| The user's trip data, including the only copy of a plan | The file, and the local cache |
| The API key for a cloud AI service | `localStorage`, `tp.app.settings` (`app/settings.js:4`) |
| Every other local file, under a shared `file://` origin | Reachable by any page in that origin |
| The integrity of the user's history | The chain, unaided by signatures (§7) |

| # | Threat | Layer | Mitigation | Requirement |
|---|---|---|---|---|
| T1 | A crafted artifact runs script in the app's origin | 1 | Text-only import; the document is never inserted into the DOM, never parsed as markup, never executed | `REQ-501`, `REQ-502` |
| T2 | A payload string reaches the DOM as markup | 2 | The render seam; a static check over the built artifact | `REQ-701`–`REQ-704` |
| T3 | A hostile payload pollutes the prototype | 2 | Null-prototype reconstruction; no deep merge; patch paths validated | `REQ-705`, `REQ-706` |
| T4 | A hostile file hangs the tab | 2 | Resource guards, each failing with an explanation | `REQ-517`, `REQ-518`, `REQ-707` |
| T5 | Another local page reads the stored API key | 1 | AI is disabled under `file://` (`ADR-0015`), so no key is ever stored in a shared origin | `REQ-602`, `REQ-708` |
| T6 | A served-mode XSS steals the stored key | 2 | Same as T2 — the render seam is the control; the key is a downstream prize | `REQ-701` |
| T7 | History is altered in transit | 2 | Detected, not prevented — the chain fails verification | `REQ-316`, `REQ-712` |
| T8 | A commit is attributed to someone who did not write it | — | **Not mitigated.** No signing | `REQ-321`, Q-7 |
| T9 | A hostile *document read by the AI* instructs the agent to do something | 2 | AI output is data; it passes the validators and requires confirmation before a commit | `REQ-712` |

T5 is why the `file://` gate is a security requirement and not merely a convenience. Under Chrome and
Edge, every local file shares one origin (`PATTERN.md` §5.1), and §5.9 notes a crafted document reads
every other document in that origin. A key field plus a shared origin is a self-inflicted exfiltration
vector — and it would be created by the feature meant to be convenient.

---

## 3. No markup from payload

`PATTERN.md` §5.9, `PAT-INV-09`. Implements `REQ-701`–`REQ-704`.

| Rule | |
|---|---|
| Exactly one code path takes data to the DOM — `ui/render.js` (`07-ui.md` §6.2) | `REQ-701` |
| `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` are forbidden | `REQ-702` |
| `renderMarkdown` builds nodes; it does not return an HTML string | `REQ-704` |
| The check is **static, over the built artifact**, with a one-entry allowlist | `REQ-703` |

### 3.1 Why "escaped by convention" is not enough

The present app is not reckless. It has `escapeHTML` (`app/utils/format.js:3`) and it uses it at
almost every interpolation, across roughly forty `innerHTML` sites in `app/ui/*.js`
(`07-ui.md` §6.1 lists them). The technique is defensible.

It is rejected here for one reason, and the reason is measurable: **the safety of escaped-by-convention
depends on every future call site, forever.** Three sites already interpolate unescaped values —
`bookings.js:215`, `charging.js:156`, `itinerary-day.js:143` — and they are safe today only because
their arrays happen to be internal constants. That is precisely the shape of the bug: correct until
someone renders a user-supplied list.

`PATTERN.md` §5.9 names the failure mode as "one missed field". A rule that a static check can verify
is worth more than a convention that cannot.

`renderMarkdown` (`app/utils/format.js:35-62`) deserves a specific note: it is safe by construction —
it escapes first and then introduces markup from a whitelist — and that discipline is preserved. What
changes is its **return type**. Returning an HTML string makes it a hole the static check has to
special-case; returning a node removes the hole.

### 3.2 The one permitted exception

`clone.outerHTML` in the export path (`06-interchange.md` §6) serializes a document the app itself
built from a fixed shell template. It is the single entry in the check's allowlist, and it is
allowlisted by **call site**, not by API — so a second `outerHTML` anywhere fails the build.

This is why `REQ-703` runs over the built artifact. A grep over sources can be defeated by a
concatenation the build joins; the artifact is what ships, and it is what the check must read.

---

## 4. Prototype pollution

`PATTERN.md` §5.9. Implements `REQ-705`, `REQ-706`.

Hostile JSON and hostile patch paths are two doors to the same room.

| Door | Guard |
|---|---|
| `JSON.parse` of an imported container | Parse, then reconstruct into **null-prototype** objects, or copy fields explicitly. `JSON.parse` produces a `__proto__` key happily, and it is a real own-property until something merges it |
| A patch `path` segment naming `__proto__`, `constructor`, or `prototype` | **Reject the commit.** The check is one comparison, and it runs before any path is walked |
| Any deep merge anywhere | **Does not exist.** Field-by-field copying only |

The patch-path guard is the reason `path` is an **array of segments** rather than a JSON Pointer
string (`04-versioning.md` §4.1). Comparing a segment to `"__proto__"` is a comparison; comparing it
inside an escaped pointer is a parse, and parses are where the bug lives.

The "no deep merge" rule is the one most likely to be violated by a well-meaning contributor adding a
settings-merge helper. It is stated as a requirement (`REQ-706`) for that reason: `PAT-AP-07`'s
symptom — "a hostile payload pollutes the prototype" — arrives through convenience, not through
malice.

---

## 5. Resource guards

`PATTERN.md` §5.9. Implements `REQ-707`, and cross-references `REQ-517`, `REQ-518`.

> "A hostile file can hang a tab. Every limit fails with an explanation and an offer to export what was
> readable, never a blank page."

The table of bounds is in `06-interchange.md` §5.4. The rules that make those bounds matter:

| Rule | |
|---|---|
| Every guard fails **with an explanation**, naming the limit and the actual value | A silent refusal looks like a crash |
| Every guard fails **per-item** where it can | One absurd commit does not block the readable ones |
| After any guard, the user is offered export of what was readable | The alternative is a user losing a plan to the app's own defence |
| Guards bound *before* the expensive operation | A depth check that runs after the recursion is not a guard |

---

## 6. Showing untrusted source

Implements `REQ-707` (source-length bound).

The history and import views show container internals — commit records, patch operations, bag contents
— as **source text**. That text came from a file someone may have sent.

| Rule | |
|---|---|
| Shown as text, through the render seam | Never syntax-highlighted by string substitution |
| Truncated at a declared length, with the truncation stated | Rendering a 40 MB bag is a hang (T4) |
| Attributed to the format it came from | A bag is opaque (`REQ-207`); the UI says where it came from and does not interpret it |

This view is where T2 and T4 meet: the content is both hostile and potentially enormous. Both rules
apply, and neither is optional.

---

## 7. What the chain does and does not prove

`PATTERN.md` §5.10, `PAT-DEC-09`. Implements `REQ-712`, and cross-references `REQ-320`, `REQ-321`.

| Property | Provided |
|---|---|
| The history has not been altered since it was written | **Yes** |
| It is internally consistent and complete | **Yes** |
| Corruption or truncation is detected | **Yes** |
| The named author actually wrote it | **No** |
| The history was not fabricated wholesale | **No** |

Because commit ids cover the author field, an attacker who wants a different name must rebuild the
chain — which is trivial, because **nothing signs it**.

The UI says **"chain intact"** and never **"verified"** (`REQ-320`). The gap between those two words
is the entire security property, and a user who reads the stronger word cannot be un-taught it.

**Authorship spoofing (T8) is accepted, not mitigated.** Signing is deferred (`10-open-questions.md`
Q-7); `PAT-DEC-09` is explicit that a document meant as evidence must be signed, and a trip plan is
not evidence. That is a choice, and it is recorded as one rather than left for a reviewer to discover.

---

## 8. The AI surface

Implements `REQ-708`, `REQ-712`. Cross-references `ADR-0015`.

The AI planner is the one subsystem that (a) reaches the network, (b) holds a credential, and (c) can
write into the payload. Each earns a rule.

| Rule | |
|---|---|
| **No AI from `file://`, enforced below the UI** | `ai/transport.js` refuses when `!env.aiEnabled`, so no code path reaches `fetch` or the CDN `import()` even if a UI guard is bypassed (`REQ-708`) |
| **Credentials are never in the document** | The container omits per-user state (`REQ-211`); conversations and settings stay app-local (`REQ-410`) |
| **AI output is data, and is validated** | Tool results pass the same validators as an imported file (`06-interchange.md` §7) before they reach the model |
| **Nothing the AI produces is committed without confirmation** | `PAT-DEC-06`'s rule, applied: suggestions may be pre-selected, but a commit is a user action |
| **Fetched web content is hostile input** | `web_search` / `web_fetch` results are attacker-controlled text. They are shown as text, never executed, and never treated as instructions to the application |

The last row is the one worth naming: a document the agent reads may contain text designed to steer it.
The defence is structural rather than clever — the agent's output is *data* that must pass a validator
and a user's confirmation, so a successful injection produces a suggestion the user declines, not a
committed change.

---

## 9. The policy, and what it is for

`PATTERN.md` §4.1, §5.9, `PAT-AP-10`. Implements `REQ-709`, `REQ-710`.

| Rule | |
|---|---|
| The meta CSP is the **first** element in `<head>`, before any script | `REQ-709` |
| The app script is a pinned hash; there is exactly one inline script | `REQ-709` |
| No inline `on*` handlers, no `eval`, no `new Function`, no dynamically created `<script>`. The policy's `'wasm-unsafe-eval'` permits **WebAssembly compilation only** — the two JS constructs stay banned and swept for | `REQ-710`, `REQ-106` |
| `script-src` is the hash plus `'wasm-unsafe-eval'` plus a declared `SCRIPT_ENDPOINTS` list (a subset of the connect list), so the WebGPU transport's module import and WASM runtime are permitted | `REQ-713` |
| `connect-src` is a **build-time constant** | `02-architecture.md` §7 |

Four things to state plainly rather than let a reader assume:

1. **The policy cannot constrain the file's author** (`PAT-AP-10`). A hostile exporter rewrites it
   freely. It is a defence against *our* mistakes.
2. **The policy is a property of the build, not of the export.** It does not and cannot travel with a
   user's edits (`PAT-INV-08`'s distinction, applied). A user who changes their AI endpoint in
   Settings is not changing the file's policy.
3. **Feature gating is behavioural, not policy-enforced.** `file://` disables AI by construction — the
   transport refuses — not by the CSP. A policy that tried to do this job would be doing it in the
   wrong layer, and would be rewritten by the first hostile exporter.
4. **`script-src` names a third-party code origin, and that is a deliberate cost** (`ADR-0020`). The
   in-browser model is a CDN module and runs on WASM, so the policy must admit `esm.run`,
   `cdn.jsdelivr.net` and `'wasm-unsafe-eval'`; before `ADR-0020` it admitted none of them and the
   served WebGPU transport was dead. The cost is that a future regression that creates
   `<script src="https://cdn.jsdelivr.net/…">` would now execute where it previously could not — so
   the layers that actually keep data from becoming a script element are the render seam
   (`REQ-701`–`REQ-703`) and the banned-API sweep (`REQ-106`), *not* this policy. Note that the sweep
   does not currently ban `document.createElement('script')`; the render seam is the operative
   guard. This changes nothing about point 1: a hostile author rewrites the policy anyway.

Point 2 has a consequence the spec accepts and records: a custom AI endpoint outside the declared list
is blocked by the policy. That is `10-open-questions.md` Q-4.

---

## 10. Residual risks

The list a reviewer should press on, with the honest answer for each.

| Risk | Accepted because | Would need |
|---|---|---|
| An exported document executes if a user **opens** it | The pattern's whole premise is a self-contained executable file. Import-don't-open is layer 1, and it is a user instruction the software cannot enforce | Nothing available — this is inherent |
| History is integrity-checked, not signed | A trip plan is not evidence (`PAT-DEC-09`) | Signing, and the key-management surface it brings (Q-7) |
| An author name in a document is unverified | Same | Same |
| A shared `file://` origin exposes local storage to any local page | Mitigated for the credential (no AI under `file://`), not for trip content a user typed | Browser-level origin isolation, or not using `file://` |
| A served-mode XSS could read the stored API key | The render seam is the control; a key in `localStorage` is readable by any script in the origin | Moving the key out of the origin, which a static file cannot do |
| A user's clock is wrong | Timestamps are displayed and never decisive (`PAT-DEC-05`) | Nothing — the design already refuses to depend on the clock |
| Storage may be unavailable, partitioned, or shared | The file is the carrier (`PAT-INV-01`); every operation reaches a correct outcome without storage | Nothing — this is a designed-for configuration |
| A hostile document can steer the AI | Output is validated data requiring confirmation (§8) | A sandboxed agent, out of scope |

Every row is a decision. None is an oversight, and each is named here so that a reviewer can disagree
with a specific one rather than with a vague sense that the design is trusting.

---

## 11. Present state

| Requirement | Today |
|---|---|
| `REQ-701`–`REQ-704` | ~40 `innerHTML` sites in `app/ui/*.js`, escaped by convention via `escapeHTML` (`app/utils/format.js:3`); three unescaped interpolations of internal constants (`bookings.js:215`, `charging.js:156`, `itinerary-day.js:143`); `renderMarkdown` returns an HTML string (`app/utils/format.js:35`) |
| `REQ-703` | No static check exists, and no build exists to run one over |
| `REQ-705`, `REQ-706` | No container import exists yet; `clone()` is `JSON.parse(JSON.stringify(…))` (`app/io.js:289`) into ordinary-protype objects. The guard is needed before the container exists, not after |
| `REQ-707` | No guards of any kind. A large file is parsed until it fails |
| `REQ-708` | `navigator.gpu` detection (`app/ai/webgpu.js:19-21`) but no protocol check. The CDN `import()` at `app/ai/webgpu.js:17,78` runs wherever it is reached |
| `REQ-709`, `REQ-710` | No CSP at all. `index.html` has two inline scripts (`:64-71` and, on import, `:73`'s module) and no policy |
| `REQ-711` | The security note at `README.md:121-133` covers the API key; nothing covers import-don't-open, because there is nothing to import |
| `REQ-712` | No chain, so no label. The nearest honest-label question — "verified" — has not arisen |

One incidental finding, carried because it will mislead anyone auditing the AI surface: `app/ai/webgpu.js:80`
reports "check that esm.sh is reachable" while the URL actually imported is `esm.run` (jsdelivr) at `:17,78`.
The message is a stale copy of an earlier implementation. It is a diagnostic string, not a vulnerability,
but it is exactly the kind of detail that makes a reader distrust the rest of the file.
