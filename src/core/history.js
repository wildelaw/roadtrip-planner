// The commit DAG (specs/04-versioning.md). Pure logic: no DOM, no storage, no browser APIs,
// so the whole of it is testable under plain Node.
//
// A commit is stored as exactly ONE of a snapshot or a delta against its parent (REQ-308).
// `snapshot` and `delta` are never hash inputs (REQ-302) — which is what makes re-keyframing
// and compaction free, and what stops two copies of one history desynchronising because
// they store it differently.

TP.history = (function () {
  'use strict';

  var KEYFRAME_INTERVAL = 20;   // REQ-310

  // ---- Hashing (REQ-301) ----

  function payloadHash(payload) {
    return TP.canonical.hash(payload);
  }

  // `docId` is one of the seven fields `REQ-301` puts in the commit hash, and a commit is bound to the
  // document it belongs to: the container schema requires a `docId`, and `verify.chain` requires it to
  // be a NON-EMPTY string (src/core/verify.js: "if (typeof c.docId !== 'string' || !c.docId)").
  //
  // It is passed through exactly as the caller gave it. Substituting a default here was tried and
  // reverted: defaulting to `''` manufactured a commit that the schema accepted and the integrity
  // check refused, which is two answers to one question, and defaulting to anything else would be this
  // module inventing an identity for a document. A caller that omits it gets a commit both of them
  // reject — which is correct, and is why every caller in the app supplies the registry's docId.
  function commitHash(fields) {
    var parents = (fields.parents || []).slice().sort();
    return TP.canonical.hash({
      parents: parents,
      docId: fields.docId,
      author: { name: fields.author.name, email: fields.author.email },
      timestamp: fields.timestamp,
      message: fields.message,
      payloadHash: fields.payloadHash,
    });
  }

  function makeCommit(fields) {
    var parents = (fields.parents || []).slice().sort();
    var base = {
      docId: fields.docId,
      parents: parents,
      author: { name: fields.author.name, email: fields.author.email },
      timestamp: fields.timestamp,
      message: fields.message,
      payloadHash: fields.payloadHash,
    };
    var commit = {
      id: commitHash(base),
      docId: base.docId,
      parents: parents,
      author: base.author,
      timestamp: base.timestamp,
      message: base.message,
      payloadHash: base.payloadHash,
    };
    if (fields.snapshot !== undefined) commit.snapshot = fields.snapshot;
    if (fields.delta !== undefined) commit.delta = fields.delta;
    return commit;
  }

  function newHistory(interval) {
    return { keyframeInterval: interval || KEYFRAME_INTERVAL, head: null, commits: [] };
  }

  // ---- Reading the DAG ----

  function index(history) {
    var map = Object.create(null);
    var list = (history && history.commits) || [];
    for (var i = 0; i < list.length; i++) map[list[i].id] = list[i];
    return map;
  }

  function find(history, id) {
    if (!id) return null;
    var list = (history && history.commits) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function head(history) {
    return find(history, history && history.head);
  }

  // Depth-first over parents, returning a Set of every commit reachable from `id`.
  function reachable(history, id) {
    var map = index(history);
    var seen = Object.create(null);
    var stack = id ? [id] : [];
    while (stack.length) {
      var cur = stack.pop();
      if (!cur || seen[cur]) continue;
      seen[cur] = true;
      var c = map[cur];
      if (!c) continue;
      for (var i = 0; i < c.parents.length; i++) stack.push(c.parents[i]);
    }
    return seen;
  }

  function isAncestor(history, a, b) {
    if (!a || !b) return false;
    if (a === b) return false;
    var r = reachable(history, b);
    return !!r[a];
  }

  // The linear chain from a keyframe up to `id`, in application order.
  function chainToNearestKeyframe(history, id) {
    var map = index(history);
    var chain = [];
    var cur = id;
    var guard = 0;
    while (cur) {
      if (++guard > 1000000) throw new Error('history: cycle or runaway chain at ' + cur);
      var c = map[cur];
      if (!c) throw new Error('history: no commit ' + cur);
      chain.push(c);
      if (c.snapshot !== undefined) break;
      if (c.parents.length !== 1) {
        throw new Error('history: commit ' + cur + ' is a delta with ' + c.parents.length + ' parents');
      }
      cur = c.parents[0];
    }
    return chain.reverse();
  }

  // Reconstruct the payload at a commit by replaying from the nearest preceding keyframe,
  // so cost is bounded by the interval rather than by the history length (REQ-311).
  function reconstruct(history, id) {
    var chain = chainToNearestKeyframe(history, id);
    if (!chain.length) throw new Error('history: empty chain');
    var first = chain[0];
    if (first.snapshot === undefined) throw new Error('history: chain has no keyframe');
    var payload = first.snapshot;
    for (var i = 1; i < chain.length; i++) {
      payload = TP.patch.apply(payload, chain[i].delta || []);
    }
    return payload;
  }

  function headPayload(history) {
    if (!history || !history.head) return null;
    return reconstruct(history, history.head);
  }

  // Commits between the last keyframe and `commit`'s parent, inclusive of neither end.
  function distanceSinceKeyframe(history, parentId) {
    var map = index(history);
    var n = 0;
    var cur = parentId;
    var guard = 0;
    while (cur) {
      if (++guard > 1000000) throw new Error('history: cycle while measuring keyframe distance');
      var c = map[cur];
      if (!c) return n;
      if (c.snapshot !== undefined) return n;
      n++;
      if (c.parents.length !== 1) return n;
      cur = c.parents[0];
    }
    return n;
  }

  // ---- Writing ----

  // The four keyframe rules (REQ-309). Rules 1–3 are correctness; rule 4 is a heuristic and
  // is stated as one so that changing the interval is not mistaken for changing behaviour.
  function decideStorage(history, parents, payload, parentPayload) {
    if (!parents.length) return { kind: 'keyframe', reason: 'root' };
    if (parents.length > 1) return { kind: 'keyframe', reason: 'merge' };

    var snapshotBytes = TP.sha256.utf8Bytes(TP.canonical.serialize(payload)).length;
    var delta = TP.patch.diff(parentPayload, payload);
    var deltaBytes = TP.patch.byteSize(delta);
    if (deltaBytes >= snapshotBytes) return { kind: 'keyframe', reason: 'patch-larger-than-snapshot' };

    var interval = (history && history.keyframeInterval) || KEYFRAME_INTERVAL;
    if (distanceSinceKeyframe(history, parents[0]) + 1 >= interval) {
      return { kind: 'keyframe', reason: 'interval' };
    }
    return { kind: 'delta', reason: 'incremental', delta: delta };
  }

  // Append a commit. Returns { commit, history } — the history is a new object so callers
  // cannot accidentally hold a half-written one.
  function append(history, payload, meta) {
    var h = history || newHistory();
    var parents = (meta.parents || (h.head ? [h.head] : [])).slice().sort();
    var parentPayload = null;
    if (parents.length) parentPayload = reconstruct(h, parents[0]);

    var decision = decideStorage(h, parents, payload, parentPayload);
    var commit = makeCommit({
      docId: meta.docId,
      parents: parents,
      author: meta.author,
      timestamp: meta.timestamp || new Date().toISOString(),
      message: meta.message || '',
      payloadHash: payloadHash(payload),
    });
    if (decision.kind === 'keyframe') commit.snapshot = payload;
    else commit.delta = decision.delta;

    var next = {
      keyframeInterval: h.keyframeInterval || KEYFRAME_INTERVAL,
      head: commit.id,
      commits: h.commits.concat([commit]),
    };
    return { commit: commit, history: next, decision: decision };
  }

  // A merge commit always has two or more parents and is always a keyframe (rule 2).
  function merge(history, payload, parentIds, meta) {
    return append(history, payload, {
      docId: meta.docId,
      parents: parentIds,
      author: meta.author,
      timestamp: meta.timestamp,
      message: meta.message,
    });
  }

  // ---- Ordering (REQ-312) ----

  var IDENTICAL = 'IDENTICAL';
  var A_NEWER = 'A_NEWER';
  var B_NEWER = 'B_NEWER';
  var DIVERGED = 'DIVERGED';

  // Ancestry decides. A clock never does: timestamps come from untrusted client clocks, and
  // a machine with a wrong clock would otherwise silently win every reconcile.
  function compare(historyA, headA, historyB, headB) {
    if (!headA && !headB) return IDENTICAL;
    if (!headA) return B_NEWER;
    if (!headB) return A_NEWER;
    if (headA === headB) return IDENTICAL;
    if (isAncestor(historyB, headA, headB)) return B_NEWER;
    if (isAncestor(historyA, headB, headA)) return A_NEWER;
    return DIVERGED;
  }

  // Commits are content-addressed, so a commit id means the same record in either history.
  // Merging the two indexes is therefore safe, and it lets one walk see both sides.
  function mergedIndex(historyA, historyB) {
    var map = index(historyA);
    var b = index(historyB);
    for (var k in b) if (!map[k]) map[k] = b[k];
    return map;
  }

  function reachableFromMap(map, id) {
    var seen = Object.create(null);
    var stack = id ? [id] : [];
    while (stack.length) {
      var cur = stack.pop();
      if (!cur || seen[cur]) continue;
      seen[cur] = true;
      var c = map[cur];
      if (!c) continue;
      for (var i = 0; i < c.parents.length; i++) stack.push(c.parents[i]);
    }
    return seen;
  }

  // The nearest common ancestor of two heads, or null when there is none. "Nearest" is by
  // breadth-first distance from headB, which is the merge base for the linear and
  // fast-forward cases this app actually creates. The compare view only needs a base to
  // display (04-versioning.md §7.3), so an approximation is honest here in a way it would
  // not be for ordering, where ancestry decides.
  function mergeBase(historyA, historyB, headA, headB) {
    var map = mergedIndex(historyA, historyB);
    var ra = reachableFromMap(map, headA);
    var level = Object.create(null);
    var queue = headB ? [headB] : [];
    var seen = Object.create(null);
    level[headB] = 0;
    while (queue.length) {
      var cur = queue.shift();
      if (!cur || seen[cur]) continue;
      seen[cur] = true;
      if (ra[cur]) return cur;                    // first (nearest) common ancestor
      var c = map[cur];
      if (!c) continue;
      for (var i = 0; i < c.parents.length; i++) {
        if (level[c.parents[i]] === undefined) level[c.parents[i]] = level[cur] + 1;
        queue.push(c.parents[i]);
      }
    }
    return null;
  }

  // ---- Compaction (REQ-319) ----
  //
  // Rewrites the storage representation without touching ids. That is only possible because
  // the hash never covers the representation (REQ-302) — the payoff for that choice.

  function compact(history, options) {
    var opts = options || {};
    var list = (history && history.commits) || [];
    var reach = reachable(history, history && history.head);
    var unreachable = [];
    for (var i = 0; i < list.length; i++) if (!reach[list[i].id]) unreachable.push(list[i].id);

    var before = TP.sha256.utf8Bytes(TP.canonical.serialize(list)).length;
    var next = newHistory(history.keyframeInterval);
    var rebuilt = [];
    var keyframes = 0;

    // Replay in the history's own (topological) order, re-deciding storage for each commit
    // against the compacted history so far.
    //
    // A commit that the head cannot reach is KEPT unless the caller explicitly asked for it to go
    // (REQ-318, PAT-INV-05, 04-versioning.md §9.1). Compaction rewrites the storage representation;
    // deciding that a commit nobody can currently reach is unwanted is a different act, and one this
    // app may only take on an informed confirmation. `removeOrphans` IS that confirmation, so the
    // branch that discards is the branch that needs the flag — not the branch that keeps.
    for (var j = 0; j < list.length; j++) {
      var c = list[j];
      if (!reach[c.id]) {
        if (!opts.removeOrphans) rebuilt.push(passthrough(c));
        continue;
      }
      var payload = reconstruct(history, c.id);
      var parentPayload = null;
      if (c.parents.length) parentPayload = reconstruct(history, c.parents[0]);
      var decision = decideStorage(next, c.parents, payload, parentPayload);
      var copy = {
        id: c.id, docId: c.docId, parents: c.parents.slice(),
        author: { name: c.author.name, email: c.author.email },
        timestamp: c.timestamp, message: c.message, payloadHash: c.payloadHash,
      };
      if (decision.kind === 'keyframe') { copy.snapshot = payload; keyframes++; }
      else copy.delta = decision.delta;
      if (copy.id !== c.id) throw new Error('compaction changed a commit id: ' + c.id + ' -> ' + copy.id);
      rebuilt.push(copy);
    }
    next.head = history.head;
    next.commits = rebuilt;

    var after = TP.sha256.utf8Bytes(TP.canonical.serialize(rebuilt)).length;
    var report = {
      before: before,
      after: after,
      saved: before - after,
      keyframesBefore: countKeyframes(list),
      keyframesAfter: keyframes,
      unreachable: unreachable,
      removeOrphans: !!opts.removeOrphans,
      keptOrphans: opts.removeOrphans ? 0 : unreachable.length,
      removedOrphans: opts.removeOrphans ? unreachable.length : 0,
    };
    return { history: next, report: report };
  }

  // An unreachable commit, carried across a compaction byte for byte.
  //
  // It is NOT re-decided and NOT re-keyframed. Nothing can reconstruct its payload — reconstruction
  // walks back from the head, and that is exactly the walk that cannot reach it — so there is no
  // payload to store as a snapshot. Its stored bytes already hash to its id, so copying them is the
  // only operation that is guaranteed to leave the id alone (REQ-319).
  function passthrough(commit) {
    var copy = {
      id: commit.id, docId: commit.docId, parents: commit.parents.slice(),
      author: { name: commit.author.name, email: commit.author.email },
      timestamp: commit.timestamp, message: commit.message, payloadHash: commit.payloadHash,
    };
    if (commit.snapshot !== undefined) copy.snapshot = commit.snapshot;
    if (commit.delta !== undefined) copy.delta = commit.delta.slice();
    return copy;
  }

  function countKeyframes(list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (list[i].snapshot !== undefined) n++;
    return n;
  }

  // ---- Integrity helpers -------------------------------------------------------------
  //
  // `verify.js` owns the verdicts; these are the two facts it needs and they live here so
  // the DAG has exactly one reader.

  function recomputeId(commit) {
    return commitHash({
      parents: commit.parents || [],
      docId: commit.docId,
      author: commit.author || { name: '', email: '' },
      timestamp: commit.timestamp,
      message: commit.message,
      payloadHash: commit.payloadHash,
    });
  }

  return {
    KEYFRAME_INTERVAL: KEYFRAME_INTERVAL,
    IDENTICAL: IDENTICAL,
    A_NEWER: A_NEWER,
    B_NEWER: B_NEWER,
    DIVERGED: DIVERGED,
    newHistory: newHistory,
    payloadHash: payloadHash,
    commitHash: commitHash,
    makeCommit: makeCommit,
    append: append,
    merge: merge,
    find: find,
    head: head,
    index: index,
    reachable: reachable,
    isAncestor: isAncestor,
    reconstruct: reconstruct,
    headPayload: headPayload,
    distanceSinceKeyframe: distanceSinceKeyframe,
    decideStorage: decideStorage,
    compare: compare,
    mergeBase: mergeBase,
    compact: compact,
    countKeyframes: countKeyframes,
    recomputeId: recomputeId,
  };
})();
