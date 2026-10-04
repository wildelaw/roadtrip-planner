// The planning agent (specs/07-ui.md §3.3).
//
// A loop of: ask the model, run the tools it calls, feed the results back, ask again. The model
// decides when it is done by returning no tool calls; the iteration cap is the backstop for a
// model that never decides.
//
// Two things this loop is careful about:
//
//   * It writes into the WORKING payload, not the file, and holds the commit boundary open for the
//     whole run (TP.store.holdCommits). However many turns the agent takes, the user gets one
//     commit, one Cmd-Z, and one honest line in the history.
//
//   * It releases that hold in a `finally`. An agent that threw partway through would otherwise
//     leave the autosave suppressed and the run's work uncommitted — which is the one failure here
//     that could actually lose something.

TP.ai.agent = (function () {
  'use strict';

  function runAgent(instruction, handlers) {
    var h = handlers || {};
    var trip = TP.store.trip();

    if (!trip) {
      if (h.onError) h.onError({ kind: 'unavailable', message: 'There is no trip open to plan.' });
      return Promise.resolve({ ok: false, stoppedReason: 'error' });
    }
    if (!TP.ai.transport.available()) {
      // Belt and braces on top of transport's own refusal (REQ-708).
      if (h.onError) h.onError(TP.ai.transport.refusal().error);
      return Promise.resolve({ ok: false, stoppedReason: 'error' });
    }

    var cfg = TP.ai.transport.config();
    var messages = TP.ai.prompt.systemPrompt(trip).concat([TP.ai.prompt.userPlanMessage(instruction)]);
    var conversationId = TP.uid();
    var citations = [];
    var iterations = 0;
    var stoppedReason = 'limit';      // assume the cap was reached; corrected when the model stops
    var dirtyBefore = TP.store.isDirty();
    // What the working copy held when the run started. `isDirty` cannot answer "did the agent write
    // anything?" — it is true for edits the person had already made and not committed — so the run
    // is compared against this. Otherwise a run that changed nothing commits the user's own unsaved
    // edit under the message "AI planning", clears their undo stack, and reports `changed: true`.
    var before = TP.canonical.serialize(TP.store.trip());

    TP.store.holdCommits();

    function step() {
      if (iterations >= cfg.maxIterations) return Promise.resolve();

      iterations++;
      return TP.ai.transport.chat({
        messages: messages,
        tools: TP.ai.tools.schemas(TP.store.trip()),
        model: cfg.model,
        numCtx: cfg.numCtx,
      }).then(function (res) {
        if (!res.ok) {
          stoppedReason = 'error';
          if (h.onError) h.onError(res.error);
          return;
        }

        var choice = res.data && res.data.choices && res.data.choices[0];
        var msg = (choice && choice.message) || {};

        // The assistant turn goes back into the transcript WITH its tool_calls, because the model
        // needs to see which call each result belongs to on the next pass.
        messages.push({ role: 'assistant', content: msg.content == null ? null : msg.content, tool_calls: msg.tool_calls || undefined });
        if (msg.content && h.onMessage) h.onMessage({ role: 'assistant', content: msg.content });

        var calls = msg.tool_calls || [];
        if (!calls.length) {
          stoppedReason = 'done';
          return;
        }

        // Tools run in order, one at a time: several of them write into the same trip, and a
        // batch would make the order of those writes depend on how fast the network answered.
        var chain = Promise.resolve();
        calls.forEach(function (call) {
          chain = chain.then(function () {
            return TP.ai.tools.dispatch(call, { onTool: h.onTool }).then(function (out) {
              if (out.citations && out.citations.length) {
                citations = citations.concat(out.citations);
              }
              messages.push({
                role: 'tool',
                tool_call_id: call.id || (call.function && call.function.name),
                name: out.name,
                content: out.content,
              });
            });
          });
        });
        return chain.then(function () {
          if (citations.length && h.onCitations) h.onCitations(unique(citations));
          return step();
        });
      });
    }

    return step().then(function () {
      if (stoppedReason === 'limit' && h.onMessage) {
        h.onMessage({ role: 'system', content:
          'The agent reached its iteration limit and stopped. Review the itinerary and ask for more if it is incomplete.' });
      }
      return finish();
    }, function (e) {
      stoppedReason = 'error';
      if (h.onError) h.onError({ kind: 'http', status: 0, message: (e && e.message) || 'The agent stopped unexpectedly.' });
      return finish();
    });

    function finish() {
      var changed = TP.canonical.serialize(TP.store.trip()) !== before;
      TP.store.releaseCommits();
      // One commit for the whole run, and none at all if the agent wrote nothing.
      if (changed) {
        TP.store.commit('AI planning', { automatic: false });
      } else if (dirtyBefore) {
        // The run changed nothing, but there were unsaved edits before it started. Leaving them
        // uncommitted is correct: the user has not finished with them.
        TP.store.emit('edit');
      }
      saveConversation(conversationId, messages, stoppedReason);
      if (h.onDone) h.onDone({ iterations: iterations, stoppedReason: stoppedReason, conversationId: conversationId, changed: changed });
      return { ok: stoppedReason !== 'error', iterations: iterations, stoppedReason: stoppedReason, changed: changed };
    }
  }

  function unique(urls) {
    var seen = Object.create(null);
    var out = [];
    urls.forEach(function (u) {
      if (!u || seen[u]) return;
      seen[u] = true;
      out.push(u);
    });
    return out;
  }

  // Conversations are app-local and never enter the container (REQ-410). They are kept so a panel
  // reopened in the same browser can show what was said; they are not part of the document.
  function saveConversation(id, messages, stoppedReason) {
    var storage = TP.store.storage();
    if (!storage || !storage.available()) return;
    var docId = TP.store.docIdOf(TP.store.container()) || 'unknown';
    try {
      TP.registry.saveConversation(storage, {
        id: id,
        tripId: docId,                 // the registry's own key for "which document"
        stoppedReason: stoppedReason,
        createdAt: Date.now(),
        endedAt: new Date().toISOString(),
        messages: messages.map(compact).slice(-200),
      });
    } catch (e) {
      // A conversation that could not be stored is not worth a dialog: the trip is unaffected.
    }
  }

  function compact(m) {
    return {
      role: m.role,
      content: typeof m.content === 'string' ? m.content : null,
      name: m.name,
      tool_calls: m.tool_calls ? m.tool_calls.map(function (c) {
        return { id: c.id, name: c.function && c.function.name };
      }) : undefined,
    };
  }

  function conversationsFor(docId) {
    var storage = TP.store.storage();
    if (!storage || !storage.available()) return [];
    try { return TP.registry.listConversations(storage, docId); } catch (e) { return []; }
  }

  // The panel's clear-chat action reaches storage through here, never directly (REQ-401). An
  // absent, read-only, or throwing storage yields zero removed rather than an error: the on-screen
  // transcript still clears, and nothing claims a deletion that did not happen (PAT-INV-02).
  // Scoped to one document by `deleteConversations` (REQ-413).
  function deleteConversationsFor(docId) {
    var storage = TP.store.storage();
    if (!storage || !storage.available()) return 0;
    try { return TP.registry.deleteConversations(storage, docId); } catch (e) { return 0; }
  }

  return {
    runAgent: runAgent,
    conversationsFor: conversationsFor,
    deleteConversationsFor: deleteConversationsFor,
  };
})();
