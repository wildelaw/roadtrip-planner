# 09 — Testing

What is tested, how, and what testing cannot establish.
Implements `REQ-801`–`REQ-810`.

---

## 1. The division

`PATTERN.md` §5.11. The pattern splits cleanly in two, and the split is the test strategy:

| Part | Testable | Depends on |
|---|---|---|
| Model, serialization, hashing, DAG, patches, reconciliation | **Entirely, without a browser** | Nothing |
| Artifact assembly, DOM, boot, storage, gating | Only in a real browser, on a real protocol | Browser × protocol |

The first column has **no** DOM, no `window`, no storage, no `fetch`. If a core module cannot be loaded
in a bare Node process, the module is wrong, not the test. This is what makes `04-versioning.md`'s
"least room for error" claim actionable — the risky logic is the logic that can be tested completely.

The second column cannot be unit-tested into confidence, and this spec does not pretend otherwise: a
jsdom environment reproduces the DOM and none of the platform behaviours the design turns on (origins,
protocol, quota, download suppression). Those are verified in the matrix (§5).

---

## 2. Property tests

`PATTERN.md` §8.1 step 11. Implements `REQ-802`.

Properties, not examples — because the failures this design must survive are the ones nobody thought to
write an example for.

| # | Property | Why it is the test |
|---|---|---|
| P1 | `canonicalSerialize(x) === canonicalSerialize(y)` whenever `x` and `y` are equal as model values | Key order in memory must never change a hash. This is the property that makes `REQ-305` real |
| P2 | Reconstructing a payload from any commit yields a value whose `payloadHash` equals the commit's declared one | The core round-trip, over randomly generated histories |
| P3 | Appending a commit never changes any existing commit's id | `PAT-INV-06`, append-only, enforced |
| P4 | Compacting a chain changes **no** id, and reconstruction is unchanged | The payoff for `REQ-302`; if this fails, the hash covers the representation and compaction is unsafe |
| P5 | Applying a patch and then its inverse returns the original payload | Patch correctness, including array splices at the ends |
| P6 | For any two heads, `compare()` returns exactly one of IDENTICAL / A-newer / B-newer / DIVERGED, and is antisymmetric | `PAT-INV-03`. A generator producing DAGs with merges is the only way to cover this |
| P7 | A merge commit is always a keyframe | `04-versioning.md` §4.2 rule 2 |
| P8 | Any single-bit change to any commit's stored bytes makes chain verification fail, and names that commit | Tamper detection (`REQ-316`) |
| P9 | Every round-trip through `trip-data.json` is lossless for a randomly generated conforming payload | `REQ-504`, `REQ-513` |
| P10 | Bags survive every export/import pair unchanged | `REQ-205` |
| P11 | Every field the ledger calls **M** round-trips; every **D** is reported at export and absent afterwards; every **F** re-folds and un-folds to the same value | **The ledger is executable** (`REQ-809`) |

P4 is the one that would be written last and matters most: it is the only direct test of the claim that
the hash covers the semantic payload rather than the storage representation (`PAT-INV-07`). If it
fails, compaction silently desynchronises every copy in circulation, and the symptom appears months
later as unexplained verification failures.

---

## 3. Fault injection

`PATTERN.md` `PAT-INV-13`. Implements `REQ-803`.

The write orderings in `05-storage.md` §5 are stated as rules precisely because the natural ordering is
wrong in a way that is invisible until an interruption. So every step of both orderings is interrupted,
in a test, deliberately.

| Fault injected | Assertion |
|---|---|
| Interrupt after each `set` in an append | The document still opens; chain verification passes; no commit reported as written is missing |
| Interrupt after the pointer write, before the commits | Same — this is the ordering the rule forbids, and the test proves *why* by failing when the rule is inverted |
| Interrupt during a delete | The pointer is already updated; orphans are waste, not corruption |
| Corrupt a stored commit's bytes | Boot enters read-only mode (`REQ-317`), names the commit, and **writes nothing** |
| Remove a key the pointer references | Same |
| Force a `QuotaError` on write | The write fails visibly, the in-memory copy is intact, nothing is dropped |
| Present a container with an unknown newer `format` | Opens read-only with an explanation (`REQ-212`) |
| Feed a container past each resource guard | Each fails with an explanation and offers export of what was readable (`REQ-707`) |

