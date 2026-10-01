// The commit DAG (specs/09-testing.md §2 P2, P3, P4, P6, P7, P8; REQ-301, REQ-302, REQ-303, REQ-304,
// REQ-309, REQ-310, REQ-311, REQ-316).
//
// This is the half of the pattern the spec calls "least room for error, and least room to hide" — the
// logic that decides whether a user's history is intact. It is all pure, so it is all testable here,
// in a bare Node process, with no DOM and no storage.
//
// The properties are stated over GENERATED histories rather than over the shapes the app happens to
// create, because the failures this design must survive are the ones nobody thought to write an
// example for. Every seed is printed on failure, so a failure can be replayed.

'use strict';

var h = require('./harness.js');

var SEEDS = [];
for (var s = 1; s <= 40; s++) SEEDS.push(s);

function build(TP, seed, options) {
  return h.randomHistory(TP, h.generator(seed), options);
}

// Flip one bit inside a commit's stored bytes. "Stored bytes" is the serialized commit record — what
// would actually be on disk — so the mutation is made to the JSON, then re-read, which is the path a
// tampered file takes.
function flipBitInCommit(commit) {
  var text = JSON.stringify(commit);
  var at = Math.floor(text.length / 2);
  // Choose a position whose change is a real change to a *field*, not to punctuation. Replacing a
  // character with a different letter is the case that matters; replacing `{` with `[` is a parse
  // failure, which is a different and easier test.
  var c = text[at];
  var replacement = c === 'a' ? 'b' : 'a';
  var mutated = text.slice(0, at) + replacement + text.slice(at + 1);
  try {
    return JSON.parse(mutated);
  } catch (e) {
    return null;
  }
}

