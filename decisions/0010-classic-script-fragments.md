# ADR-0010 — Classic script fragments, concatenated in a declared order

- **Status:** Accepted
- **Pattern decision:** `PAT-DEC-10` — Module strategy
- **Specified in:** `02-architecture.md` §3, §4
- **Deviation:** None

## Context

Modern JavaScript reaches for `import`. **`file://` gives a document an opaque origin, and module
loading is CORS-blocked from an opaque origin.**

This is not a hypothetical. The present application fails exactly here: `index.html:73` loads
`app/main.js` as `type="module"`, so the app **cannot start from `file://` at all**. The repository
documents the consequence (`README.md:12`) and ships a boot watchdog whose only job is to print an
explanation for the failure (`index.html:64-71`).

## Decision

**Author as plain script fragments attaching to one global namespace (`TP`); concatenate in a declared
order; no bundler.**

| Rule | |
|---|---|
| The app script is **classic** — inline, one `<script>` element, no `type="module"`, no local `src` | `REQ-103` |
| The fragment order is **declared once** and consumed by both the build and the test harness | `REQ-108`, `REQ-808` |
| The build concatenates and does not transform; app code is byte-identical in every export | `REQ-110` |
| One namespace, `TP.<module>` | — |
| No bundler, no install step: `node build.js` from a clean checkout | `REQ-107` |

The declared order (`02-architecture.md` §3): `environment.js` → `core/*` → `utils/*` → `model/trip.js`
→ `interchange/*` → `storage/*` → `io/*` → `store.js` → `ui/*` → `ai/*` → `boot.js`.

## Consequences

- **No module isolation.** Discipline is required to keep fragments out of each other's internals. The
  order makes dependencies explicit rather than implicit, which is the mitigation: a fragment that reads
  another's private state is visible in the load order.
- The declared order is a single source consumed by build and tests, so the two cannot drift. Two lists
  that "should" match are two lists that will eventually diverge, and the divergence presents as a test
  suite testing a different program than the one that ships.
- Concatenation and no transformation means the shipped code is **auditable against the sources**. A
  minifier would make the artifact unreadable, defeating `PAT-INV-08`'s purpose of letting a user
  inspect what the file they were sent actually does.
- The build must fail loudly on any unresolved `{{TOKEN}}` placeholder (`REQ-109`), and on any
  duplication of a namespace path between fragments.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| ES modules (`type="module"`) | CORS-blocked from an opaque origin — the present app's exact failure |
| A bundler producing one IIFE | An install step and a build dependency for a file that concatenates in seconds; and bundler output is not byte-auditable |
| Modules plus a `<script nomodule>` fallback | The fallback would be a second full copy of the application |
| A single hand-maintained file | Unreviewable; the fragment order exists precisely so the file is assembled rather than edited |

## References

`PATTERN.md` §5.11, §4.1 rule C, `PAT-DEC-10`; `specs/02-architecture.md` §3, §4;
`REQ-103`, `REQ-107`–`REQ-110`.
