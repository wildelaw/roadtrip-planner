// Integrity verification (specs/04-versioning.md §5, REQ-316, REQ-317).
//
// Two levels, because full verification is expensive and mostly unnecessary:
//
//   chain    stored fields hash to each commit's declared id; every parent id exists.
//            O(N), no reconstruction. Runs ALWAYS, at boot.
//   payload  reconstruct the payload and recompute its hash. Expensive, so it runs at the
//            head and on any commit the user inspects.
//
// A failure never repairs anything. Repairing means guessing, and a guess that parses is a
// guess that gets written back and circulated as fact.

TP.verify = (function () {
  'use strict';

  function chain(history) {
    var errors = [];
    var list = (history && history.commits) || [];
    var map = TP.history.index(history);

    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var id = c && c.id;

      if (!c || typeof c !== 'object') {
        errors.push({ commitId: null, problem: 'commit at position ' + i + ' is not an object' });
        continue;
      }
      if (typeof c.docId !== 'string' || !c.docId) {
        errors.push({ commitId: id, problem: 'no docId' });
      }
      if (!Array.isArray(c.parents)) {
        errors.push({ commitId: id, problem: 'parents is not a list' });
      } else {
        for (var p = 0; p < c.parents.length; p++) {
          if (!map[c.parents[p]]) {
            errors.push({ commitId: id, problem: 'parent ' + c.parents[p] + ' is not present in this file' });
          }
        }
      }
      var hasSnapshot = c.snapshot !== undefined;
      var hasDelta = c.delta !== undefined;
      if (hasSnapshot === hasDelta) {
        errors.push({
          commitId: id,
          problem: hasSnapshot
            ? 'carries both a snapshot and a delta; exactly one is permitted'
            : 'carries neither a snapshot nor a delta',
        });
      }
      if (hasDelta && Array.isArray(c.parents) && c.parents.length !== 1) {
        errors.push({ commitId: id, problem: 'a delta must have exactly one parent, this has ' + c.parents.length });
      }
      var declared = null;
      try { declared = TP.history.recomputeId(c); } catch (e) { declared = null; }
      if (declared !== id) {
        errors.push({
          commitId: id,
          problem: 'the stored fields hash to ' + declared + ', not to the declared id',
        });
      }
    }

    if (history && history.head && !map[history.head]) {
      errors.push({ commitId: history.head, problem: 'the head names a commit that is not present in this file' });
    }

    return {
      ok: errors.length === 0,
      checked: list.length,
      errors: errors,
      firstBad: errors.length ? errors[0].commitId : null,
    };
  }

  function payload(history, id) {
    var target = id || (history && history.head);
    if (!target) return { ok: true, commitId: null, errors: [] };
    var c = TP.history.find(history, target);
    if (!c) return { ok: false, commitId: target, errors: [{ commitId: target, problem: 'no such commit' }] };
    var errors = [];
    try {
      var rebuilt = TP.history.reconstruct(history, target);
      var computed = TP.history.payloadHash(rebuilt);
      if (computed !== c.payloadHash) {
        errors.push({
          commitId: target,
          problem: 'the reconstructed payload hashes to ' + computed + ', not to the recorded ' + c.payloadHash,
        });
      }
    } catch (e) {
      errors.push({ commitId: target, problem: 'the payload could not be reconstructed: ' + e.message });
    }
    return { ok: errors.length === 0, commitId: target, errors: errors };
  }

  // The honest label (REQ-320). This is integrity, not authorship: a rebuilt chain proves the
  // history has not changed since it was written, and proves nothing about who wrote it.
  function label(result) {
    if (!result) return 'chain not checked';
    if (result.ok) {
      return result.checked === 1
        ? 'chain intact — 1 commit'
        : 'chain intact — ' + result.checked + ' commits';
    }
    return 'chain broken at ' + shortId(result.firstBad);
  }

  function shortId(id) {
    if (!id) return '(unknown commit)';
    var s = String(id);
    var colon = s.indexOf(':');
    var body = colon === -1 ? s : s.slice(colon + 1);
    return body.slice(0, 12);
  }

  return {
    chain: chain,
    payload: payload,
    label: label,
    shortId: shortId,
  };
})();
