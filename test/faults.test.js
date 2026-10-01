// Fault injection (specs/09-testing.md §3; PATTERN.md `PAT-INV-13`).
//
// Implements `REQ-803`, and exercises the outcomes it asserts: `REQ-317` (an integrity failure opens
// read-only), `REQ-212` (an unknown newer format opens read-only), `REQ-517`/`REQ-518` (resource
// guards), `REQ-403` (every operation still reaches a correct outcome when storage misbehaves).
//
// The write orderings in `05-storage.md` §5 are stated as RULES because the natural ordering is wrong
// in a way that stays invisible until an interruption:
//
//   > The pointer is written last and removed first. An interrupted write leaves a dangling head —
//   > corruption — instead of orphans, which are merely waste.
//
// The natural thing to write is the pointer first. Interrupted, that leaves a pointer naming a commit
// that is not there, and the app says "this document's history does not hold together" for the rest of
// that file's life — read-only, unrepairable, because repairing means guessing. Writing the commits
// first inverts the failure into unreferenced commits, which nothing reads and anything may reclaim.
//
// So every step of both orderings is interrupted here, deliberately, and the assertion is never "the
// write succeeded". It is "whatever survived is still a document".
//
// Three things are interrupted: `writeDocument`'s append, `forget`'s delete, and a healthy store's
// read (by corrupting what it holds, or by removing a key the pointer names). The forbidden ordering
// is written out in full in the second test — the app must not contain that code, so the test holds it
// up beside the real one and shows what the rule buys.

'use strict';

var h = require('./harness.js');

// ---- The fixture ----

// A document with a real history: a docId, a root commit, and a few edits on top, built through the
// same `TP.history.append` the app uses, so the commits the storage layer is handed are the shape it
// is handed in production. `h.mutate` makes each edit a genuine payload change, which matters here:
// a history of identical payloads would store empty deltas, and the interesting thing to interrupt is
// a history with keyframes and deltas in it.
function fixture(TP, edits) {
  var docId = 'doc-fault-0001';
  var author = { name: 'Test Person', email: 'test@example.invalid' };
  var gen = h.generator(11);
  var history = TP.history.newHistory();
  var trip = TP.model.newTrip({ title: 'Faults', docId: docId });
  var n = 0;
  function stamp() { n++; return '2026-09-29T00:00:' + String(n).padStart(2, '0') + '.000Z'; }

  var step = TP.history.append(history, { trip: trip }, {
    docId: docId, author: author, timestamp: stamp(), message: 'the first commit',
  });
  history = step.history;
  for (var i = 0; i < (edits === undefined ? 4 : edits); i++) {
    trip = h.mutate(TP, gen, trip);
    step = TP.history.append(history, { trip: trip }, {
      docId: docId, author: author, timestamp: stamp(), message: 'edit ' + (i + 1),
    });
    history = step.history;
  }
  var container = TP.container.create({ trip: trip }, {
    appVersion: '0.2.0', appHash: '', generatedAt: '2026-09-29T00:00:00.000Z',
  }, history);
  return { docId: docId, container: container, history: history, commits: history.commits };
}

// ---- Adapters that misbehave ----

// Wrap a healthy adapter and interrupt it after the Nth write has LANDED. That is what an
// interruption looks like from the store's side: the write completed, the process did not survive to
// the next step. `after = 0` is the case where it died before writing anything.
//
// Wrapping rather than replacing is what makes the test honest: the same `TP.storageMemory` map stays
// behind the fault, so "what survived" is read back through a clean adapter and is exactly what a
// later boot would find.
function interruptAfter(base, after, options) {
  var opts = options || {};
  var landed = 0;

  function raise() {
    return opts.error ? opts.error() : new Error('the process was interrupted');
  }
  function before() { if (after === 0) throw raise(); }
  function done() {
    landed++;
    if (landed === after) throw raise();
  }

  return {
    landed: function () { return landed; },
    get: function (k) { return base.get(k); },
    set: function (k, v) { before(); base.set(k, v); done(); },
    del: function (k) { before(); base.del(k); done(); },
    keys: function (p) { return base.keys(p); },
    bytesUsed: function () { return base.bytesUsed(); },
    available: function () { return base.available(); },
    kind: function () { return base.kind(); },
    describe: function () { return base.describe(); },
  };
}

// A healthy adapter that counts writes. Used to prove that read-only mode does not merely fail — it
// does not reach storage at all.
function spy(base) {
  var ops = { sets: 0, dels: 0 };
  return {
    ops: ops,
    get: function (k) { return base.get(k); },
    set: function (k, v) { ops.sets++; return base.set(k, v); },
    del: function (k) { ops.dels++; return base.del(k); },
    keys: function (p) { return base.keys(p); },
    bytesUsed: function () { return base.bytesUsed(); },
    available: function () { return base.available(); },
    kind: function () { return base.kind(); },
    describe: function () { return base.describe(); },
  };
}