The second row is the load-bearing one. A suite that only exercises the correct ordering proves the
happy path and nothing about the rule.

---

## 4. Hostile input

`PATTERN.md` §8.1 step 10. Implements `REQ-805`.

| Test | Rule |
|---|---|
| A **parameterised sweep over every field** of the canonical model, each set to a hostile corpus | Every field, not a representative one. `PATTERN.md` §5.9's failure mode is "one missed field", and a representative sample is exactly the test that misses it |
| The corpus includes markup, script tags, event-handler attributes, `javascript:` URLs, control characters, RTL overrides, and very long strings | The last two catch rendering failures that are not security failures but look like them |
| Assertion: the field appears **as text** — the DOM contains a text node whose value equals the input | Not "no script executed"; the stronger, checkable claim |
| A payload with `__proto__` / `constructor` / `prototype` keys, at every depth | Rejected or neutralised; `Object.prototype` is unmodified afterwards (`REQ-705`, `REQ-706`) |
| A patch with a `__proto__` path segment | The commit is rejected before any path is walked |
| An artifact whose data block is truncated, duplicated, or interleaved with decoys | Detection is structural (`06-interchange.md` §2), so these are the cases that break a naive marker scan |

The `javascript:` row is worth its own note: the model has link-bearing fields, so the sweep covers
hrefs as well as text. A hostile URL is a *link* problem rather than a markup problem, and it is
missed by any test that only checks for tag injection.

The sweep is generated from the model's field list, so a field added without a test fails the build —
the same discipline as P11.

---

## 5. The browser × protocol matrix

`PATTERN.md` §10, §11. Implements `REQ-804`. This is the manual half, and it is manual for a reason:
**the design's central requirement is a platform behaviour**, and no unit test can establish a platform
behaviour.

| Browser | `file://` | served `http://localhost` | served `https://` |
|---|---|---|---|
| Chrome | open, boot, gate, import, export, storage | ✓ | ✓ |
| Edge | ✓ | ✓ | ✓ |
| Firefox | ✓ (per-path origin — the partitioned-storage message is exercised here) | ✓ | ✓ |
| Safari | ✓ | ✓ | ✓ |

Each cell runs the same checklist:

| # | Check | Requirement |
|---|---|---|
| 1 | The file opens and boots with **no console error** in the same bytes — the property the present app fails at `index.html:73` | `REQ-102` |
| 2 | The AI tab is **absent** under `file://` and **present** when served | `REQ-603`, `REQ-606` |
| 3 | Settings shows the explanatory callout under `file://`, and the connection card when served | `REQ-605` |
| 4 | Export produces a file that re-imports to an identical payload and history | `REQ-505`, `REQ-508` |
| 5 | Export's **text + copy fallback** works when the download does not | `REQ-509` |
| 6 | The download itself is attempted, and its suppression (if any) is *observed and recorded* | Q-2 |
| 7 | **Delete all local storage, reopen the file — nothing is lost** | `REQ-404` |
| 8 | Move or copy the file to a different folder and reopen — Firefox exercises the partitioned case; the explanation must appear | `REQ-615` |
| 9 | Import a document someone else sent, and confirm the imported content is never executed | `REQ-501` |
| 10 | Boot reports the storage mode in `#storage-status`, and the reconcile outcome | `REQ-612` |
| 11 | Served: the WebGPU module imports and a WASM module compiles under the artifact's own policy — the browser-driven half of this check needs no network | `REQ-713` |

Check 2 is the request's own requirement, and it is a matrix cell rather than a unit test because "the
same file behaves differently in two environments" is a claim about the environments.

Check 7 is the single manual check that proves the file is genuinely the carrier. It cannot be
automated: deleting the app's storage from inside the app is a different scenario from a user clearing
their browser data.

Checks 4 and 5 overlap deliberately. The export path has two exits, and the failure mode is a user
believing a file was written when the browser silently discarded it.

### 5.1 What the matrix must do with an unresolved row

Rows 6 and (under `file://`) parts of 2 rest on platform behaviours the design does not settle. The
rule is that an unresolved cell is **recorded with a result per browser**, not left blank:

