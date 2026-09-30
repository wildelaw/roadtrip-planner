# ADR-0009 — Self-asserted authorship, signing deferred

- **Status:** Accepted
- **Pattern decision:** `PAT-DEC-09` — Identity and authorship
- **Specified in:** `04-versioning.md` §10, `08-security.md` §7
- **Deviation:** None

## Context

Users want attribution. Verification requires signing. Signing requires key management — generation,
storage, loss, revocation, and a trust model — which is a large amount of work that is easy to do badly.

Commit ids cover the author field, so changing an author name changes every subsequent id. That sounds
protective and is not: an attacker can recompute every hash, because **nothing signs it**.

## Decision

**Self-asserted identity inside the hash chain, disclosed as such. Signing is deferred.**

The UI says **"chain intact"** and never **"verified"** (`REQ-320`).

| Property | Provided |
|---|---|
| The history has not been altered since it was written | **Yes** |
| It is internally consistent and complete | **Yes** |
| Corruption or truncation is detected | **Yes** |
| The named author actually wrote it | **No** |
| The history was not fabricated wholesale | **No** |

## Consequences

- **Authorship is forgeable, and the UI must be careful never to imply otherwise.** The gap between
  "chain intact" and "verified" is the entire security property.
- The honest label costs nothing and is present from the first version, because retrofitting it after
  users have trusted the stronger word is not possible. This is the single most important consequence
  of this ADR.
- Author names and emails live in every commit forever, in every copy. For a document leaving an
  organisation this is a disclosure obligation, stated where the author is entered (`REQ-321`) and in
  the residual-risk list (`08-security.md` §10).
- The destructive alternative — a "strip authors" button that rewrites history — is **forbidden**
  (`REQ-314`, `PAT-AP-05`), because it fragments every copy in circulation. The correct answer to the
  privacy need it would address is a head-only export, deferred and carried as Q-6.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Sign now | Key management for a trip plan. `PAT-DEC-09` is explicit that this is for documents that are *evidence* |
| Omit author fields entirely | Loses attribution, which users want, and which the history is more useful with |
| Say "verified" and treat integrity as authorship | The failure this ADR exists to prevent |
| A "strip authors" button | `PAT-AP-05`. Desynchronises every copy in circulation |

## References

`PATTERN.md` §5.10, `PAT-DEC-09`, `PAT-AP-05`; `specs/04-versioning.md` §10; `specs/08-security.md` §7;
`REQ-320`, `REQ-321`; `specs/10-open-questions.md` Q-6, Q-7.