// A full store. Reads still work, so the writer-claim check passes and the failure lands on the commit
// write rather than on the check before it — which is the case being tested.
function fullStore(TP, base) {
  return {
    get: function (k) { return base.get(k); },
    set: function (k) {
      throw new TP.storage.QuotaError('The browser storage for this origin is full (' + k + ').');
    },
    del: function (k) { base.del(k); },
    keys: function (p) { return base.keys(p); },
    bytesUsed: function () { return base.bytesUsed(); },
    available: function () { return true; },
    kind: function () { return base.kind(); },
    describe: function () { return base.describe(); },
  };
}

// A clock that never fires. The store's autosave is a 900 ms timer, and a test that let it run would
// commit in the middle of an assertion, at a moment that depends on wall-clock time. The harness
// injects `setTimeout`/`clearTimeout` for exactly this reason (see test/harness.js).
var STOPPED = { setTimeout: function () { return 0; }, clearTimeout: function () {} };

// A realm that has the store in it. `store.js` sits one fragment above the harness's default pure end
// (`io/export.js`), because everything up to the export path has to load without a DOM and the store is
// the first thing that keeps state across calls — so the tests that need it ask for one fragment more.
// The clock is stopped for them, so nothing commits behind an assertion.
function storeRealm() {
  return h.pure({ end: 'store.js', setTimeout: STOPPED.setTimeout, clearTimeout: STOPPED.clearTimeout }).TP;
}

// ---- Reading back what survived ----

// What boot does with what it finds: the stored history is read back and verified. This is the whole
// of the recovery path — `verify.js`: "A failure never repairs anything."
//
// The read is `TP.registry.localHistory`, the same function the running app uses to rebuild a stored
// copy, so a survival claim made here is a claim about the bytes on disk rather than about an
// in-memory object the test kept a reference to.
function openStored(TP, adapter, docId) {
  var local = TP.registry.localHistory(adapter, docId);
  return { local: local, chain: TP.verify.chain({ head: local.head, commits: local.commits }) };
}

// Every commit id the stored bytes name must resolve inside the stored bytes: the head, and every
// parent of every commit present. `verify.chain` says this too; repeating it explicitly states the
// property the fault table asks for ("no commit reported as written is missing") in its own words,
// so a future change to `verify` cannot quietly drop it.
function assertNothingDangles(TP, opened, where) {
  var map = TP.history.index({ commits: opened.local.commits });
  var named = [];
  if (opened.local.head) named.push(opened.local.head);
  opened.local.commits.forEach(function (c) {
    (c.parents || []).forEach(function (p) { named.push(p); });
  });
  named.forEach(function (id) {
    h.ok(map[id], where + ': ' + TP.verify.shortId(id) + ' is named but not stored');
  });
}

// Read-only mode as boot configures it: `src/boot.js` computes `var readOnly = !chain.ok || !formatOk;`
// and then hands the store a null adapter and an explanation. boot.js itself is not loadable here —
// it is the one side-effecting fragment and it needs a DOM — so this test asserts boot's OWN decision
// and the two things it then does, while the browser suite (test/browser.test.js) exercises the whole
// boot path on a real document.
function readOnlyOutcome(TP, container, chainOk, formatOk) {
  var spied = spy(TP.storage.create('null'));
  TP.store.init(container, spied, {
    readOnly: !chainOk || !formatOk,
    persistenceNote: 'This document is open read-only: its history does not hold together, ' +
      'so nothing will be written to it or to this browser.',
  });
  var tripBefore = TP.canonical.serialize(TP.store.trip());
  var edit = TP.store.edit('A change that must not happen', function (t) { t.title = 'changed'; });
  var commit = TP.store.commit('must not happen');
  var save = TP.store.save();
  return {
    readOnly: !chainOk || !formatOk,
    spied: spied,
    edit: edit, commit: commit, save: save,
    tripUnchanged: TP.canonical.serialize(TP.store.trip()) === tripBefore,
  };
}

function assertReadOnlyWritesNothing(TP, outcome, where) {
  h.equal(outcome.readOnly, true, where + ': boot must open this read-only');
  h.equal(outcome.edit.ok, false, where + ': an edit is refused');
  h.equal(outcome.commit.ok, false, where + ': a commit is refused');
  h.equal(outcome.save.ok, false, where + ': a save is refused');
  h.equal(outcome.save.reason, 'read-only');
  h.equal(outcome.tripUnchanged, true, where + ': the working copy is untouched');
  h.equal(outcome.spied.ops.sets + outcome.spied.ops.dels, 0,
    where + ': read-only mode does not reach storage at all');
}

