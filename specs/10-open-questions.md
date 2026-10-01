# 10 — Open questions

The decisions this spec set deliberately does not settle, each with the cost of being wrong.

A question belongs here rather than in an ADR when **the design is correct either way** and only the
detail changes. `01-requirements.md`'s rule stands: if a choice is genuinely open and the design
*does* depend on it, it is an unfilled gap, not an open question. Every item below is carried because
the design already holds under both answers — which is why none of them blocks implementation.

| # | Question | Blocks |
|---|---|---|
| Q-1 | Can an opaque origin dynamically `import()` a CDN ES module? | Nothing |
| Q-2 | Are downloads suppressed under `file://`, and where? | Nothing |
| Q-3 | Is a `<meta>`-delivered CSP enforced under `file://`? | Nothing |
| Q-4 | Custom AI endpoints versus a static policy | Nothing |
| Q-5 | The three-way merge view | Nothing |
| Q-6 | Head-only export for privacy | Nothing |
| Q-7 | Signing | Nothing |
| Q-8 | Cross-instance coordination | Nothing |
| Q-9 | GPX as a third format | Nothing |

---

## Q-1 — Can an opaque origin dynamically import a CDN ES module?

**The question.** `web-llm` is loaded by a runtime `import()` of `https://esm.run/@mlc-ai/web-llm`
(`app/ai/webgpu.js:17,78`). Whether a page at an opaque origin may import a cross-origin module is a
platform behaviour, not a specified one, and it differs by browser.

**Why it is open.** It is unverified — `PATTERN.md` §11 asks for exactly this kind of question to be
tested per browser and recorded either way, and nothing in the repo records it. A module import is
subject to CORS, and an opaque origin sends `Origin: null`, which a CDN is entitled to refuse.

**What the design does meanwhile.** Nothing depends on the answer. The AI subsystem is disabled under
`file://` on three independent grounds, and the loading question is the *weakest* of them
(`07-ui.md` §3):

| Ground | Holds regardless |
|---|---|
| Security — a shared origin plus a stored key is an exfiltration vector | Yes |
| CORS — cloud and local endpoints both reject `Origin: null` | Yes |
| Loading — the import may fail | Irrelevant; 1 and 2 already decide it |

**If the answer is "allowed".** The gate does not change. The result is recorded in the matrix
(`09-testing.md` §5.1) and the AI stays off under `file://` for the other two reasons. The finding's
only use is preventing a future contributor from removing the gate on the grounds that web-llm "works
from `file://`".

**If the answer is "blocked".** Same outcome. The finding goes in the same place, and it strengthens
the explanation copy in `07-ui.md` §5.

**Cost of being wrong.** Low, and asymmetric. Guessing "allowed" would be the expensive error — it
would justify removing the gate — which is why the gate is not justified by the loading answer.

**How it would be resolved.** A two-line probe page loaded from `file://` in each matrix browser,
attempting the import and reporting. Recorded per browser, with the browser version.

---

## Q-2 — Is a download suppressed under `file://`?

**The question.** `PATTERN.md` §5.7 notes that downloads may be suppressed from `file://` in some
configurations. The present export (`app/io.js:240`) creates a `Blob` and clicks a synthetic
`<a download>`, and there is **no fallback**: if the click does nothing, the user sees nothing happen.

**Why it is open.** It varies by browser, by configuration, and by whether the download prompt is
enabled. No specification fixes it.

**What the design does meanwhile.** The export path has **two exits**, and the text + copy path is
always reachable deliberately — not only as a fallback (`REQ-509`, `REQ-510`). This is the right design
under either answer:

| If downloads… | Then |
|---|---|
| work everywhere | The download is offered first and the text path is a deliberate alternative |
| are suppressed somewhere | The text path is the one that works, and it is already built and reachable |

Building the fallback first, rather than adding it after a bug report, is the whole point. A user who
cannot save their document has lost their work, and they will not diagnose a suppressed download.

**Cost of being wrong.** Low. Ordering the two exits by a guess is cheap; **not having** the second exit
is the expensive mistake, and the design avoids it unconditionally.

**How it would be resolved.** Matrix check 6 (`09-testing.md` §5): attempt the download and record
whether a file was produced, per browser. The finding sets which exit is presented first under
`file://`, and nothing else.

---

## Q-3 — Is a `<meta>`-delivered CSP enforced under `file://`?

**The question.** The artifact delivers its policy through a `<meta http-equiv="Content-Security-Policy">`
as its first element (`REQ-105`). Whether browsers enforce a meta-delivered policy on a `file://`
document is not something this design can assume.

