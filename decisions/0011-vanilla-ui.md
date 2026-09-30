# ADR-0011 — Hand-written vanilla UI, no markup from payload

- **Status:** Accepted
- **Pattern decision:** `PAT-DEC-11` — UI stack
- **Specified in:** `07-ui.md` §6, `08-security.md` §3
- **Deviation:** None

## Context

A framework would make the UI far faster to build. The artifact must be one file with no runtime to
install. `PATTERN.md` `PAT-DEC-11` describes the consequences in the pattern's own words: this is "the
largest workstream in the reference implementation by a wide margin", and "budget for it explicitly; it
is not a footnote".

There is a second force, specific to this pattern and not about build effort at all: **`PAT-INV-09`
forbids building DOM from payload strings.** An exported document is passed between people who do not
trust each other, and a view built from `innerHTML` is a code-execution surface.

## Decision

**Hand-written vanilla JavaScript against the existing stylesheet, with a single render seam.**

| Rule | |
|---|---|
| No framework, no runtime | The artifact is one file with no install step |
| The stylesheet is used as authored (`ADR-0002`) | `REQ-610` |
| **Exactly one path from data to DOM** — `ui/render.js` | `REQ-701` |
| `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` forbidden | `REQ-702` |
| `renderMarkdown` builds nodes; it does not return an HTML string | `REQ-704` |
| The check is static, over the **built artifact**, with a one-entry allowlist | `REQ-703` |

This decision covers both halves because they are the same decision: with no framework, every view is
hand-written, and what is hand-written is what the security rule constrains.

## Consequences

**This is the largest single workstream in this conversion.** Roughly forty `innerHTML` sites across
`app/ui/*.js` become `createElement`/`textContent` constructions
(`07-ui.md` §6.1 lists every site). It is a **pure refactor with no behaviour changes**, which is why it
is phase 0 in the build order (`01-requirements.md`) — it unblocks nothing else, but everything else
lands on top of it.

Specific consequences:

- **The present code is not reckless, and is still not sufficient.** It has `escapeHTML`
  (`app/utils/format.js:3`) and uses it widely. The technique is rejected because its safety depends on
  every *future* call site, forever. Three sites already interpolate unescaped values
  (`bookings.js:215`, `charging.js:156`, `itinerary-day.js:143`) and are safe only because their arrays
  happen to be internal constants. That is the shape of the bug.
- `renderMarkdown` (`app/utils/format.js:35`) is **safe by construction** — it escapes first, then
  introduces markup from a whitelist — and that discipline is preserved. Only its return type changes.
  This is worth stating because it is the one place a reader might reasonably ask why a working,
  careful function is being rewritten.
- Every table, tab, dropdown, modal and inline-editable row is hand-written and hand-wired. Two listener
  conventions already exist in the codebase (`07-ui.md` §8.3) and new views use whichever fits, so no
  new convention is introduced.
- A static check that can verify the rule is worth more than a convention that cannot. `PATTERN.md` §5.9
  names the failure mode as "one missed field" — which is precisely what a convention cannot catch.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Inline a framework bundle | File size, and the framework's own rendering path would have to be audited for the no-markup rule — the rule would become unverifiable |
| A CDN framework | Breaks offline (`ADR-0002`) and adds a second policy origin |
| Keep `innerHTML` with disciplined escaping | The convention that `PAT-INV-09` replaces, and the reason three sites are already unescaped |
| A templating library that escapes by default | Better than `innerHTML`, still a dependency, and still not statically checkable over the built artifact |

## References

`PATTERN.md` `PAT-DEC-11`, `PAT-INV-09`, §5.9; `specs/07-ui.md` §6; `specs/08-security.md` §3;
`REQ-701`–`REQ-704`.
