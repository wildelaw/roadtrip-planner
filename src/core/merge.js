// Ancestry, comparison and the reconcile decision (specs/04-versioning.md §6, §7).
//
// Pure: given the embedded history and whatever local history exists — including none — it
// returns what should happen. Nothing here writes, and nothing here resolves a divergence:
// that is a human's job and the app does not guess (REQ-313, PAT-INV-04).

TP.merge = (function () {
  'use strict';

  var ADOPT = 'adopt';                 // no local copy: take the file's history
  var IDENTICAL = 'identical';         // same head
  var FAST_FORWARD = 'fast-forward';   // the file is strictly ahead: adopt silently
  var KEEP_LOCAL = 'keep-local';       // local is strictly ahead: keep it, offer an updated file
  var DIVERGED = 'diverged';           // both sides have work: stop and ask
  var SEPARATE = 'separate';           // different documents: register side by side, never merge

  function plan(embedded, local) {
    var e = embedded && embedded.history;
    var l = local && local.history;

    if (!e || !e.commits || !e.commits.length) {
      if (l && l.commits && l.commits.length) return { action: KEEP_LOCAL, reason: 'the file carries no history' };
      return { action: ADOPT, reason: 'the file carries no history' };
    }
    if (!l || !l.commits || !l.commits.length) {
      return { action: ADOPT, reason: 'no local history' };
    }

    if (embedded.docId && local.docId && embedded.docId !== local.docId) {
      return { action: SEPARATE, reason: 'different document ids' };
    }

    var base = TP.history.mergeBase(e, l, e.head, l.head);
    if (!base && e.head !== l.head) {
      return { action: SEPARATE, reason: 'no common ancestor' };
    }

    // A is the embedded history (the file) and B the local one, so A_NEWER means the file moved on
    // and B_NEWER means this browser did. The two verdicts name the arguments by position, not by
    // which side "wins", and getting them the wrong way round adopts the older copy in both
    // directions (04-versioning.md §7).
    var verdict = TP.history.compare(e, e.head, l, l.head);
    if (verdict === TP.history.IDENTICAL) return { action: IDENTICAL, reason: 'same head' };
    if (verdict === TP.history.A_NEWER) return { action: FAST_FORWARD, reason: 'the file is ahead of this copy' };
    if (verdict === TP.history.B_NEWER) return { action: KEEP_LOCAL, reason: 'this copy is ahead of the file' };
    return { action: DIVERGED, reason: 'both copies have changes', base: base };
  }

  // The coarse prompt the first version ships (04-versioning.md §7.3; the three-way view is
  // deferred as Q-5). A three-way compare may pre-select suggestions, but nothing is written
  // until confirmed — and nothing is auto-merged either way.
  function optionsFor(planResult) {
    if (planResult.action === DIVERGED) {
      return [
        { id: 'keep-local',  label: 'Keep this copy',  hint: 'Your local copy stays as it is. The file is left alone.' },
        { id: 'take-file',   label: 'Take the file',   hint: 'Your local history is kept; the file becomes the new head as a merge commit.' },
      ];
    }
    return [];
  }

  return {
    ADOPT: ADOPT,
    IDENTICAL: IDENTICAL,
    FAST_FORWARD: FAST_FORWARD,
    KEEP_LOCAL: KEEP_LOCAL,
    DIVERGED: DIVERGED,
    SEPARATE: SEPARATE,
    plan: plan,
    optionsFor: optionsFor,
  };
})();
