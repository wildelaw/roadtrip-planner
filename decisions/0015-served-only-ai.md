# ADR-0015 — AI planning requires a served origin

- **Status:** Accepted
- **Pattern decision:** Not a `PAT-DEC` — instance-specific
- **Specified in:** `07-ui.md` §2–§5, `08-security.md` §8
- **Deviation:** **Yes** — a capability present in the hosted application is unavailable from `file://`

## Context

This decision comes from an explicit requirement: features that cannot work from `file://` must be
disabled there and enabled when served.

The AI planner is the only subsystem that (a) reaches the network, (b) holds a credential, and (c) can
write into the payload. Three independent arguments say it cannot work from a file, and they are not
equally strong:

**1. Security — decisive.** Chrome and Edge treat **all** local files as one origin (`PATTERN.md` §5.1),
and §5.9 notes that a crafted document reads every other document in that origin. The app's cloud mode
stores an API key in `localStorage` (`app/settings.js:4`; documented at `README.md:121-133`). Shipping a
key field into a `file://` artifact means any other local file the user opens can read it. That is a
self-inflicted exfiltration vector, created by the feature meant to be convenient.

**2. CORS — practical.**

| Mode | From an opaque origin |
|---|---|
| Ollama Cloud | Sends `Origin: null`; rejected (`README.md:67-78`) |
| Local Ollama | Works only with `OLLAMA_ORIGINS=*` (`README.md:57-65`); `Origin: null` is a special case a server may refuse |
| CORS proxy | A proxy reachable from `file://` is one that relays for `Origin: null` — i.e. one that disabled the protection it exists to provide |

**3. Loading — unverified.** `web-llm` is loaded by a runtime `import()` of a CDN URL
(`app/ai/webgpu.js:17,78`). Whether an opaque origin may import a cross-origin ES module is a platform
question, carried as `10-open-questions.md` Q-1.

## Decision

**All AI is disabled under `file://`, across all four transports (WebGPU/web-llm, Ollama Cloud, Local
Ollama, mock). It is enabled when served, from the same bytes.**

The gate keys off **one seam** — `environment.js` — whose `aiEnabled` predicate is
`location.protocol !== 'file:'`. **No other module may read `location`** (`REQ-601`), mirroring
`PAT-INV-12`'s one-adapter discipline for storage.

| Rule | |
|---|---|
| The **AI Planner tab** is hidden under `file://` | `REQ-603` |
| The **Ollama connection card**, **Test connection** and the **CORS proxy URL** are hidden | `REQ-604` |
| **The absence explains itself** — Settings renders a callout naming the browser behaviour and the security reason | `REQ-605` |
| Hiding reuses the **existing** mechanisms: the `activeTabs()` filter (`app/ui/shell.js:77-81`) and the `display` toggle (`app/ui/settings-view.js:121-128`) | `REQ-609` |
| The transport refuses when `!aiEnabled`, below the UI | `REQ-708` |

**The design does not depend on the loading answer.** Disabling is correct under either outcome: if the
CDN import works from an opaque origin, arguments 1 and 2 still decide it; if it does not, the platform
decides it. That is why Q-1 is carried without blocking anything.

## Consequences

- **A user who only ever double-clicks the file never sees the AI planner.** This is the accepted cost
  of a portable document, and it must be stated in the README and in the app (§4.2), not discovered.
- The gating is **behavioural, not policy-enforced** (`08-security.md` §9). The CSP cannot do this job:
  a hostile exporter rewrites the policy, and the policy is a property of the build rather than of an
  export (`PAT-INV-08`).
- AI conversations are app-local and never enter the container (`REQ-410`) — unreachable in the portable
  form for this reason, and excluded as per-user state for the independent reason in `REQ-211`.
- **The same bytes enable AI when served** (`REQ-606`): feature gating changes behaviour, not the file.
  A consequence is that `connect-src` is a build-time constant from a declared endpoint list, and a
  custom endpoint outside it is blocked — carried as Q-4.
- The `index.html:41` AI tab must ship `hidden` in the shell markup, as the Charging tab already does at
  `index.html:39`, so a `file://` open never flashes a tab about to be hidden.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Enable AI everywhere, warn the user | Ships a key field into a shared origin; a warning does not stop another local page from reading storage |
| Allow local Ollama only under `file://` | Still requires the settings UI, still writes a proxy and endpoint config into a shared origin, and still fails the `Origin: null` check in most configurations |
| Let the CSP block the network instead of gating the UI | The policy does not travel with an export and does not constrain the file's author (`PAT-AP-10`) |
| Hide the tab with no explanation | The user concludes the app is broken — the failure `PATTERN.md` §5.8 names for its most confusing moment |
| A separate `file://`-limited build | Contradicts the premise: one artifact, one set of bytes, behaving correctly in both environments |

## References

`specs/07-ui.md` §2–§5; `specs/08-security.md` §8; `PATTERN.md` §5.1, §5.8, §5.9, `PAT-AP-10`;
`REQ-601`–`REQ-609`, `REQ-708`; `specs/10-open-questions.md` Q-1, Q-4.
