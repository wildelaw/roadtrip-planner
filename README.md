# Trip Planner

**Try it now: <https://wildelaw.github.io/roadtrip-planner/>** — the built artifact, served. Nothing
to install, and no key needed (the AI tab is there because a served page has a web identity; it works
with the mock transport and no spend).

A trip planner that is **one file**. `trip-planner.html` opens in any modern browser and runs from your
disk: no server, no install, no account, no network. The file carries your itinerary *and* the
application that edits it *and* the history of how it got there — so "the document" and "the app" are
the same thing, and both travel with the file.

The Pages site is that same file, published unchanged: the one you download is byte-for-byte the one
the link serves.

- **The file is the document.** `trip-planner.html` holds the trip, its full commit history, and the
  application. Save it, copy it, email it — whoever opens it gets the plan and the tool.
- **The browser is a cache, not the home.** Edits are saved into this browser so they survive a reload.
  The copy that counts is the file you exported. The sidebar says which of the two you are looking at.
- **History is real.** Every committed change is a commit with a message; reverting writes a *forward*
  commit, so nothing is ever destroyed.
- **Interchange both ways.** Import `trip-data.json` or `.ics`; export `trip-data.json`, a calendar, or
  the document itself. What a calendar cannot carry is disclosed before you write it.
- **AI planning, where the browser allows it.** Off under `file://`, by design — see below.

## Run it

Open **<https://wildelaw.github.io/roadtrip-planner/>**, or build the file and open
`dist/trip-planner.html`. Double-clicking it from your file manager is the intended path.

`file://` is a first-class mode, not a degraded one: the itinerary, budget, bookings, checklists,
history, import and export all work exactly as they do over the web. Two things differ, and the app says
so where you would look for them:

| | From a file | From a web address |
|---|---|---|
| AI planner | **Absent** (the tab is hidden and the transport refuses) | Available |
| Saving | Download, or the text to copy (some browsers refuse downloads from `file://`) | Download via the File System Access API |

**Why the AI is off from a file.** A file opened from disk has an opaque origin, shared with every other
local file. A service key stored there would be readable by any of them, and the app cannot reach a
service with no web identity anyway. So it does not pretend: the transport refuses before any request is
made. Serve the folder and open it over `http://` and the AI tab appears:

```bash
node build.js
python3 -m http.server 8000    # then open http://localhost:8000/dist/trip-planner.html
```

Open **`/dist/trip-planner.html`**, not the folder root. A static server hands out `index.html` at `/`,
and `index.html` is the shell template the build fills in — not the application. Serving the root
therefore gets you the template: the program in its markup is still a placeholder, the content
policy pins a hash of the real program instead, so the browser refuses to run it. The page is inert
by design and its only diagnosis would be two content-policy errors in the console, so it says what
it is on the page itself. That notice is authoring-only — it is not in the artifact.

## Plan a trip

| Tab | |
|---|---|
| **Itinerary** | The trip header (title, subtitle, vehicle, currency) and day-by-day items with per-day notes, alerts and tips |
| **Checklists** | Category groups with per-item checkboxes |
| **Lodging** | Stays with check-in/out, area, notes |
| **Bookings** | Reservations (with book-by deadlines), no-reservation-needed items, pre-trip actions, contacts |
| **Places** | Bucket list and a location library; drop any activity onto a day |
| **Charging** | EV networks, per-leg minimum-SoC thresholds, per-day charge plans — the tab appears once a vehicle is set |
| **Budget** | Line-item estimates grouped by category, with totals and a spent-vs-estimate roll-up |
| **AI Planner** | The planning agent (served mode only), or the mock transport with no key and no spend |
| **History** | Every commit, with messages and authors; revert to any of them |

Editing is ordinary editing; the app decides when a change is worth a commit. **Undo/redo** move within
the changes made since the last commit — which is exactly what "undo" promises. Reversing a *committed*
change is a different, more deliberate act: **History → Revert to this version**, which appends a new
commit rather than rewriting the past.

## Import and export

**Import** reads a file as **text** and maps it into the model. It never inserts the file into the page,
never parses it as markup, and never runs it. That is the security posture, not an implementation
detail: an exported document is an executable HTML file, so *opening* one runs its code, and importing is
the safe way to look inside.