| Behaviour | Where |
|---|---|
| Whether a dynamic ESM import of a CDN module works from an opaque origin | Q-1 — the *served* case is now answered (a policy defect, fixed by `ADR-0020`/`REQ-713`); the opaque-origin case remains unverified, and its answer changes nothing (`07-ui.md` §3.3) |
| Whether downloads are suppressed under `file://`, and in which configurations | Q-2 — changes which export exit is offered first |
| Whether a `<meta>`-delivered CSP is enforced on `file://` | Q-3 — changes what the policy accomplishes |
| Whether IndexedDB is reachable on this `file://` origin | Gates the migration (`REQ-411`) |

An unrecorded "it seemed to work" is how a design ends up depending on a behaviour nobody verified.
`PATTERN.md` §11 is explicit that these are open questions *for the pattern*; the instance's job is to
answer them for the instance and record the answer.

---

## 6. Validator cross-check

`PATTERN.md` `PAT-DEC-08`. Implements `REQ-806`.

The validators are hand-written (`06-interchange.md` §7). Their correctness is established once, in the
test suite, against a reference implementation over a corpus — never at runtime, because a runtime
validator dependency would be a second policy origin inside a file whose premise is that it has one.

| Rule | |
|---|---|
| The cross-check lives in the test suite only | Never in the artifact (`REQ-807`) |
| The corpus is the deliverable as much as the code | A thin corpus ships a divergence with a passing test — the failure mode `PAT-DEC-08` names: "a subtly wrong validator is worse than none because it gives confident wrong answers" |
| Minimum corpus | An artifact exported by this app; a `trip-data.json` of each generation in the repo's history; a hand-written `.ics` with recurrence, alarms, attendees and time zones; each malformed case from §4 |

`REQ-115` requires the schemas to be vendored and inlined so validation works offline. The cross-check
is what makes the vendored subset trustworthy: it proves the hand-written keyword subset agrees with a
full implementation *on the corpus*, and the corpus is where the disagreement would show.

---

## 7. Traceability

`PATTERN.md` §12. Implements `REQ-801`.

`01-requirements.md`'s table is machine-readable on purpose. The check parses it and asserts:

| Assertion | |
|---|---|
| Every `REQ-nnn` is unique | Duplicated ids make the table silently lossy |
| Every `REQ-nnn` is cited by at least one other spec | An uncited requirement is a requirement nobody implemented |
| Every `PAT-*` id cited anywhere under `specs/` exists in `PATTERN.md` | A citation to a non-existent invariant is a design that thinks it is following a rule that does not exist |
| Every `PAT-INV-01..14` and `PAT-DEC-01..14` appears in the traceability table | Silence is how a deliberately-unmet invariant goes unnoticed. An unmet one must appear as a named deviation in an ADR |
| Every `REQ-nnn` has a verification method from the declared set | A requirement with no method is a wish |

This is the same check as the manual pass in the plan's verification section, made mechanical so it runs
on every change rather than once at review. It is the check that keeps this spec set from rotting: a
requirement added later with no citation fails immediately.

---

## 8. The artifact's own tests

Implements `REQ-807`, `REQ-808`. The artifact is a deliverable with properties of its own, and they are
checked statically over the **built** file.

| Test | Rule |
|---|---|
| **No test tooling or dev dependency in the artifact** | `REQ-807`, `PATTERN.md` §5.11. Checked by scanning the artifact for test-only identifiers |
| **One declared fragment order** | `REQ-808`, `REQ-108`. The list is declared once and consumed by both the build and the harness — two lists that "should" match are two lists that will diverge, and the divergence presents as a suite testing a different program than the one that ships |
| **One HTML file, self-contained** | `REQ-101`, `REQ-113`. One `<style>` element, no external stylesheet reference, no external script `src` |
| **The app script is classic** | `REQ-103`. No `type="module"`, no local `src` |
| **No inline `on*`, no `eval`, no `new Function`, no dynamic `<script>`** | `REQ-106` |
| **`script-src` names the declared script endpoints and `'wasm-unsafe-eval'`; the served artifact actually compiles a WASM module under its own policy** | `REQ-713` |
| **Byte-identical app code across exports** | `REQ-110`. The build concatenates and does not transform; a minifier would make the shipped code unauditable, which defeats `PAT-INV-08`'s purpose |
| **App hash computed over the final bytes, and declared** | `REQ-111`. Export self-verification compares against it (`REQ-508`) |
| **No unresolved `{{TOKEN}}` placeholder survives** | `REQ-109`. A literal `{{appHash}}` in a shipped file is a silent failure |
| **The static no-markup check runs over the built artifact** | `REQ-703`, `REQ-702`. Not over sources — the artifact is what ships |
| **SHA-256 against published NIST vectors, in the suite *and* at build time** | `REQ-307`. A hand-written primitive is a classic bug source; the vector test is the mitigation (`ADR-0004`). It runs at build time because the build is where the hash first matters |
| **The built artifact opens from `file://` and boots, in CI, at least in Chrome** | `REQ-102`. The single property the present app fails |