**Why it is open.** `PATTERN.md` §11 carries it as open at the pattern level. Meta-delivered policies
are generally supported, but `file://` is a special case in several engines, and the pattern's whole
premise is a document that runs from `file://`.

**What the design does meanwhile.** Nothing depends on it, because **the policy was never the
mitigation** (`08-security.md` §1). Layer 1 — import, don't open — is. The policy is defence in depth
against the application's own mistakes:

| If the policy is… | Then |
|---|---|
| enforced | It constrains our own code, which is what it is for |
| not enforced under `file://` | It still constrains the served build, and layer 1 still carries the hostile case |

**Cost of being wrong.** None to the design; some to a reader who mistakes the policy for a security
boundary. That is why `08-security.md` §9 states plainly that the policy cannot constrain the file's
author (`PAT-AP-10`) — a statement that is true regardless and is the one that matters.

**How it would be resolved.** A probe that attempts an operation the policy forbids and reports whether
it was blocked, run from `file://` in each matrix browser. The result is recorded; the design does not
change.

---

## Q-4 — Custom AI endpoints versus a static policy

**The question.** `connect-src` is a build-time constant derived from a declared `AI_ENDPOINTS` list
(`02-architecture.md` §7). A user who configures an endpoint outside that list is blocked by the
policy.

**Why it is open.** A static policy cannot accommodate a runtime-configurable endpoint list, and the
alternative — a permissive `connect-src` — gives up the policy's value against our own mistakes. The
choice is between two real costs, and which is worse depends on how many users configure a custom
endpoint, which is not known.

**What the design does meanwhile.** The declared list covers the transports the app ships: Ollama Cloud,
local Ollama, and the CDN that serves `web-llm`. A user on a custom endpoint is told the policy blocks
it and given the reason. That is worse than working and much better than silent failure.

The feature gate itself is unaffected: `REQ-606` requires the *same code* to enable AI when served, and
it does. This question concerns only which endpoints the policy admits.

**Options.**

| Option | Cost |
|---|---|
| Declared list, custom endpoints blocked (**current**) | A user with an unusual setup cannot use AI. Honest and explained |
| Permissive `connect-src` | The policy stops constraining the app's own network surface |
| Per-user policy rewrite | Contradicts `REQ-110` — the app code would differ between exports, and the artifact would no longer be one artifact |
| Endpoint allowlist widened at build | Only helps if the endpoint is known before the build |

**Cost of being wrong.** Moderate and user-visible. Shipping the narrow list and discovering demand is a
feature request; shipping permissive and discovering the policy was load-bearing is not recoverable,
because the policy is in files already distributed.

**How it would be resolved.** Usage, or a stated preference from whoever runs the served deployment.

---

## Q-5 — The three-way merge view

**The question.** `04-versioning.md` §7.3 requires that divergence stops and prompts. It requires only
the *coarse* prompt in the first version — "choose one side entirely" — and defers the three-way compare
with per-field suggestions.

**Why it is open.** `PATTERN.md` §8.2 explicitly permits the deferral: "a 'choose one side entirely'
prompt is coarse but safe."

**What the design may not defer.** That divergence **stops** (`PAT-INV-04`, `REQ-313`). A coarse prompt
that discards one side is safe; an automatic merge is not, and neither is picking a winner by timestamp
(`PAT-DEC-05`).

**Cost of being wrong.** Low. The coarse prompt is correct, merely unhelpful for two large divergent
edits. Nothing is lost that the user did not choose to lose.

**How it would be resolved.** On the first real report of a divergence that hurts — that is, after the
coarse prompt has been used in anger and found insufficient.

---

## Q-6 — Head-only export for privacy

**The question.** History is append-only, so every commit — including author names and any text ever
written — travels in every copy forever (`REQ-321`). A head-only export would produce a document whose
payload is present and whose history is not.

**Why it is open.** It is a genuinely separate feature with a genuine cost: a head-only file **cannot
be reconciled** with the full-history file it came from. Its history is a new root, so the two are
unrelated documents as far as `compare()` is concerned.

**What the design does meanwhile.** Nothing. The feature does not exist, and — importantly — **the
destructive alternative does not exist either**. `PATTERN.md` `PAT-AP-05` is a "strip authors" or
"redact" button that rewrites history and thereby fragments every copy in circulation. The spec forbids
it (`REQ-314`). The absence of that button is the design decision; head-only export is the correct
answer to the need it would have addressed.

**Cost of being wrong.** Low, and one-directional. Not shipping head-only export means a user with a
privacy need has no answer. Shipping the destructive button instead would be a permanent, silent
incompatibility between copies — which is why the spec forbids it now rather than waiting to see.

**How it would be resolved.** A concrete privacy requirement from a user or a deploying organisation.

---

## Q-7 — Signing