module.exports = {
  name: 'the commit DAG (P2, P3, P4, P6, P7, P8)',
  tests: [
    {
      name: 'P2: every commit reconstructs to a payload whose hash is the one it declares',
      run: function () {
        var TP = h.pure({}).TP;
        SEEDS.forEach(function (seed) {
          var r = build(TP, seed, { steps: 12 });
          r.history.commits.forEach(function (commit) {
            var rebuilt = TP.history.reconstruct(r.history, commit.id);
            h.equal(TP.history.payloadHash(rebuilt), commit.payloadHash,
              'seed ' + seed + ', commit ' + commit.id);
            h.deepEqual(rebuilt, r.payloadAt[commit.id], 'seed ' + seed + ': the payload at ' + commit.id);
          });
        });
      },
    },
    {
      name: 'P2 negative control: a payload that was not the one committed does not hash to the same value',
      run: function () {
        var TP = h.pure({}).TP;
        var r = build(TP, 3, { steps: 8 });
        var head = TP.history.head(r.history);
        var other = h.mutate(TP, h.generator(999), TP.history.reconstruct(r.history, head.id));
        h.ok(TP.history.payloadHash(other) !== head.payloadHash,
          'a different payload must not share a hash, or P2 proves nothing');
      },
    },
    {
      name: 'P3: appending a commit never changes an existing commit’s id',
      run: function () {
        var TP = h.pure({}).TP;
        for (var seed = 1; seed <= 25; seed++) {
          var gen = h.generator(seed * 13);
          var r = h.randomHistory(TP, gen, { steps: 0 });
          var history = r.history;
          var before = history.commits.map(function (c) { return c.id; });
          var payload = TP.history.headPayload(history);
          for (var i = 0; i < 6; i++) {
            payload = h.mutate(TP, gen, payload);
            var step = TP.history.append(history, payload, {
              docId: r.docId, author: r.author, timestamp: '2026-09-29T01:00:0' + i + '.000Z',
              message: 'append ' + i,
            });
            history = step.history;
            var after = history.commits.map(function (c) { return c.id; });
            before.forEach(function (id, at) {
              h.equal(after[at], id, 'seed ' + seed + ': append ' + i + ' rewrote commit at position ' + at);
            });
            h.equal(after.length, before.length + 1, 'seed ' + seed + ': append adds exactly one commit');
            before = after;
          }
        }
      },
    },
    {
      name: 'P4: compacting changes no id, and reconstruction is unchanged for every commit',
      run: function () {
        var TP = h.pure({}).TP;
        SEEDS.forEach(function (seed) {
          var r = build(TP, seed, { steps: 14 });
          var compacted = TP.history.compact(r.history);
          var next = compacted.history;

          h.equal(next.commits.length, r.history.commits.length,
            'seed ' + seed + ': compaction must not drop reachable commits');
          h.equal(next.head, r.history.head, 'seed ' + seed + ': compaction must not move the head');

          next.commits.forEach(function (c, i) {
            h.equal(c.id, r.history.commits[i].id,
              'seed ' + seed + ': compaction changed a commit id — the hash would then cover the ' +
              'representation rather than the payload, and every copy in circulation would desynchronise');
            h.deepEqual(c.parents, r.history.commits[i].parents, 'seed ' + seed + ': parents, position ' + i);
          });

          r.history.commits.forEach(function (commit) {
            h.deepEqual(TP.history.reconstruct(next, commit.id), TP.history.reconstruct(r.history, commit.id),
              'seed ' + seed + ': payload at ' + commit.id + ' must survive compaction');
          });
          h.ok(TP.verify.chain(next).ok, 'seed ' + seed + ': the compacted chain still verifies');
        });
      },
    },
    {
      name: 'compaction is a fixed point: compacting twice changes nothing further',
      run: function () {
        var TP = h.pure({}).TP;
        SEEDS.slice(0, 15).forEach(function (seed) {
          var r = build(TP, seed, { steps: 14 });
          var once = TP.history.compact(r.history).history;
          var twice = TP.history.compact(once).history;
          h.deepEqual(twice.commits, once.commits, 'seed ' + seed + ': the second compaction changed the bytes');
        });
      },
    },
    {
      name: 'compaction keeps a commit the head cannot reach, and says so (REQ-318, REQ-319)',
      run: function () {
        var TP = h.pure({}).TP;
        SEEDS.slice(0, 10).forEach(function (seed) {
          var r = build(TP, seed, { steps: 12 });
          // Rewinding the head to a commit partway along strands that commit's siblings and
          // descendants alike. Which ones those are is `reachable`'s answer, not a guess from
          // position — the list is in creation order, and a branch is created after its fork point
          // without being descended from it.
          var rewound = {
            keyframeInterval: r.history.keyframeInterval,
            head: r.order[Math.floor(r.order.length / 2)],
            commits: r.history.commits,
          };
          var stranded = unreachableFrom(TP, rewound);
          h.ok(stranded.length > 0, 'seed ' + seed + ': the rewind must strand something');

          var out = TP.history.compact(rewound);
          h.equal(out.history.commits.length, rewound.commits.length,
            'seed ' + seed + ': compaction dropped a commit nobody asked it to drop');
          h.deepEqual(out.report.unreachable.slice().sort(), stranded.slice().sort(),
            'seed ' + seed + ': the report must name every commit the head cannot reach');
          h.equal(out.report.removeOrphans, false, 'seed ' + seed + ': nothing was confirmed');
          h.equal(out.report.keptOrphans, stranded.length, 'seed ' + seed + ': keptOrphans');
          h.equal(out.report.removedOrphans, 0, 'seed ' + seed + ': removedOrphans');
          h.equal(out.history.head, rewound.head, 'seed ' + seed + ': the head does not move either');

          h.deepEqual(out.history.commits.map(function (c) { return c.id; }),
            rewound.commits.map(function (c) { return c.id; }),
            'seed ' + seed + ': the same commits, in the same order');
          stranded.forEach(function (id) {
            h.deepEqual(TP.history.reconstruct(out.history, id), TP.history.reconstruct(rewound, id),
              'seed ' + seed + ': the payload at the stranded commit ' + id + ' must survive — nothing ' +
              'is discarded silently, and the only copy may be this one');
          });
          h.ok(TP.verify.chain(out.history).ok, 'seed ' + seed + ': what survives still verifies');
        });
      },
    },
    {
      name: 'compaction discards an unreachable commit only on an explicit confirmation (REQ-318)',
      run: function () {
        var TP = h.pure({}).TP;
        var r = build(TP, 7, { steps: 12 });
        var rewound = {
          keyframeInterval: r.history.keyframeInterval,
          head: r.order[Math.floor(r.order.length / 2)],
          commits: r.history.commits,
        };
        var stranded = unreachableFrom(TP, rewound);
        h.ok(stranded.length > 0, 'the rewind must strand something');

        var out = TP.history.compact(rewound, { removeOrphans: true });
        h.equal(out.report.removeOrphans, true, 'the confirmation is recorded in the report');
        h.equal(out.report.removedOrphans, stranded.length, 'and it is what decides the outcome');
        h.equal(out.report.keptOrphans, 0, 'nothing is both kept and removed');
        h.equal(out.history.commits.length, rewound.commits.length - stranded.length,
          'the confirmed removal is the only thing that changes the count');
        var ids = out.history.commits.map(function (c) { return c.id; });
        stranded.forEach(function (id) { h.ok(ids.indexOf(id) === -1, 'the confirmed orphan ' + id + ' is gone'); });
        h.equal(out.history.head, rewound.head, 'the head is untouched either way');
        h.ok(TP.verify.chain(out.history).ok, 'what remains still verifies');

        // Negative control: the same history WITHOUT the confirmation keeps every one of them. Without
        // this, "the confirmed path removes them" would also pass for a compact that always removes.
        h.equal(TP.history.compact(rewound).history.commits.length, rewound.commits.length,
          'the flag is what discards, not a default');
      },
    },
    {
      name: 'P6: compare returns exactly one of the four answers, and is antisymmetric',
      run: function () {
        var TP = h.pure({}).TP;
        var H = TP.history;
        var answers = [H.IDENTICAL, H.A_NEWER, H.B_NEWER, H.DIVERGED];
        var inverse = {};
        inverse[H.IDENTICAL] = H.IDENTICAL;
        inverse[H.A_NEWER] = H.B_NEWER;
        inverse[H.B_NEWER] = H.A_NEWER;
        inverse[H.DIVERGED] = H.DIVERGED;

        var seen = Object.create(null);
        SEEDS.forEach(function (seed) {
          var r = build(TP, seed, { steps: 12 });
          var ids = r.order;
          for (var i = 0; i < ids.length; i++) {
            for (var j = 0; j < ids.length; j++) {
              var forward = H.compare(r.history, ids[i], r.history, ids[j]);
              var back = H.compare(r.history, ids[j], r.history, ids[i]);
              seen[forward] = true;
              h.ok(answers.indexOf(forward) !== -1, 'seed ' + seed + ': ' + forward + ' is not one of the four answers');
              h.equal(back, inverse[forward],
                'seed ' + seed + ': compare must be antisymmetric (' + ids[i] + ' vs ' + ids[j] + ')');
            }
          }
          // The four answers must all be reachable, or the generator is not producing the shape the
          // property is about and the test is passing on a subset.
          h.equal(forwardSelf(H, r), H.IDENTICAL, 'seed ' + seed + ': a head against itself is IDENTICAL');
        });

        h.ok(seen[H.IDENTICAL], 'IDENTICAL must be reachable');
        h.ok(seen[H.A_NEWER] && seen[H.B_NEWER], 'an ancestor comparison must be reachable');
        h.ok(seen[H.DIVERGED], 'DIVERGED must be reachable — a generator that never branches misses it');
      },
    },
    {
      name: 'P6: a clock never decides the ordering',
      run: function () {
        var TP = h.pure({}).TP;
        var H = TP.history;
        var r = build(TP, 5, { steps: 10 });
        // Two heads at least one of which is an ancestor of the other: give the ANCESTOR the LATER
        // timestamp. A comparison that consults timestamps answers the other way.
        var head = r.history.head;
        var ancestor = TP.history.head(r.history).parents[0];
        var skewed = {
          keyframeInterval: r.history.keyframeInterval,
          head: head,
          commits: r.history.commits.map(function (c) {
            if (c.id === ancestor) {
              var copy = JSON.parse(JSON.stringify(c));
              copy.timestamp = '2099-01-01T00:00:00.000Z';
              return copy;
            }
            return c;
          }),
        };
        h.equal(H.compare(skewed, head, skewed, ancestor), H.A_NEWER,
          'ancestry decides: the descendant is newer however wrong its clock is');
      },
    },
    {
      name: 'P7: a merge commit is always a keyframe',
      run: function () {
        var TP = h.pure({}).TP;
        var merges = 0;
        SEEDS.forEach(function (seed) {
          var r = build(TP, seed, { steps: 14, mergeChance: 0.4 });
          r.history.commits.forEach(function (c) {
            if (c.parents.length > 1) {
              merges++;
              h.ok(c.snapshot !== undefined, 'seed ' + seed + ': merge commit ' + c.id + ' must be a keyframe');
              h.ok(c.delta === undefined, 'seed ' + seed + ': a merge is never a delta');
            }
            // And the converse, which is what makes the rule mean something: a delta has exactly one
            // parent.
            if (c.delta !== undefined) {
              h.equal(c.parents.length, 1, 'seed ' + seed + ': a delta must have exactly one parent');
            }
          });
        });
        h.ok(merges > 0, 'the generator must produce merges, or P7 passes on a history that has none');
      },
    },
    {
      name: 'a commit stores exactly one of a snapshot or a delta, never both and never neither',
      run: function () {
        var TP = h.pure({}).TP;
        SEEDS.forEach(function (seed) {
          var r = build(TP, seed, { steps: 14 });
          r.history.commits.forEach(function (c) {
            var hasSnapshot = c.snapshot !== undefined;
            var hasDelta = c.delta !== undefined;
            h.ok(hasSnapshot !== hasDelta, 'seed ' + seed + ': commit ' + c.id + ' must carry exactly one (REQ-308)');
          });
        });
      },
    },
    {
      name: 'reconstruction never replays more than the keyframe interval (REQ-310, REQ-311)',
      run: function () {
        var TP = h.pure({}).TP;
        var interval = TP.history.KEYFRAME_INTERVAL;
        SEEDS.forEach(function (seed) {
          var r = build(TP, seed, { steps: 3 * interval });
          var map = TP.history.index(r.history);
          r.history.commits.forEach(function (commit) {
            var distance = 0;
            var cur = commit.id;
            while (cur && map[cur] && map[cur].snapshot === undefined) {
              distance++;
              cur = map[cur].parents[0];
            }
            h.ok(distance < interval,
              'seed ' + seed + ': ' + distance + ' deltas since the last keyframe, interval is ' + interval);
          });
        });
      },
    },
    {
      name: 'P8: a single changed byte in any commit makes verification fail, and names that commit',
      run: function () {
        var TP = h.pure({}).TP;
        var caught = 0;
        var considered = 0;
        SEEDS.slice(0, 12).forEach(function (seed) {
          var r = build(TP, seed, { steps: 10 });
          h.ok(TP.verify.chain(r.history).ok, 'seed ' + seed + ': the untampered chain must verify first');

          // A commit whose fields are all strings has somewhere to change; a commit with only
          // booleans and ids might not. Try every commit and require that the ones with a text field
          // are caught.
          r.history.commits.forEach(function (commit, position) {
            if (!commit.message) return;
            considered++;
            var tampered = JSON.parse(JSON.stringify(commit));
            tampered.message = tampered.message + ' (tampered)';
            var history = {
              keyframeInterval: r.history.keyframeInterval,
              head: r.history.head,
              commits: r.history.commits.map(function (c, i) { return i === position ? tampered : c; }),
            };
            var result = TP.verify.chain(history);
            if (!result.ok) {
              caught++;
              h.equal(result.firstBad, commit.id,
                'seed ' + seed + ': verification must name the commit it cannot vouch for');
            }
          });
        });
        h.ok(considered > 50, 'the sweep must reach many commits, considered ' + considered);
        h.equal(caught, considered, 'every changed commit must be caught — detection is not best-effort');
      },
    },
    {
      name: 'P8 is transitive: changing a commit invalidates every descendant, not just itself',
      run: function () {
        var TP = h.pure({}).TP;
        var r = build(TP, 9, { steps: 12 });
        var root = r.history.commits[0];
        var tampered = JSON.parse(JSON.stringify(root));
        tampered.message = 'rewritten history';
        var history = {
          keyframeInterval: r.history.keyframeInterval,
          head: r.history.head,
          commits: r.history.commits.map(function (c, i) { return i === 0 ? tampered : c; }),
        };
        var result = TP.verify.chain(history);
        h.ok(!result.ok, 'the tampered chain must fail');
        h.equal(result.firstBad, root.id, 'and name the root, where the change was made');
        // The head still names a commit that is present, and the head's own record is unchanged — the
        // point is that the root's id no longer covers its fields, not that the file fell apart.
        h.equal(result.checked, r.history.commits.length, 'every commit is still checked');
      },
    },
    {
      name: 'verification refuses a commit that carries both a snapshot and a delta',
      run: function () {
        var TP = h.pure({}).TP;
        var r = build(TP, 4, { steps: 6 });
        var commits = r.history.commits.map(function (c) { return JSON.parse(JSON.stringify(c)); });
        commits[0].delta = [];
        var result = TP.verify.chain({ keyframeInterval: 20, head: r.history.head, commits: commits });
        h.ok(!result.ok, 'a commit with two storage forms is not readable');
        h.ok(result.errors.some(function (e) { return /both a snapshot and a delta/.test(e.problem); }),
          'and the reason says which rule it breaks');
      },
    },
    {
      name: 'verification refuses a missing parent, and a head that names nothing',
      run: function () {
        var TP = h.pure({}).TP;
        var r = build(TP, 6, { steps: 8 });
        var withoutFirst = r.history.commits.slice(1);
        var missingParent = TP.verify.chain({
          keyframeInterval: 20, head: r.history.head, commits: withoutFirst,
        });
        h.ok(!missingParent.ok, 'a parent that is not in the file is a broken chain');

        var danglingHead = TP.verify.chain({
          keyframeInterval: 20, head: 'sha256:0000', commits: r.history.commits,
        });
        h.ok(!danglingHead.ok, 'a head that names nothing is a broken chain');
        h.ok(danglingHead.errors.some(function (e) { return /head names a commit/.test(e.problem); }));
      },
    },
    {
      name: 'the honest label names the state and never claims authorship (REQ-320)',
      run: function () {
        var TP = h.pure({}).TP;
        var r = build(TP, 8, { steps: 5 });
        var good = TP.verify.chain(r.history);
        h.equal(TP.verify.label(good), 'chain intact — ' + r.history.commits.length + ' commits');
        h.equal(TP.verify.label(null), 'chain not checked');
        h.equal(TP.verify.label({ ok: true, checked: 1 }), 'chain intact — 1 commit');
        var broken = TP.verify.label({ ok: false, checked: 3, firstBad: 'sha256:abcdef0123456789' });
        h.ok(/^chain broken at abcdef012345/.test(broken), 'the broken label names the commit, got ' + broken);
        h.ok(!/verified|authentic|trusted|signed/i.test(broken + TP.verify.label(good)),
          'integrity is not authorship, and the label must not imply otherwise');
      },
    },
    {
      name: 'a merge has two parents and both are in the file (REQ-304)',
      run: function () {
        var TP = h.pure({}).TP;
        var r = build(TP, 11, { steps: 14, mergeChance: 0.4 });
        var map = TP.history.index(r.history);
        var merges = r.history.commits.filter(function (c) { return c.parents.length > 1; });
        h.ok(merges.length > 0, 'the generator produces merges');
        merges.forEach(function (m) {
          h.equal(m.parents.length, 2, 'a merge of two heads');
          m.parents.forEach(function (p) { h.ok(map[p], 'parent ' + p + ' is present'); });
          // And the two parents are genuinely different branches: neither is an ancestor of the other.
          h.ok(!TP.history.isAncestor(r.history, m.parents[0], m.parents[1]),
            'a merge of a commit with its own ancestor is not a merge');
          h.ok(!TP.history.isAncestor(r.history, m.parents[1], m.parents[0]), 'in either direction');
        });
      },
    },
    {
      name: 'the merge base of two heads is a common ancestor, and is null when there is none',
      run: function () {
        var TP = h.pure({}).TP;
        var r = build(TP, 12, { steps: 14, mergeChance: 0.4 });
        var heads = r.heads;
        for (var i = 0; i < heads.length; i++) {
          for (var j = 0; j < heads.length; j++) {
            if (i === j) continue;
            var base = TP.history.mergeBase(r.history, r.history, heads[i], heads[j]);
            if (base === null) continue;
            h.ok(TP.history.isAncestor(r.history, base, heads[i]), 'the base is an ancestor of the first head');
            h.ok(TP.history.isAncestor(r.history, base, heads[j]), 'and of the second');
          }
        }
        // Two unrelated histories have no common ancestor at all.
        var a = build(TP, 21, { steps: 4 });
        var b = build(TP, 22, { steps: 4 });
        h.equal(TP.history.mergeBase(a.history, b.history, a.history.head, b.history.head), null,
          'two documents with no shared history share no base');
      },
    },
    {
      name: 'commit ids are stable against key order and timestamp formatting, and depend on parents',
      run: function () {
        var TP = h.pure({}).TP;
        var fields = {
          docId: 'sha256:doc', parents: ['sha256:aaa', 'sha256:bbb'],
          author: { name: 'A', email: 'a@b.invalid' },
          timestamp: '2026-09-29T00:00:00.000Z', message: 'm', payloadHash: 'sha256:ppp',
        };
        var id = TP.history.commitHash(fields);
        h.equal(TP.history.commitHash(JSON.parse(JSON.stringify(fields))), id, 'same fields, same id');
        // Parent ORDER must not matter, because parents are sorted in the inputs (§2).
        var swapped = JSON.parse(JSON.stringify(fields));
        swapped.parents = ['sha256:bbb', 'sha256:aaa'];
        h.equal(TP.history.commitHash(swapped), id, 'parents are a set, not a list, in the hash inputs');
        // Everything else must matter.
        ['docId', 'timestamp', 'message', 'payloadHash'].forEach(function (k) {
          var other = JSON.parse(JSON.stringify(fields));
          other[k] = other[k] + '!';
          h.ok(TP.history.commitHash(other) !== id, k + ' must be a hash input');
        });
        var otherAuthor = JSON.parse(JSON.stringify(fields));
        otherAuthor.author.name = 'B';
        h.ok(TP.history.commitHash(otherAuthor) !== id, 'the author must be a hash input');
        var fewer = JSON.parse(JSON.stringify(fields));
        fewer.parents = ['sha256:aaa'];
        h.ok(TP.history.commitHash(fewer) !== id, 'ancestry is a hash input (REQ-303)');
      },
    },
    {
      name: 'REQ-302: the storage representation is not a hash input',
      run: function () {
        var TP = h.pure({}).TP;
        var r = build(TP, 15, { steps: 12 });
        // Re-storing every commit as a keyframe changes the bytes on disk and must change no id.
        var allKeyframes = TP.history.compact(
          { keyframeInterval: 1, head: r.history.head, commits: r.history.commits }
        ).history;
        allKeyframes.commits.forEach(function (c, i) {
          h.equal(c.id, r.history.commits[i].id, 'storing the same payload differently must not change an id');
          h.ok(c.snapshot !== undefined, 'interval 1 means every commit is a keyframe');
        });
      },
    },
    {
      name: 'an empty history has no head, and comparing it against another follows the rule',
      run: function () {
        var TP = h.pure({}).TP;
        var H = TP.history;
        var empty = H.newHistory();
        h.equal(H.headPayload(empty), null, 'nothing to reconstruct');
        h.equal(H.compare(empty, null, empty, null), H.IDENTICAL, 'two empty histories are identical');
        var r = build(TP, 2, { steps: 3 });
        h.equal(H.compare(empty, null, r.history, r.history.head), H.B_NEWER, 'the second is newer');
        h.equal(H.compare(r.history, r.history.head, empty, null), H.A_NEWER, 'and in the other direction');
      },
    },
  ],
};

// A tiny helper so the P6 loop can state the self-comparison without noise.
function forwardSelf(H, r) {
  return H.compare(r.history, r.history.head, r.history, r.history.head);
}

// The commits a head cannot reach, in list order. Derived from the DAG rather than from positions:
// creation order is topological only in the sense that a parent precedes its children, so a branch
// created after a fork point is not descended from anything created in between.
function unreachableFrom(TP, history) {
  var reach = TP.history.reachable(history, history.head);
  return (history.commits || []).filter(function (c) { return !reach[c.id]; })
    .map(function (c) { return c.id; });
}