The last row is the one that would have caught the present design's largest problem before it shipped.
A build that produces a file which cannot run from a file is not a build for this pattern, and it is
cheap to check on every commit.

---

## 9. The agent's tests

Implements `REQ-810`. The AI subsystem is the one place where a test must run **with no network and no
spend**, and the mock transport is the mechanism.

| Rule | |
|---|---|
| The mock transport exercises the **full agent loop** — prompt, tool calls, tool results, final write-back | A mock that only returns a canned string tests the transport and none of the agent |
| No network, no credential, no spend | The default in the suite |
| The tool-call path is covered end to end, including a tool result that fails validation | The interesting failure is a malformed tool result, not a well-formed one |
| A hostile tool result — text containing instructions — produces a **suggestion**, not a committed change | `REQ-712`, `08-security.md` §8 |

This is the existing `test/mock-scenarios.js` behaviour made a requirement rather than a convenience.
It is worth naming because it is the only AI-facing test that can run in CI: every other AI path
requires a live service, a credential, or a GPU, and a suite that skips those is a suite that tests
nothing about the agent.

---

## 10. What testing cannot establish

Stated so it is not discovered later:

| Not provable by test | Established by |
|---|---|
| That the file is genuinely the carrier (`REQ-404`) | The manual deletion check (§5 row 7) |
| That the gating matches the request's intent | Review against `07-ui.md` §2 |
| That a user will understand a `file://` limitation rather than conclude the app is broken | The copy in `07-ui.md` §5, and testing it on a person |
| That storage behaves the same in a browser version not in the matrix | The matrix, and a stated policy of adding rows as they are reported |
| That a hostile document is **imported** rather than opened | Documentation and the import UX — it is a user action |
| That the ledger's **classifications are right** (as opposed to followed) | Review. P11 proves the ledger is *followed*; only a human reading it proves it is *correct* |
| That the shell markup is genuinely static (`REQ-114`) | Review — "one named region per panel" is a structural claim about the markup |

The second-to-last row is the honest boundary of P11. A test can prove the code does what the table
says. It cannot prove the table is what the user needs, and no amount of coverage changes that.

---

## 11. Present state

| Requirement | Today |
|---|---|
| `REQ-801` | No traceability check, and no requirement table to parse — this spec set is the first |
| `REQ-802`–`REQ-806` | No property tests, no fault injection, no escaping sweep, no validator cross-check. `app/` is browser-coupled throughout, so the pure-logic half does not exist to be tested |
| `REQ-804` | No matrix. The platform behaviours the design turns on have not been recorded |
| `REQ-807`, `REQ-808` | There is no build, so there is nothing to keep test tooling out of and no fragment order to declare |
| `REQ-809` | No ledger exists. Losses are implicit in the mapper code (`app/io.js`), with nothing checking that the set is complete |
| `REQ-810` | **Present and useful.** `test/mock-scenarios.js` exercises the agent loop with no network. It is not auto-run, and `README.md` does not present it as a suite |
| `REQ-102` | The present `index.html` would fail the `file://` boot check (`index.html:73`) |
| Suite | There is no runner, no CI, and no test that runs on a change |

The gap here is the same gap as everywhere else in this set: most of the mechanisms being tested do not
exist yet. What this spec contributes now is the **shape** — the pure/browser split that keeps the
risky logic completely testable, the ledger-as-executable-table that keeps the classification from
rotting, and the matrix that keeps the platform claims from being assumed.