// The rule from 08-security.md §5: "Every guard fails with an explanation, naming the limit and the
// actual value. A silent refusal looks like a crash." Both numbers are asserted, not just the
// refusal, because a message that says "too big" is a message the user cannot act on.
function assertNamesBoth(what, message, limit, actual) {
  var text = String(message);
  h.ok(text.indexOf(String(limit)) !== -1,
    what + ': the explanation does not name the limit (' + limit + '): ' + text);
  h.ok(text.indexOf(String(actual)) !== -1,
    what + ': the explanation does not name the actual value (' + actual + '): ' + text);
}

// ---- The tests ----

module.exports = {
  name: 'fault injection (REQ-803)',
  tests: [
    {
      name: 'an interruption after every write in an append leaves a document that still opens',
      run: function () {
        var TP = h.pure({}).TP;
        var f = fixture(TP, 4);
        var total = f.commits.length;      // 5: the root plus four edits

        // The uninterrupted run, for contrast.
        var clean = TP.storageMemory.create();
        var reported = TP.registry.writeDocument(clean, f.container);
        h.equal(reported.ok, true, 'the ordinary write reports what it did');
        h.equal(TP.registry.localHistory(clean, f.docId).commits.length, total);

        for (var cut = 0; cut <= total + 1; cut++) {
          var base = TP.storageMemory.create();
          var flaky = interruptAfter(base, cut);
          var outcome = null;
          var threw = null;
          try { outcome = TP.registry.writeDocument(flaky, f.container); } catch (e) { threw = e; }

          var where = 'cut after ' + cut + ' write(s)';
          var opened = openStored(TP, base, f.docId);

          // A write that was reported as done must be done. This is the requirement the fault table
          // states first: "no commit reported as written is missing".
          if (outcome && outcome.ok) {
            h.equal(cut > total, true, where + ': a write reported success before the pointer was written');
            h.equal(opened.local.commits.length, total, where + ': a reported write left a commit out');
            h.ok(opened.local.head, where + ': a reported write left no pointer');
          }

          // The document still opens. Whatever survived verifies — no dangling head, no missing
          // parent, no half-written record. This is the assertion the whole ordering exists for.
          h.ok(opened.chain.ok, where + ': the stored bytes do not verify — ' +
            (opened.chain.errors[0] ? opened.chain.errors[0].problem : 'no reason recorded'));

          // Exactly the prefix that landed, and nothing invented.
          var landed = Math.min(cut, total);
          h.equal(opened.local.commits.length, landed, where + ': the wrong number of commits survived');
          h.equal(opened.local.commits.length <= total, true, where + ': more commits than were handed over');

          // The pointer is there only when the pointer write landed — which is the last write, so it
          // is there exactly when nothing was cut short of it.
          h.equal(!!opened.local.head, cut > total,
            where + ': the pointer was written out of order');

          // Before the pointer write, the interruption must have actually happened.
          if (cut <= total) {
            h.ok(threw, where + ': the write was expected to be interrupted and was not');
            h.equal(flaky.landed(), cut, where + ': the fault fired at the wrong step');
          }

          assertNothingDangles(TP, opened, where);
        }
      },
    },

    {
      name: 'the forbidden ordering — pointer first — is corruption where the correct one is waste',
      run: function () {
        var TP = h.pure({}).TP;
        var f = fixture(TP, 4);
        var total = f.commits.length;

        // The ordering 05-storage.md §5 forbids. It is written here rather than imported because the
        // app must not contain this code: the test's job is to hold the wrong version up beside the
        // right one and show what the rule buys.
        function writePointerFirst(adapter, container) {
          var docId = container.history.commits[0].docId;
          adapter.set(TP.storage.metaKey(docId), {
            format: container.format,
            head: container.history.head,
            keyframeInterval: container.history.keyframeInterval,
            lastOpenedAt: '2026-09-29T00:00:00.000Z',
          });
          container.history.commits.forEach(function (c) {
            adapter.set(TP.storage.commitKey(docId, c.id), c);
          });
        }

        // Cut at the same point in both writers: one write has landed, the rest have not.
        function cutAt(writer, n) {
          var base = TP.storageMemory.create();
          try { writer(interruptAfter(base, n), f.container); } catch (e) { /* the interruption */ }
          return openStored(TP, base, f.docId);
        }

        // The correct ordering, cut after its first write: one commit, no pointer.
        var good = cutAt(function (adapter, c) { return TP.registry.writeDocument(adapter, c); }, 1);
        h.equal(good.local.head, null, 'the correct ordering leaves no pointer when it is cut short');
        h.equal(good.local.commits.length, 1, 'the commit that landed is still there');
        h.ok(good.chain.ok, 'orphans are not corruption — they verify: ' +
          (good.chain.errors[0] ? good.chain.errors[0].problem : ''));
        h.equal(TP.verify.label(good.chain), 'chain intact — 1 commit');

        // The forbidden ordering, cut at the same point: the pointer is there and the commit is not.
        // This is the load-bearing assertion of the whole file. If it ever passes, the ordering rule
        // is not doing anything and the design has lost its reason.
        var bad = cutAt(writePointerFirst, 1);
        h.equal(bad.local.head, f.history.head, 'the pointer-first writer stored the pointer');
        h.equal(bad.local.commits.length, 0, 'and nothing else — the interruption was after one write');
        h.equal(bad.chain.ok, false, 'a dangling head must FAIL verification');
        h.equal(bad.chain.errors[0].commitId, f.history.head, 'and name the commit the pointer names');
        h.ok(/not present/.test(bad.chain.errors[0].problem),
          'the problem must be that the head is absent, not something else: ' + bad.chain.errors[0].problem);
        h.ok(/chain broken at/.test(TP.verify.label(bad.chain)), 'the label says so too');

        // Not a one-point artifact: cut later in the inverted order — the pointer plus two commits —
        // and the head is still unreachable and still named.
        var bad2 = cutAt(writePointerFirst, 3);
        h.equal(bad2.local.commits.length, 2, 'two commits landed before the interruption');
        h.equal(bad2.chain.ok, false, 'the half-written inverted ordering is corrupt at every cut');
        h.equal(bad2.chain.errors[0].commitId, f.history.head);

        // ... and the correct ordering at that same cut is merely wasteful.
        var good2 = cutAt(function (adapter, c) { return TP.registry.writeDocument(adapter, c); }, 3);
        h.equal(good2.local.commits.length, 3);
        h.ok(good2.chain.ok, 'the correct ordering verifies at that cut');
        h.equal(good2.local.head, null, 'and nothing points at the orphans');
        h.equal(total, 5, 'the fixture is the size this test assumes');
      },
    },

    {
      name: 'an interruption during a delete leaves no pointer to a missing commit',
      run: function () {
        var TP = h.pure({}).TP;
        var f = fixture(TP, 4);
        var total = f.commits.length;
        var metaKey = TP.storage.metaKey(f.docId);
        var prefix = TP.storage.commitPrefix(f.docId);

        // `forget` deletes the pointer first and the commits after (PAT-INV-13). Every step of that
        // delete is interrupted here.
        for (var cut = 0; cut <= total + 1; cut++) {
          var base = TP.storageMemory.create();
          h.ok(TP.registry.writeDocument(base, f.container).ok, 'the fixture store was written');
          var flaky = interruptAfter(base, cut);
          var threw = null;
          try { TP.registry.forget(flaky, f.docId); } catch (e) { threw = e; }

          var where = 'delete cut after ' + cut + ' write(s)';

          // The pointer is deleted FIRST (PAT-INV-13), so no cut can leave a pointer naming a commit
          // that was removed. Cut at zero nothing has happened yet, and the store is simply intact.
          h.equal(base.get(metaKey) === null || base.get(metaKey) === undefined, cut >= 1,
            where + ': the pointer must be gone as soon as the delete starts, because it is deleted first');

          if (cut === 0) {
            h.ok(threw, where + ': the delete was expected to be interrupted');
            var untouched = openStored(TP, base, f.docId);
            h.equal(untouched.local.head, f.history.head, where + ': a delete that never started changes nothing');
            h.equal(untouched.local.commits.length, total);
            h.ok(untouched.chain.ok, where + ': and the document is still whole');
            continue;
          }

          // Whatever is left is read the way the app reads it: the pointer is gone, so the local copy
          // is not the document of record. The file carries everything (PAT-INV-01) — nothing is lost.
          var opened = openStored(TP, base, f.docId);
          h.equal(opened.local.head, null, where + ': nothing is presented as the current copy');

          // Orphans, not damage: the commits that remain are never adopted as newer work. A partial
          // delete leaves a set with no head, which `merge.plan` treats as a separate copy and leaves
          // alone rather than resolving in either direction.
          var plan = TP.merge.plan(
            { history: f.history, docId: f.docId },
            { history: { head: opened.local.head, commits: opened.local.commits }, docId: f.docId }
          );
          h.ok(plan.action !== TP.merge.KEEP_LOCAL, where + ': a half-deleted copy must not be adopted as newer');
          h.ok(plan.action !== TP.merge.DIVERGED, where + ': a half-deleted copy must not raise a divergence');

          h.ok(threw, where + ': the delete was expected to be interrupted');
          h.equal(flaky.landed(), cut, where + ': the fault fired at the wrong step');

          if (cut === 1) {
            // Only the pointer went. The commits are intact and still verify, so an operator who
            // wanted them back has a valid set to recover — that is what "waste, not corruption" means.
            h.equal(base.keys(prefix).length, total, where + ': the commits are orphans, untouched');
            h.ok(opened.chain.ok, where + ': the orphaned commits still verify');
            h.equal(TP.registry.hasLocal(base, f.docId), true);
          }
        }

        // And the finish: with every write landed, nothing is left at all.
        var empty = TP.storageMemory.create();
        TP.registry.writeDocument(empty, f.container);
        TP.registry.forget(empty, f.docId);
        h.equal(empty.get(metaKey), null, 'a completed delete removes the pointer');
        h.equal(TP.registry.hasLocal(empty, f.docId), false, 'and every commit');
      },
    },

    {
      name: 'a corrupted commit opens the document read-only, names the commit, and writes nothing',
      run: function () {
        var TP = storeRealm();
        var f = fixture(TP, 4);
        var base = TP.storageMemory.create();
        h.ok(TP.registry.writeDocument(base, f.container).ok);

        // One character changed inside a stored field. This is what a partial restore, a truncated
        // write, or a deliberate edit produces — and it is a change to a field the hash covers, so
        // the commit no longer hashes to the id it claims.
        var victim = f.commits[2];
        var key = TP.storage.commitKey(f.docId, victim.id);
        var record = JSON.parse(JSON.stringify(base.get(key)));
        record.message = record.message + ' (edited)';
        base.set(key, record);

        var opened = openStored(TP, base, f.docId);
        h.equal(opened.chain.ok, false, 'the tampered commit must be caught');
        var named = opened.chain.errors.filter(function (e) { return e.commitId === victim.id; });
        h.ok(named.length >= 1, 'the failure must name the commit that was changed');
        h.ok(/hash to/.test(named[0].problem), 'and say what is wrong with it: ' + named[0].problem);
        h.equal(TP.verify.label(opened.chain), 'chain broken at ' + TP.verify.shortId(victim.id),
          'the label the History view shows names exactly that commit');
        h.equal(opened.local.commits.length, f.commits.length,
          'the corrupt record is still read — an unreadable file is a worse failure than a broken one');

        // Boot opens it read-only (REQ-317) and writes nothing (REQ-320): a broken document is not
        // "repaired", because repairing means guessing, and a guess gets saved back over the user's
        // copy and circulated as fact.
        var outcome = readOnlyOutcome(TP, f.container, opened.chain.ok, TP.container.isReadableFormat(f.container.format));
        assertReadOnlyWritesNothing(TP, outcome, 'a corrupted commit');

        // A byte that changes the payload hash rather than a field is caught by the same check, and
        // the payload-level check names it too when the user inspects that commit.
        var payloadCheck = TP.verify.payload({ head: f.history.head, commits: f.commits }, victim.id);
        h.ok(payloadCheck.ok, 'the untouched commits still rebuild exactly');
      },
    },

    {
      name: 'a key the pointer names, removed, opens read-only and names what is missing',
      run: function () {
        var TP = storeRealm();
        var f = fixture(TP, 4);

        // The head. The pointer names a commit that is not there — the same shape the inverted
        // ordering produces, arriving instead from a partial restore or a hand-edited store.
        var head = TP.storageMemory.create();
        h.ok(TP.registry.writeDocument(head, f.container).ok);
        head.del(TP.storage.commitKey(f.docId, f.history.head));
        var atHead = openStored(TP, head, f.docId);
        h.equal(atHead.chain.ok, false, 'a missing head must be caught');
        h.equal(atHead.chain.errors[0].commitId, f.history.head, 'and the commit named');
        h.ok(/not present/.test(atHead.chain.errors[0].problem), atHead.chain.errors[0].problem);
        var headOutcome = readOnlyOutcome(TP, f.container, atHead.chain.ok, TP.container.isReadableFormat(f.container.format));
        assertReadOnlyWritesNothing(TP, headOutcome, 'a missing head');

        // A commit in the middle. Now a parent is missing, and the failure is named on the child that
        // needs it — the commit that is absent cannot name itself.
        var middle = TP.storageMemory.create();
        var gone = f.commits[1];
        h.ok(TP.registry.writeDocument(middle, f.container).ok);
        middle.del(TP.storage.commitKey(f.docId, gone.id));
        var inMiddle = openStored(TP, middle, f.docId);
        h.equal(inMiddle.chain.ok, false, 'a missing parent must be caught');
        h.ok(inMiddle.chain.errors.some(function (e) {
          return e.problem === 'parent ' + gone.id + ' is not present in this file';
        }), 'the child commit must be named as the one that cannot find its parent: ' +
          JSON.stringify(inMiddle.chain.errors.slice(0, 3)));
        var middleOutcome = readOnlyOutcome(TP, f.container, inMiddle.chain.ok, TP.container.isReadableFormat(f.container.format));
        assertReadOnlyWritesNothing(TP, middleOutcome, 'a missing parent');
      },
    },

    {
      name: 'a full store fails the write visibly and keeps the work in memory',
      run: function () {
        var TP = storeRealm();
        var f = fixture(TP, 3);
        var base = TP.storageMemory.create();
        h.ok(TP.registry.writeDocument(base, f.container).ok);

        TP.store.init(f.container, fullStore(TP, base), {});
        var commitsBefore = TP.store.commits().length;
        var tripBefore = TP.canonical.serialize(TP.store.trip());
        var events = [];
        TP.store.onChange(function (what) { events.push(what); });

        h.ok(TP.store.edit('A change', function (t) { t.title = 'Changed on a full disk'; }).ok);
        var res = TP.store.save();

        // Visible: a return value the caller can act on, a status the chrome can show, and an event
        // the views hear. A silent refusal looks like a crash.
        h.equal(res.ok, false, 'the save reports the failure');
        h.equal(res.quota, true, 'and says it was the quota');
        h.ok(TP.store.saveStatus().error, 'the failure is in the status the UI reads');
        h.ok(events.indexOf('save-failed') !== -1, 'and the views were told');

        // Intact: the working copy is exactly what the user typed, still unsaved, still theirs. "No
        // commit is ever dropped to make space" (05-storage.md §6) — including the ones already
        // committed, which are what a desperate implementation would delete.
        h.equal(TP.canonical.serialize(TP.store.trip()) === tripBefore, false,
          'the edit is still in the working copy');
        h.equal(TP.store.trip().title, 'Changed on a full disk', 'the user\'s change survived the failure');
        h.equal(TP.store.isDirty(), true, 'and it is still marked unsaved, so it is not silently lost');
        h.equal(TP.store.commits().length, commitsBefore, 'no commit was dropped to make space');

        // The file is the carrier (PAT-INV-01): committing is a document fact, and only the save
        // depends on storage. A commit still lands in the history with the save reported as failed —
        // truthfully, both ways round.
        var committed = TP.store.commit('Recorded on a full disk');
        h.equal(committed.ok, true, 'the commit is recorded in the document');
        h.equal(committed.saved.ok, false, 'and the save is reported as what it was — a failure');
        h.equal(TP.store.commits().length, commitsBefore + 1, 'the document advanced');
        h.equal(TP.store.isDirty(), false, 'a commit still clears the dirty flag');
        h.equal(TP.store.head(), committed.commit.id, 'and the head moved');
        h.ok(TP.verify.chain(TP.container.create(TP.store.payload(), null, TP.store.history())).ok,
          'the in-memory history is still a valid chain');
      },
    },

    {
      name: 'a container written by a newer version opens read-only with an explanation',
      run: function () {
        var TP = storeRealm();
        var f = fixture(TP, 2);

        // The FORMAT RULE is what refuses this (REQ-212) — not the envelope validator, and not the
        // history. A format the app does not know is a format whose semantics it must not guess at,
        // and a guess that parses is a guess that gets written back.
        var newer = TP.container.create(f.container.payload, f.container.build, f.container.history);
        newer.format = '2.0.0';
        h.equal(TP.container.validate(newer) === newer, true, 'the envelope is otherwise well-formed');
        h.equal(TP.container.isReadableFormat('2.0.0'), false, 'a newer format is not readable');
        h.equal(TP.container.isReadableFormat('1.0.0'), true, 'this version is');
        h.equal(TP.container.isReadableFormat('0.9.0'), true, 'and so is an older one — older is understood');
        h.equal(TP.container.compareFormat('2.0.0', '1.0.0'), 1, 'the comparison orders them');
        h.equal(TP.container.compareFormat('1.0.1', '1.0.0'), 1, 'and is numeric per segment, not lexical');

        var chain = TP.verify.chain(newer.history);
        h.ok(chain.ok, 'the history is fine — the format is the only thing that stopped this');

        var outcome = readOnlyOutcome(TP, newer, chain.ok, TP.container.isReadableFormat(newer.format));
        assertReadOnlyWritesNothing(TP, outcome, 'an unknown newer format');
        // The sentence the user gets (src/boot.js), naming the version so they know which app to open.
        h.ok(/2\.0\.0/.test('Written by a newer version of the planner (' + newer.format + ').'));
      },
    },

    {
      // `init` resets the store, and the reset includes the interactivity flag — deliberately, because
      // boot inits BEFORE reconcile runs and the UI must not be live until it has (REQ-612). That
      // leaves a trap for every swap that happens later, over a page that has been running for a
      // while: `init` puts the flag back to false and only the boot sequence ever set it true, so a
      // document opened from the sidebar left the app permanently non-interactive and its Export
      // button greyed out. `openDocument` is the seam that closes it, and this is its contract.
      name: 'a document adopted after boot is interactive, and init alone is not (REQ-612)',
      run: function () {
        var TP = storeRealm();
        var f = fixture(TP, 1);
        var storage = TP.storageMemory.create();

        TP.store.init(f.container, storage);
        h.equal(TP.store.isInteractive(), false,
          'init must leave the store non-interactive: boot calls it before reconcile (REQ-612)');
        TP.store.setInteractive(true);
        h.equal(TP.store.isInteractive(), true, 'and boot can arm it when the sequence finishes');

        // The swap, exactly as the sidebar's row and New Trip do it.
        TP.store.openDocument(f.container, storage);
        h.equal(TP.store.isInteractive(), true,
          'a document adopted over a running page must leave the app interactive');

        // It is `init` PLUS the transition, not a different reset: everything init clears, it clears.
        TP.store.edit('An edit that must not survive the swap', function (t) { t.title = 'changed'; });
        h.equal(TP.store.isDirty(), true, 'the edit landed, so there is something to reset');
        TP.store.openDocument(f.container, storage);
        h.equal(TP.store.isDirty(), false, 'openDocument leaves the working copy clean, as init does');
        h.equal(TP.store.canUndo(), false, 'undo does not reach back across the swap');
        h.equal(TP.store.trip().title, TP.container.payloadTrip(f.container).title,
          'the adopted document’s own payload is the working copy');

        // Read-only is not a reason to withhold interactivity. Export is the way out of a read-only
        // document — boot says so in as many words — so it has to stay available there.
        TP.store.openDocument(f.container, storage, { readOnly: true });
        h.equal(TP.store.isReadOnly(), true, 'the read-only flag is carried through');
        h.equal(TP.store.isInteractive(), true,
          'a read-only document is still interactive: Export is how its owner gets an editable copy');
      },
    },

    {
      name: 'every resource guard fails with an explanation naming the limit and the value',
      run: function () {
        var TP = h.pure({}).TP;
        var L = TP.container.LIMITS;

        // ---- Container size (REQ-517) ----
        // The character count is a lower bound on bytes, so this is the cheap conservative check. It
        // runs before the JSON parse, which is the point: "Guards bound before the expensive
        // operation. A depth check that runs after the recursion is not a guard."
        var oversize = 'a'.repeat(L.maxBytes + 1);
        var sizeErr = h.throws(function () { TP.container.parseBlock(oversize); }, 'an oversized block must be refused');
        assertNamesBoth('container size', sizeErr.message, L.maxBytes, oversize.length);
        h.equal(sizeErr.name, 'GuardError');

        // ---- Commit count ----
        var tooMany = TP.container.create({ trip: TP.model.newTrip({}) }, null, {
          keyframeInterval: 20, head: null, commits: new Array(L.maxCommits + 1).fill({}),
        });
        var countErr = h.throws(function () { TP.container.validate(tooMany); }, 'too many commits must be refused');
        assertNamesBoth('commit count', countErr.message, L.maxCommits, L.maxCommits + 1);

        // ---- Nesting depth ----
        // On the payload. The walk is what would otherwise recurse without bound.
        var deep = 'bottom';
        for (var d = 0; d < L.maxDepth + 5; d++) deep = { nested: deep };
        var depthErr = h.throws(function () { TP.container.nullProto(deep, 0, L.maxDepth); }, 'a deep document must be refused');
        assertNamesBoth('nesting depth', depthErr.message, L.maxDepth, L.maxDepth + 1);
        h.ok(/hostile/.test(depthErr.message), 'and says why the bound exists');

        // ... and on a patch PATH, which is the other place depth arrives from a file (REQ-517).
        var longPath = [];
        for (var p = 0; p < TP.patch.MAX_PATH + 1; p++) longPath.push('a');
        var pathErr = TP.patch.validatePath(longPath, false);
        h.ok(/beyond the/.test(pathErr), 'a deep patch path is refused: ' + pathErr);
        assertNamesBoth('patch path depth', pathErr, TP.patch.MAX_PATH, longPath.length);

        // ---- Patch operation count ----
        var ops = new Array(L.maxPatchOps + 1).fill({ op: 'remove', path: ['x'] });
        var opsErr = TP.patch.validate(ops, { maxPatchOps: L.maxPatchOps });
        assertNamesBoth('patch operation count', opsErr, L.maxPatchOps, ops.length);

        // The bound is applied BEFORE the walk, so a hundred thousand well-formed ops and one absurd
        // one are refused for the reason that matters rather than for whichever the loop reaches
        // first. (The first op here is nonsense; the count is still what the message is about.)
        var absurd = new Array(L.maxPatchOps + 1).fill({ op: 'frobnicate', path: ['__proto__'] });
        var orderErr = TP.patch.validate(absurd, { maxPatchOps: L.maxPatchOps });
        h.ok(/operations/.test(orderErr) && !/unknown op/.test(orderErr),
          'the count is checked before any operation is inspected: ' + orderErr);
        h.throws(function () { TP.patch.apply({ x: 1 }, absurd); }, 'apply throws on the oversized patch');

        // ---- Commit count, on the storage side ----
        // The container guard above bounds what the app will LOAD. The registry bounds what it will
        // STORE, and the two ceilings have to be the same number: a document this app can write but
        // not read back is the worst of the failure modes (REQ-404). Asserted through the behaviour
        // rather than through the constant, because the behaviour is the claim.
        var manyDoc = 'doc-guard-0001';
        var many = TP.container.create({ trip: TP.model.newTrip({ docId: manyDoc }) }, null, {
          keyframeInterval: 20,
          head: null,
          commits: new Array(L.maxCommits + 1).fill(null).map(function (_, i) {
            return { id: 'c' + i, docId: manyDoc, parents: [] };
          }),
        });
        var quotaErr = h.throws(function () {
          TP.registry.writeDocument(TP.storageMemory.create(), many);
        }, 'more commits than the app will store must be refused');
        h.equal(quotaErr.name, 'QuotaError', 'and refused as a capacity problem, not a shape problem');
        assertNamesBoth('the storage commit ceiling', quotaErr.message, L.maxCommits, L.maxCommits + 1);

        // ---- The iCalendar loop guards ----
        // Unfolding is a loop fed by hostile input, and a loop fed hostile input is a hang (T4).
        var longLine = 'X'.repeat(TP.ical.LIMITS.maxLineLength + 1);
        var icalShape = TP.validators.check('ical',
          'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:VEVENT\r\nUID:1\r\n' +
          longLine + '\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
        h.equal(icalShape.ok, false, 'a calendar with an enormous line is refused before it is unfolded');
        h.ok(TP.validators.explain(icalShape).length > 0, 'and the refusal is a sentence');
        h.equal(TP.ical.LIMITS.maxLines > 0 && TP.ical.LIMITS.maxProperties > 0, true,
          'the line and property bounds are declared');

        // ---- Embedded source length ----
        // The bound on a file read as TEXT. Nothing is parsed first, so this is the cheapest bound of
        // all and it runs on the first line of `detect`.
        var source = 'a'.repeat(TP.io.import.MAX_SOURCE_CHARS + 1);
        var detected = TP.io.import.detect(source);
        h.equal(detected.format, 'unknown', 'an over-long source is not detected as any format');
        assertNamesBoth('embedded source length', detected.reason,
          TP.io.import.MAX_SOURCE_CHARS.toLocaleString(), source.length.toLocaleString());
        var parsed = TP.io.import.parseText(source);
        h.equal(parsed.ok, false, 'and the import refuses it');
        h.ok(parsed.reason.length > 0, 'with a sentence rather than a blank page (REQ-518)');

        // The same bound, one character under it, is not refused for length — so the guard is a
        // boundary and not a blanket refusal of large files.
        var justInside = TP.io.import.detect('{'.repeat(1000));
        h.ok(!/beyond the/.test(justInside.reason || ''), 'a small file is refused for its content, not its size');

        // Source text shown from a document is bounded too, with the truncation stated (§6 of
        // 08-security.md) — an ellipsis, not a silently shorter string.
        var snippet = TP.format.truncate('x'.repeat(5000), 100);
        h.equal(snippet.length, 100, 'the snippet is bounded');
        h.equal(snippet.slice(-1), '…', 'and the truncation is stated');
        h.equal(TP.format.truncate('short', 100), 'short', 'a value inside the bound is untouched');
      },
    },
  ],
};