**The question.** Nothing signs the chain, so this is **integrity, not authorship** (`08-security.md` §7).
An attacker can rebuild the chain with a different author name at trivial cost, because they can compute
every hash themselves.

**Why it is open.** `PATTERN.md` `PAT-DEC-09` is explicit: if the document is evidence, it must be
signed, "and accept that the file and its tooling both grow a key-management surface". A trip plan is
not evidence. Adding signing adds key generation, key storage, key loss, revocation and a trust model —
to a file whose premise is that it is one portable document.

**What the design does meanwhile.** It **labels honestly**. The UI says *"chain intact"* and never
*"verified"* (`REQ-320`). The residual-risk list states the gap in the same words (`08-security.md` §10).

This is the important part: the honest label costs nothing and must be present from the first version,
because retrofitting it after users have trusted the stronger word is not possible.

**Cost of being wrong.** Low, and it is a cost of *not* doing it rather than of doing it wrongly. The
exposure is that a user over-trusts a document, which the label is designed to prevent.

**How it would be resolved.** A requirement that a document be provably authored. At that point signing
is added and the "chain intact" label becomes "signed by <key>", which is a strictly stronger claim and
requires no relabelling.

---

## Q-8 — Cross-instance coordination

**The question.** Two tabs, two windows, one store. `05-storage.md` §7 takes the reference
implementation's position: detect and **refuse**, rather than coordinate. `PATTERN.md` §11 P-7 carries
cross-instance coordination as explicitly unresolved.

**Why it is open.** Coordination requires a messaging or locking primitive that works across a
partitioned or absent store, which is the same problem the whole design avoids by keeping the file as
the carrier.

**What the design does meanwhile.** A writer field on the document pointer; a second writer refuses with
an explanation and offers to reload. Refusing is the conservative choice because the alternative —
silent last-writer-wins — is `PAT-AP-02`'s failure (one person's work vanishes) arriving through a
different door.

**Cost of being wrong.** Low. The cost of refusing is a user reloading a tab. The cost of the
alternative is a lost edit with no notification, which is the failure the design exists to prevent.

**The tempting wrong answer.** A small sync server. `PATTERN.md` `PAT-AP-04` names this exactly:
"the pattern's entire premise erodes one convenience at a time; the file becomes a cache of the server."
The pattern's own guidance is to decide consciously — either this pattern, or a hosted tool — because
"both are defensible; drifting between them is not." This instance has decided: it is this pattern, and
a sync server is out of scope rather than pending.

**How it would be resolved.** Not likely to need resolving. The file-based flow — export, send, import —
is the intended path for two people, and it does not involve two instances sharing storage at all.

---

## Q-9 — GPX as a third format

**The question.** A road-trip planner plausibly wants routes and waypoints. GPX is the obvious format
for them. `PAT-DEC-14` says two formats is a good number, and that "formats with a broken upstream
export path are deferred, not half-done".

**Why it is open.** The deferral is about the **upstream export path**, not about the format. A
half-done GPX mapper — one that imports tracks and drops the canonical model's budget, bookings, and
history without a ledger column for them — is worse than no GPX support, because it produces
nearly-empty documents and the user concludes the app lost their data.

**What the design does meanwhile.** The ledger (`06-interchange.md` §3) is the prerequisite, and it is
written for two formats. Adding a third is then mechanical: three more columns, every field
classified, and the round-trip properties extended to a third format. That is the point of writing the
ledger before the mappers.

**Cost of being wrong.** Low. Two formats cover the domain's actual exchanges — calendars and this app's
own JSON. GPX adds a capability nobody has asked for yet.

**How it would be resolved.** A concrete need to move route data in or out, plus a decision about which
GPX subset the upstream path actually produces.

---

## What is not here

Two categories of thing that look like open questions and are not:

| Not a question | Because |
|---|---|
| Whether to gate AI under `file://` | Decided (`ADR-0015`). The question here is only whether the *loading* premise holds (Q-1), which does not change the decision |
| Whether the payload is one trip or many | Decided (`ADR-0016`) |
| Whether history is a DAG or a list | Decided (`ADR-0003`). A merge creates a two-parent commit; a list cannot represent it |
| Whether to use `crypto.subtle` | Decided (`ADR-0004`). The call sites need synchronous hashing |
| Whether to keep IndexedDB | Decided (`ADR-0012`). It is blocked on some `file://` origins, which is the environment this pattern targets |
| Whether a hosted CDN stylesheet is acceptable | Decided (`ADR-0002`). Offline is a hard requirement here |

Each is recorded in an ADR with its forces and its cost. A reviewer who disagrees should disagree with
the ADR, not reopen the question here — the difference is that an ADR has to state what it gives up.