Importing creates a **new document** by default. Replacing the document you have open is a separate
action with its own confirmation — it is the one thing that would discard real work.

| Format | In | Out |
|---|---|---|
| `trip-planner.html` (the document) | The whole thing — trip, history, app | The whole thing, verified before it is offered |
| `trip-data.json` | Yes, lossless | Yes; loses only the UI-only `done` flags and derived roll-ups |
| iCalendar (`.ics`) | Yes | Yes — the itinerary as a calendar |

The `.ics` export is lossy and says so **before** it writes the file, naming what a calendar cannot
carry: budget, expenses, checklists, lodging, bookings, contacts, charging plan, alerts, and the trip's
history. The dialog's last line points at the file that *is* complete. The wording is generated from the
same ledger the mapper is written against, so the disclosure and the code cannot drift apart.

## AI planning (served mode)

Open the app over `http://` and pick a mode in **Settings**:

- **In this browser (WebGPU)** — no key, no chat traffic. A small model runs locally via
  [web-llm](https://github.com/mlc-ai/web-llm); the weights download once from the MLC CDN and are cached
  by the browser. Chrome/Edge 113+, Safari 17+, or Firefox with `dom.computepainter.enabled`. No web
  search in this mode.
- **Ollama Cloud** — a key from <https://ollama.com/settings/keys>. This is the mode with `web_search`
  and `web_fetch`, so the agent can look things up. Tool-capable models only (`qwen2.5:7b`,
  `llama3.1:8b`, `mistral-nemo`).
- **Local Ollama** — start it with `OLLAMA_ORIGINS=* OLLAMA_HOST=0.0.0.0 ollama serve`, point the base
  URL at `http://localhost:11434`. No web search endpoint, so the agent plans from its own knowledge.
  Without `OLLAMA_ORIGINS=*` the browser gets a 403.
- **Mock transport** — the whole agent loop with a scripted reply. No network, no key, no spend. This is
  the mode to use when you want to see the loop work.

The agent calls tools and writes the trip directly — itinerary items, day notes, lodging, reservations,
pre-trip actions, the location library, bucket list, checklists, budget estimates, contacts, tips,
alerts, and (in EV mode) charging stops and SoC thresholds. Forty turns of tool calls land as **one**
commit, not forty.

Under `file://` every one of those entry points refuses, and so does the mock — no code path reaches the
network, even with a stale tab.

**If a connection test fails with a CORS error**, Ollama's cloud endpoints do not always send permissive
headers for an arbitrary browser origin. Settings takes a **CORS proxy URL** (a local
[`cors-anywhere`](https://github.com/Rob--W/cors-anywhere) or your own relay) that every request is
prefixed with. The error messages distinguish CORS from auth and from a wrong URL, so the banner tells
you which one you have.

## Security posture

The whole design turns on one sentence: **an exported document is an executable HTML file.** Opening one
means running its code. Everything below follows from taking that seriously.

- **Import is text-only**, always. Read as text, located by string scanning, never inserted into the DOM,
  never parsed as markup, never executed.
- **The artifact has one origin.** Exactly one inline script, pinned by hash in a `script-src` policy,
  and no external references of any kind — which is also why it works offline from a file. Any edit to
  the program makes the policy stop matching, and the browser refuses to run it.
- **No merge over untrusted JSON.** Reconciliation compares histories by ancestry; it never deep-merges
  a file into your document. Divergence always asks.
- **Patch path segments** `__proto__`, `constructor` and `prototype` are rejected before any path is
  walked.
- **Resource guards bound before the expensive step**, and each one names the limit and the value it
  saw (document size, commit count, patch operations, nesting depth, embedded source length, calendar
  property count and line length).
- **A broken chain opens read-only**, names the commit that failed, and writes nothing.
- **Nothing deletes commits without an explicit, informed confirmation** — not compaction, not a quota
  error, not a cleanup path.
- **The API key** lives in this browser's `localStorage` and never in the document: a key is not a
  property of a portable file, and a document that carried one would hand it to everyone you send it to.
  The field is masked and clearable. For stronger protection, run a small relay that holds the key and
  point the base URL at it, leaving the browser-side key empty.

## Build and test

The app is built from 52 fragments in `src/` into the single self-contained
`dist/trip-planner.html`:

```bash
node build.js        # writes dist/trip-planner.html
node test/run.js     # the test suite
```

**The artifact needs nothing.** `node build.js` uses no dependencies and nothing in `package.json` is
ever bundled into it — that is a requirement, not a convenience (`REQ-807`, `PATTERN.md` §5.11).

**The output lands in `dist/`, which is git-ignored.** That is deliberate: the artifact is a *build
output*, and a repository that carries its own build ships a second copy of the app — the copy people
actually open — so a commit that edited `src/` without rebuilding would publish a file that disagrees
with its own source, silently. One command reproduces it from a bare checkout.

```bash
npm install          # optional, and only for the test suite's cross-check
```

`npm install` pulls one **dev** dependency, `ajv`. The hand-written validators are cross-checked against
it over a corpus of real files, because a subtly wrong validator is worse than none — it gives confident
wrong answers. The cross-check skips when `ajv` is absent, so a bare checkout still runs the whole suite.

`node test/mock-scenarios.js` is **not** the test suite. It prints canned agent transcripts for reading
by hand — what the model was told after each tool call — which is what you want when the agent behaves
oddly against a real service. The suite asserts; that file narrates.

## Publishing

`.github/workflows/pages.yml` builds, runs the suite, and publishes `dist/` to **GitHub Pages** at
<https://wildelaw.github.io/roadtrip-planner/> — on every push to `main`, and on demand from the
Actions tab (`workflow_dispatch`) for any branch. The suite runs *before* the deploy and a failure
stops it: the Pages site is the one place this app is served to somebody who did not build it, so it
is the last place to publish a build the repository's own checks refuse.

The workflow adds a `dist/index.html` that redirects to `trip-planner.html`, because Pages serves
`index.html` at the site root and a link to the bare site should work. It is a redirect and not a
copy: `trip-planner.html` keeps its own name and its own address, because that address is what a
person bookmarks and what a link to this app points at. Enabling Pages for the first time needs
**Settings → Pages → Source: GitHub Actions** once.

There is no build step in the published page itself. The file the workflow uploads is the file
`node build.js` produces locally, byte for byte — which is the property the whole design is for.

## Project layout

```
dist/
  trip-planner.html      # THE ARTIFACT — the app, the trip, and its history in one file (BUILD OUTPUT)
build.js                 # concatenates src/ into the artifact, with static checks
index.html               # the shell template the artifact is built from
styles/main.css          # the stylesheet, inlined and hash-pinned
vendor/                  # the vendored schemas (container, trip-data.json, RFC 5545) + provenance
.github/workflows/       # build + test + publish dist/ to GitHub Pages
src/
  fragments.js           # the fragment list and their order — the one answer to "what bytes is the app"
  environment.js         # served vs file://, and what each permits
  core/                  # container codec, history DAG, patch, merge, canonical serialization, SHA-256
  model/trip.js          # the canonical model and its normalizer
  storage/               # localStorage + memory + null adapters, and the document registry
  interchange/           # the lossiness ledger, the two mappers
  validators/            # hand-written validators for the vendored schemas
  io/                    # import (text-only) and export (clone + verify)
  ui/                    # the render seam and one module per view
  ai/                    # transport dispatcher, agent loop, tools, prompt, mock
  store.js               # the working copy, commits, autosave, read-only
  boot.js                # the read-only decision, and the only side-effecting fragment
test/                    # the suite (*.test.js), the harness, and the transcript reader
specs/                   # the 11 spec documents this was built against
decisions/               # the ADRs, including where the build deviates from the specs
PATTERN.md               # the Portable Versioned Document pattern
docs/                    # the pattern walk-through
app/                     # the RETIRED v1 application, kept for reference (specs/06 §8, 08 §10)
```

`PATTERN.md` and `specs/` are the specification; `decisions/` records the choices made while
implementing it, **including the deliberate deviations** — a spec that disagrees with the code is a
defect, so where the two came apart the disagreement was recorded rather than left in a comment.
`specs/00-overview.md` is the place to start reading.
