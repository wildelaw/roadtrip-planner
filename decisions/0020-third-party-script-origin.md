# ADR-0020 — The policy names a third-party script origin for the WebGPU transport

- **Status:** Accepted
- **Pattern decision:** Not a `PAT-DEC` — instance-specific
- **Specified in:** `02-architecture.md` §7, `08-security.md` §9, `09-testing.md` §5, §8
- **Deviation:** **Yes** — `script-src` is no longer hash-only; it names two CDN hosts and allows WASM compilation

## Context

The in-browser AI transport loads its model library with a runtime `import()`:

```js
// src/ai/webgpu.js
var WEB_LLM_URL = 'https://esm.run/@mlc-ai/web-llm';
enginePromise = import(WEB_LLM_URL)…
```

The artifact's policy declared `script-src 'sha256-{{policyHash}}'` — a hash and nothing else — while
listing the CDN hosts only under `connect-src`. That was a category error, and it made the served
WebGPU transport dead on arrival:

- **A dynamic module import is a script fetch, governed by `script-src` (specifically
  `script-src-elem`), not by `connect-src`.** The module was refused *before any network request*;
  Chrome reported `Loading the script 'https://esm.run/@mlc-ai/web-llm' violates … script-src
  'sha256-…'`, and the app surfaced "the model library could not be loaded from the CDN".
- **`WebAssembly.instantiate` is governed by `script-src` too.** `@mlc-ai/web-llm` runs on a WASM
  runtime (tvmjs), so even once the module loads, a policy without `'wasm-unsafe-eval'` refuses to
  compile it.
- `https://esm.run/@mlc-ai/web-llm` **301-redirects to `https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/+esm`**,
  and CSP checks the redirect target, so both hosts must be named.

The failure was silent in a specific way: nothing on the page explained it, the settings UI kept
offering the transport, and only a console a user would not be looking at named the cause. The
pattern's own `10-open-questions.md` Q-1 had been read as "whether the import works is a platform
question"; the served half was in fact a policy defect of our own making.

Facts established while deciding (headless Chrome against the built artifact): web-llm 0.2.85
contains no `new Worker`, no `eval` and no `new Function`, and inlines its WASM as a `data:` base64
URI — so no `worker-src`, `blob:` or further host is needed.

## Decision

**`script-src` carries the hash, `'wasm-unsafe-eval'`, and a declared `SCRIPT_ENDPOINTS` list:**

```
script-src 'sha256-{{policyHash}}' 'wasm-unsafe-eval' {{scriptEndpoints}};
```

- `SCRIPT_ENDPOINTS` is a **separate** declared list from `AI_ENDPOINTS`, holding only `esm.run` and
  `cdn.jsdelivr.net`. Naming a host here grants it code-execution rights inside our page; naming a
  host in `AI_ENDPOINTS` grants only reachability. Reusing `AI_ENDPOINTS` would have handed script
  rights to the Ollama hosts and to `huggingface.co`. The build asserts every script host is also a
  connect host, because the module a script host loads still fetches its chunks over `connect-src`.
- The build compares the **whole** `script-src` directive to the bytes it declared and fails if it
  differs, so dropping a host or the keyword stops the build instead of shipping a silently dead
  transport.
- `'wasm-unsafe-eval'` is the narrow keyword that permits WebAssembly compilation. It does **not**
  permit `eval` or `new Function`, which remain banned and swept for (`REQ-106`).

## Consequences

- **The policy now names a third-party code origin, and that is a real cost.** A future regression
  that creates `<script src="https://cdn.jsdelivr.net/…">` would execute where before it could not.
  The layers that actually keep data from becoming a script element are the render seam
  (`REQ-701`–`REQ-703`) and the banned-API sweep (`REQ-106`), not this policy; the sweep does not
  currently ban `document.createElement('script')`, so the render seam is the operative guard. This
  is a defence-in-depth reduction, and it is recorded as such rather than described as free.
- **The policy is still secondary to import-don't-open** (`REQ-710`). A hostile author rewrites the
  policy regardless (`PAT-AP-10`), so the change does not alter the file's trust model — only our
  own margin for error.
- **The CDN is version-unpinned by design** (`@mlc-ai/web-llm`, no version, because the `@v1` form
  404s). A future release that spawns a Worker or changes its chunk strategy would need `worker-src`
  or another host, and would fail the same silent way. The build-time exact-directive check and the
  served WASM test narrow that window but cannot close it.
- **`file://` is unchanged.** The AI is disabled there behaviourally (`ADR-0015`), so this policy
  change is only reachable when the document is served.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Switch `WEB_LLM_URL` to the direct `cdn.jsdelivr.net/npm/…/+esm` URL (one host) | Removes a name but not a trust boundary — the bytes execute from jsdelivr either way — and churns the program and its hash to fix a policy-only defect. `/+esm` is an implementation path; `esm.run` is the documented alias |
| Vendor web-llm into the artifact | Adds megabytes to a file whose premise is auditable constant bytes (`ADR-0002`, `REQ-110`), still needs `'wasm-unsafe-eval'`, and the weights still download at runtime |
| `'unsafe-eval'` instead of `'wasm-unsafe-eval'` | Strictly broader — it re-permits JS string-to-code, which the app bans and sweeps for |
| `fetch()` the bundle and `import()` a `blob:`/`data:` URL | Still needs a broad `script-src` source, breaks the bundle's internal relative imports, and does not remove the jsdelivr trust |
| Drop the in-browser transport | Removes a shipped feature from a policy bug; the other transports do not give a zero-setup, no-key option |
| Leave the hash-only policy and document the limitation | Ships a feature the file's own policy forbids, failing silently — the exact outcome this ADR exists to prevent |

## References

`src/ai/webgpu.js`; `build.js` (`AI_ENDPOINTS`, `SCRIPT_ENDPOINTS`, the artifact checks);
`test/artifact.test.js`, `test/browser.test.js`; `specs/02-architecture.md` §7;
`specs/08-security.md` §9; `specs/09-testing.md` §5, §8; `specs/10-open-questions.md` Q-1;
`REQ-708`, `REQ-709`, `REQ-710`, `REQ-713`; `ADR-0002`, `ADR-0015`.
