# Trip Planner

A browser-only trip planning app. Plan trips day-by-day, track a budget, and let an AI agent
plan the itinerary for you — including live web research — all stored in your browser. No backend.

- **Storage:** IndexedDB (trips, expenses, AI conversations) + localStorage (settings). Nothing leaves your machine except calls to the Ollama host you configure.
- **AI:** In-browser WebGPU (default, no key), Ollama Cloud (web search enabled), or a local Ollama instance — via an agent loop that calls `web_search` / `web_fetch` (cloud only) and writes the trip directly into the app — itinerary items, day notes, lodging, reservations, pre-trip actions, the location library, bucket list, checklists, budget estimates, contacts, tips, alerts, and (in EV mode) charging stops + min-SoC thresholds.
- **Stack:** Vanilla JS + ES modules. No build step, no npm.

## Run it

ES modules and the AI fetches require `http(s)`, so serve the folder (don't open `file://`):

```bash
cd trip-planner
python3 -m http.server 8000
# open http://localhost:8000
```

Any static server works (e.g. `npx serve`).

## Configure AI

Open **Settings** and pick a mode:

### In-browser WebGPU (default, no key, no chat network)

Runs a small LLM locally in the browser via [web-llm](https://github.com/mlc-ai/web-llm) on WebGPU.
The model downloads from the MLC CDN on first use (one-time, cached after by the browser).

1. Pick a **WebGPU model** in Settings. Options:
   - `Qwen2.5 0.5B` — default, ~944 MB VRAM, weak tool-calling
   - `Qwen2.5 1.5B` — ~1.6 GB VRAM, partial tool-calling
   - `Llama 3.2 1B` — ~879 MB VRAM, runs on almost any WebGPU device
   - `Hermes-3 3B` — ~2.3 GB VRAM, **first-class function-calling** (best for the agent loop)
   - `Qwen2.5 3B` — ~2.5 GB VRAM, partial tool-calling
2. Click **Test connection** to download + warm the model.
3. Browser support: Chrome/Edge 113+, Safari 17+, or Firefox with
   `dom.computepainter.enabled` in `about:config`.

No web search in this mode — the agent plans from the model's own knowledge.
Web tools (`web_search` / `web_fetch`) are only injected in Cloud mode.

> **Granite note:** IBM Granite models are not MLC-compiled for the browser, so they can't run via
> WebGPU. To use Granite, switch to **Local Ollama** mode and run
> `ollama pull granite3.2:8b` (or `granite-4.0-h-tiny`), then select it as the model.

### Ollama Cloud (web search available)
1. Create a key at <https://ollama.com/settings/keys>.
2. Paste it into **API key**. Base URL defaults to `https://ollama.com`.
3. Choose a **tool-capable model** (e.g. `qwen2.5:7b`, `llama3.1:8b`, `mistral-nemo`).
4. Click **Test connection**.

The agent exposes `web_search` / `web_fetch` as tools and calls the cloud endpoints
`/api/web_search` and `/api/web_fetch` itself, then writes results back into the chat and your itinerary.

### Local Ollama (no web search)
1. Start Ollama allowing browser origins:
   ```bash
   OLLAMA_ORIGINS=* OLLAMA_HOST=0.0.0.0 ollama serve
   ```
   Without `OLLAMA_ORIGINS=*`, browsers get a **403 / CORS** error from `http://localhost:11434`.
2. Pull a tool-capable model: `ollama pull qwen2.5:7b`.
3. In Settings, set base URL to `http://localhost:11434` and pick the model.
4. Local Ollama has no web search endpoint — the agent will plan from its own knowledge.

## CORS notes

Ollama's cloud endpoints may not send permissive CORS headers for arbitrary browser origins. If
**Test connection** fails with a network/CORS error:

- Set a **CORS proxy URL** in Settings (a local [`cors-anywhere`](https://github.com/Rob--W/cors-anywhere)
  or your own relay). Every request is then prefixed with that URL.
- Best option for the API key: run your own small relay that forwards to `ollama.com` and injects the
  key server-side, so the key never reaches the browser. Point the **base URL** at the relay and clear the
  browser-side key.

Error messages in the UI call out the likely cause (CORS vs. auth vs. wrong URL).

## Import / export

- **Import:** click **⬆ Import** in the sidebar (or **Import trip-data.json** in Settings) and choose
  a `trip-data.json` file. Every section is mapped into the planner's native model (days, items,
  budget estimates, checklists, lodging, reservations, locations, contacts, alerts, EV data), and the
  full original is preserved as `importedRaw` so nothing is lost.
- **Export:** on the Itinerary tab, click **⬇ Export** to download the current trip as
  `<title>-trip-data.json`. In Settings, **Export all trips** writes every trip as a JSON array.

Import/export is **lossless** for unedited imports: sections rebuild from native fields so your edits
are reflected, and synthetic internal `id`s are stripped on export when the source file had none.
Checklists are stored as a typed `[{id, category, items:[{id,text,done}]}]` for editing and converted
back to the on-disk `{category: string[]}` shape on export (the `done` flag is app-only).

## Trip data tabs

Every section of `trip-data.json` is now a first-class, editable, AI-writable feature:

- **Itinerary** — trip header (title, subtitle, vehicle, currency) + day-by-day items. Each day has a
  **Day notes** editor (title, drive, stay, summary, dining, tips). Alerts & tips are editable
  (add/delete with severity).
- **Checklists** — collapsible category groups with per-item checkboxes. Done state is kept in-app.
- **Lodging** — stays with check-in/out, nights (derived), area, notes; days covered matched to the trip.
- **Bookings** — reservations (with book-by deadlines + overdue highlight), no-reservation-needed
  items, pre-trip actions (priority + done), and a contacts card.
- **Places** — bucket list as dated chips + a location library (summary, lodging, charging, dining,
  activities). Any activity or dining entry can be dropped onto a day via **Add to a day**.
- **Charging** *(EV mode — appears only when a vehicle is set)* — charging networks, per-leg min-SoC
  thresholds with severity colors, and a per-day charge-plan summary.
- **Budget** — line-item estimates grouped by category (the editable source of truth); totals and the
  spent-vs-estimate bar roll up automatically. Actual expenses tracked separately.

Set a **vehicle** in the Edit-trip modal to enable EV mode (the Charging tab appears, and the AI agent
gets EV tools + range-aware guidance).

## Dev / no-spend testing

Toggle **Mock transport** in Settings to run the entire agent loop with **no network and no API spend**.
The mock returns a scripted sequence (`web_search` → `web_fetch` → `set_day_plan` → final answer), so you
can verify the agent loop, tool dispatch, write-back, persistence, and live itinerary re-render without a key.

## Security note

The Ollama Cloud API key is stored in `localStorage` (one machine, personal tool). Risks: any XSS in the
app could read it, and anyone with access to your browser profile can read it. Mitigations in this app:

- AI markdown output is rendered with a built-in escape-first renderer (no external
  dependency): input is HTML-escaped before any markup is introduced, so model output
  can never inject raw HTML/scripts.
- The key field is masked with a show/hide toggle and a **Clear** button.
- The key is never logged.

For stronger protection, use a server-side relay that holds the key (see CORS notes) and leave the
browser-side key empty.

## Project layout

```
index.html              # single page (9 tabs: Itinerary, Checklists, Lodging, Bookings, Places, Charging*, Budget, AI, Settings)
styles/main.css
app/
  main.js               # entry
  store.js              # data layer (trip/expense/conversation + all collection CRUD + UI state)
  db.js                 # IndexedDB
  io.js                 # import/export (trip-data.json format, lossless round-trip + normalization)
  settings.js           # settings (localStorage)
  ai/
    ollama.js           # HTTP client + CORS-aware error classification (cloud/local)
    webgpu.js           # in-browser WebGPU transport (web-llm, lazy-loaded)
    webgpu-worker.js    # web-llm worker thread
    transport.js        # dispatcher: routes chat() to ollama or webgpu based on settings
    agent.js            # agent loop
    tools.js            # tool schemas + dispatch (planning, booking, places, EV tools)
    prompt.js           # system prompt (+ EV appendix) + trip context
    mock.js             # scripted dev transport
  ui/
    shell.js            # tabs (EV tab auto-shown when a vehicle is set)
    trip-list.js        # sidebar + new/edit trip modal (incl. subtitle + vehicle editor)
    trip-editor.js      # itinerary tab + editable alerts & tips
    itinerary-day.js    # per-day items + Day notes editor
    checklists.js       # checklists tab
    lodging.js          # lodging tab
    bookings.js         # bookings & tasks tab (+ contacts)
    places.js           # places tab (locations + bucket list + "add to a day")
    charging.js         # EV charging tab (gated on vehicle)
    budget.js           # budget tab (line-item estimates + expenses)
    ai-panel.js         # AI planner tab
    settings-view.js    # settings tab
    toast.js, modal.js  # helpers
  utils/ id.js, dates.js, format.js
test/mock-scenarios.js  # canned transcripts (manual)
```

## Verify end-to-end

1. **WebGPU path (default):** Settings → WebGPU mode → **Test connection** (downloads model, ~400 MB
   for Qwen2.5 0.5B) → create a 2-day trip → AI Planner → **Plan my trip** → confirm items are written
   into the Itinerary tab. No key, no network for chat after the one-time model download.
2. **Mock path (no spend):** Settings → enable Mock transport → AI Planner → **Plan my trip** →
   confirm scripted items appear in the Itinerary tab and the conversation replays after reload.
3. **Cloud smoke test:** real key, small tool-capable model, `maxIterations: 4`, `num_ctx: 16000`,
   "Plan 2 days in Osaka" on a 2-day trip. Confirm `web_search` fires and items are written.
4. **Local:** `OLLAMA_ORIGINS=* ollama serve`, tool-capable model, base URL `http://localhost:11434`.
   Expect web tools to report "only available in Ollama Cloud mode" and the agent to plan from knowledge; no 403.
5. **Error paths:** unset key (auth UI), wrong base URL (network/CORS banner), local without
   `OLLAMA_ORIGINS` (403 + guidance), broken proxy URL (network banner), WebGPU on an unsupported
   browser (clear "WebGPU not available" message).