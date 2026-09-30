# ADR-0002 — Inline everything, including the stylesheet

- **Status:** Accepted
- **Pattern decision:** `PAT-DEC-02` — How external assets are delivered
- **Specified in:** `07-ui.md` §7, `02-architecture.md` §4
- **Deviation:** **Yes** — the reference implementation pins a CDN stylesheet; this instance inlines

## Context

Inlining a large design system inflates **every exported file**. A CDN reference keeps the file small
and adds a supply-chain dependency and an offline failure mode.

The reference implementation chose the CDN with an integrity hash and accepted "degraded-but-functional
styling offline", recording it as the reference's one deviation from its own stated requirements.

`PAT-DEC-02`'s "choose differently when" is explicit and matches this domain on two counts: **offline is
a hard requirement**, and the design system here is small.

## Decision

**Inline the stylesheet. The artifact references nothing external.**

`styles/main.css` stays the authored source, **unchanged in content** (`REQ-610`, `REQ-113`), and the
build inlines it into a single `<style>` element. The same applies to vendored schemas (`REQ-115`).

The test this decision must pass is the pattern's own: *open the file with the network off.* With a CDN
stylesheet the artifact renders unstyled — which, for a file whose entire purpose is to be
double-clicked, is not a degraded experience but a broken one.

## Consequences

- Every exported file carries the full stylesheet. At this scale that is tens of kilobytes — a real
  cost that is paid deliberately and is bounded by the design system's size.
- The file is genuinely self-contained: no network, no supply chain, no CDN outage, no integrity-hash
  mismatch. This is what makes `REQ-102` ("runs correctly from `file://` with no network") true rather
  than approximately true.
- A stylesheet update requires a new export. There is no way to fix styling in files already
  distributed — the same property that makes the file trustworthy makes it frozen.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| CDN stylesheet with an integrity hash (the reference) | Breaks offline, which is the requirement here |
| A smaller inlined design system | The styling is the user's explicit instruction: keep it (`REQ-610`) |
| System fonts and no design system | Loses the styling entirely |

## References

`PATTERN.md` `PAT-DEC-02`; `specs/07-ui.md` §7; `REQ-113`, `REQ-610`, `REQ-611`.
