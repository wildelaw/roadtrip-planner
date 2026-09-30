# ADR-0004 — A synchronous pure-JavaScript SHA-256

- **Status:** Accepted
- **Pattern decision:** `PAT-DEC-04` — Hash function and runtime
- **Specified in:** `04-versioning.md` §3.1, `09-testing.md` §8
- **Deviation:** None

## Context

The obvious API is `crypto.subtle`. It is asynchronous, secure-context-dependent, and differs across
browser and Node. The application needs synchronous hashing in three places:

| Need | Why `crypto.subtle` does not serve |
|---|---|
| Hashing at boot, inside the deterministic boot sequence (`REQ-612`) | It is async; the boot sequence would gain an await point in the middle of integrity verification |
| Hashing in the test suite | Only present in secure contexts; a Node test would need a shim, and the shim would be the thing under test |
| Hashing during reconciliation, per comparison | Each await is a point where the UI could paint before reconcile completes |

## Decision

**A pure-JavaScript synchronous SHA-256, verified against published NIST vectors on every build.**

The vector test runs both in the suite and at build time (`REQ-307`, `09-testing.md` §8), because the
build is where the hash first matters — a bad hash produces an artifact whose own export verification
fails.

## Consequences

- Hand-written cryptographic primitives are a classic bug source. The mitigation is the vector test and
  the observation that the only property required here is **collision resistance for content
  addressing**, which is provided regardless of implementation language. This is not a design that
  needs constant-time comparison or side-channel resistance; it needs stable, collision-resistant,
  reproducible digests.
- The hash implementation is ~100 lines of the artifact's size budget, permanently.
- One implementation, shared by the application and the test harness (`REQ-306`). Two implementations
  that "should" agree are two that will eventually disagree, and the failure presents as every commit in
  every circulated file failing to verify — a bug that looks like corruption.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| `crypto.subtle`, async throughout | An await point inside integrity verification and inside boot; a Node shim in tests |
| A different hash (SHA-1, xxhash, BLAKE) | SHA-1 is broken for collision resistance; the non-cryptographic hashes are the wrong tool for content addressing across mutually untrusting copies |
| A bundled hash library | It would be a second policy origin inside a file whose premise is that it has one; and it would be inlined anyway, so the size argument does not favour it |

## References

`PATTERN.md` `PAT-DEC-04`; `specs/04-versioning.md` §3.1; `REQ-306`, `REQ-307`.
