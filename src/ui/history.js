// History: the document's commits, and what can honestly be said about them
// (specs/04-versioning.md §6, REQ-319, REQ-320).
//
// The label this view shows is "chain intact", never "verified". The chain check proves that
// the stored fields hash to the ids they claim and that every parent is present. It does not
// prove the history is what someone originally wrote, and saying "verified" would claim it
// does.

TP.ui.history = (function () {
  'use strict';

  var R = null;
  function r() { R = R || TP.ui.render; return R; }

  var selected = null;

  function render(root) {
    var history = TP.store.history();
    var commits = history.commits || [];
    var chain = TP.verify.chain(history);

    r().append(root, r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'History' }),
        r().el('span', { class: 'flex gap' }, [
          r().button('Back to the trip', function () { TP.ui.shell.closeHistory(); }, { class: 'btn btn--sm' }),
        ]),
      ]),
      r().el('div', { class: chain.ok ? 'info' : 'info info--danger' }, [
        r().el('strong', { text: chain.ok ? 'This document’s ' + TP.verify.label(chain) + '.' : 'This document’s history does not hold together.' }),
        chain.ok
          ? r().el('div', { text:
            'Every commit hashes to the id it claims, and every parent it names is present. ' +
            'That is what this check proves, and it is all it proves.' })
          : r().el('div', { text: firstProblem(chain) + ' The document is open read-only, and nothing here can change it.' }),
      ]),
      r().el('dl', { class: 'kv' }, [
        r().el('dt', { text: 'Commits' }), r().el('dd', { text: String(commits.length) }),
        r().el('dt', { text: 'At head' }), r().el('dd', { text: history.head ? TP.verify.shortId(history.head) : 'nothing committed yet' }),
        r().el('dt', { text: 'Keyframe every' }), r().el('dd', { text: TP.format.plural(history.keyframeInterval || TP.history.KEYFRAME_INTERVAL, 'commit') }),
        r().el('dt', { text: 'Keyframes' }), r().el('dd', { text: TP.format.plural(TP.history.countKeyframes(history), 'keyframe') }),
      ]),
    ]));

    if (!commits.length) {
      r().append(root, r().el('div', { class: 'empty' }, [
        r().el('h2', { text: 'Nothing is committed yet' }),
        r().el('p', { text: 'The first change you make creates the document’s first commit.' }),
      ]));
      return;
    }

    r().append(root, commitList(commits, history));
    if (selected) r().append(root, detailCard(selected, history));
  }

  function commitList(commits, history) {
    var ordered = commits.slice().sort(function (a, b) {
      return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
    });

    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Commits' }),
        r().el('span', { class: 'subtle', text: 'Newest first' }),
      ]),
    ]);

    ordered.forEach(function (commit) {
      var isHead = commit.id === history.head;
      var distance = TP.history.distanceSinceKeyframe(history, commit.id);
      var isKeyframe = distance != null && distance === 0;
      var row = r().el('div', { class: 'cl-item items-start' }, [
        r().el('div', { class: 'flex-1' }, [
          r().el('div', {}, [
            r().el('strong', { text: commit.message || 'Edit' }),
            isHead ? r().el('span', { class: 'badge badge--done', text: 'current' }) : null,
            isKeyframe ? r().el('span', { class: 'badge badge--optional', text: 'keyframe' }) : null,
            (commit.parents || []).length > 1 ? r().el('span', { class: 'badge badge--med', text: 'merge' }) : null,
          ]),
          r().el('div', { class: 'subtle', text: when(commit.timestamp) + ' · ' + authorOf(commit) + ' · ' + TP.verify.shortId(commit.id) }),
          r().el('div', { class: 'subtle', text: storageKind(commit) }),
        ]),
        r().el('span', { class: 'flex gap' }, [
          r().button('Details', function () { inspect(commit.id); }, { class: 'btn btn--ghost btn--sm' }),
          isHead ? null : r().button('Revert to this', function () { revert(commit.id); }, { class: 'btn btn--ghost btn--sm' }),
        ]),
      ]);
      r().append(card, row);
    });

    return card;
  }

  function storageKind(commit) {
    var bits = [];
    if (commit.snapshot) bits.push('holds a full copy');
    if (commit.delta) bits.push(TP.format.plural((commit.delta || []).length, 'change'));
    if (!commit.snapshot && !commit.delta) bits.push('inherits its parent’s content');
    bits.push((commit.parents || []).length === 0 ? 'no parent' : TP.format.plural((commit.parents || []).length, 'parent'));
    return bits.join(' · ');
  }

  function authorOf(commit) {
    var a = commit.author;
    if (!a) return 'unknown';
    return a.name || a.email || 'unknown';
  }

  // The chain check reports a list of problems; the first one is the one worth naming, because
  // a single altered commit usually produces several complaints downstream of it.
  function firstProblem(chain) {
    if (!chain || !chain.errors || !chain.errors.length) return 'No reason was recorded.';
    var e = chain.errors[0];
    return 'Commit ' + TP.verify.shortId(e.commitId) + ': ' + e.problem + '.';
  }

  function when(timestamp) {
    if (!timestamp) return 'no timestamp';
    var d = new Date(timestamp);
    if (isNaN(d.getTime())) return timestamp;
    return d.toLocaleString();
  }

  // ---- Details, with a comparison against the current version ----

  function inspect(commitId) {
    selected = commitId;
    TP.ui.shell.renderActive();
  }

  function detailCard(commitId, history) {
    var commit = TP.history.find(history, commitId);
    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Commit ' + TP.verify.shortId(commitId) }),
        r().el('span', { class: 'flex gap ml-auto' }, [
          r().button('Close', function () { selected = null; TP.ui.shell.renderActive(); }, { class: 'btn btn--ghost btn--sm' }),
        ]),
      ]),
    ]);

    if (!commit) {
      r().append(card, r().el('p', { class: 'subtle', text: 'That commit is not in this document.' }));
      return card;
    }

    var payloadCheck = TP.verify.payload(history, commitId);
    r().append(card, r().el('div', { class: payloadCheck.ok ? 'info' : 'info info--danger' }, [
      r().el('strong', { text: payloadCheck.ok ? 'This version can be rebuilt exactly.' : 'This version cannot be rebuilt.' }),
      r().el('div', { text: payloadCheck.ok
        ? 'Its contents hash to the same value they were committed with.'
        : (payloadCheck.errors || []).map(function (e) { return e.problem; }).join(' ') }),
    ]));

    r().append(card, r().el('dl', { class: 'kv' }, [
      r().el('dt', { text: 'Message' }), r().el('dd', { text: commit.message || 'Edit' }),
      r().el('dt', { text: 'When' }), r().el('dd', { text: when(commit.timestamp) }),
      r().el('dt', { text: 'Who' }), r().el('dd', { text: authorOf(commit) }),
      r().el('dt', { text: 'Parents' }), r().el('dd', { text: (commit.parents || []).map(TP.verify.shortId).join(', ') || 'none — this is where the document begins' }),
      r().el('dt', { text: 'Contents' }), r().el('dd', { text: commit.payloadHash }),
    ]));

    // What changed between this version and the one at head. Ordering comes from ancestry
    // (PAT-INV-08), so "before" and "after" are facts rather than guesses about clocks.
    var headPayload = TP.history.headPayload(history);
    var here = TP.history.reconstruct(history, commitId);
    if (headPayload && here && commitId !== history.head) {
      // A is the version being viewed and B is the head. A past commit is an ancestor of head, so
      // the ordinary case is B_NEWER — "the head has this and the viewed version does not" — and
      // the diff below runs here → head, which is the same direction.
      var order = TP.history.compare(history, commitId, history, history.head);
      var diff = TP.patch.diff(here, headPayload);
      var heading = order === TP.history.B_NEWER
        ? 'Everything that happened since this version'
        : order === TP.history.A_NEWER
          ? 'Everything this version has that the current one does not'
          : order === TP.history.IDENTICAL
            ? 'This is the current version'
            : 'These versions are on different lines of history';
      r().append(card, r().el('h3', { class: 'mt', text: heading }));
      if (!diff.length) {
        r().append(card, r().el('p', { class: 'subtle', text: 'The trip itself is the same.' }));
      } else {
        r().append(card, r().el('p', { class: 'subtle', text: TP.format.plural(diff.length, 'change') + ' to the trip.' }));
        r().append(card, r().el('ul', { class: 'sublist' }, diff.slice(0, 60).map(function (op) {
          return r().el('li', { text: describeOp(op) });
        })));
        if (diff.length > 60) {
          r().append(card, r().el('p', { class: 'subtle', text: '…and ' + (diff.length - 60) + ' more.' }));
        }
      }
    }

    r().append(card, r().el('div', { class: 'flex gap mt' }, [
      r().button('Export this version', function () { exportVersion(commitId); }, { class: 'btn' }),
      commitId === history.head ? null : r().button('Revert to this version', function () { revert(commitId); }, { class: 'btn btn--danger' }),
    ]));

    return card;
  }

  // A patch path is an array of segments, so this is a rendering choice and nothing else —
  // an unsafe segment could never have got this far (REQ-405's rejection happens on apply).
  function describeOp(op) {
    var where = (op.path || []).map(function (s) { return typeof s === 'number' ? '[' + s + ']' : s; }).join('.');
    if (op.op === 'add') return 'added ' + where;
    if (op.op === 'remove') return 'removed ' + where;
    return 'changed ' + where;
  }

  // Reverting is a FORWARD commit (REQ-311): the version you left is still there to come back
  // to. This is the only reason "revert" is safe to offer at all.
  function revert(commitId) {
    var history = TP.store.history();
    var commit = TP.history.find(history, commitId);
    if (!commit) return null;
    return TP.ui.modal.confirm({
      title: 'Go back to this version?',
      body: r().el('div', {}, [
        r().el('p', { text: 'The trip goes back to how it was at “' + (commit.message || 'Edit') + '” (' + when(commit.timestamp) + ').' }),
        r().el('p', { class: 'subtle', text: 'This is recorded as a new commit, not as a deletion — everything since then is still in the history and can be returned to.' }),
      ]),
      confirmLabel: 'Go back',
    }).then(function (yes) {
      if (!yes) return null;
      var res = TP.store.revertTo(commitId, 'Revert to ' + TP.verify.shortId(commitId));
      if (res && res.ok) {
        TP.ui.toast.ok('Reverted. The previous state is still in the history.');
        TP.ui.shell.reflectMode();
        TP.ui.shell.renderAll();
      } else {
        TP.ui.toast.error((res && res.reason) || 'The revert could not be recorded.');
      }
      return res;
    });
  }

  // Export a container whose head is the chosen commit. The file carries the whole history,
  // so exporting an older version is a view of the document rather than a different document.
  function exportVersion(commitId) {
    var history = TP.store.history();
    var payload = TP.history.reconstruct(history, commitId);
    if (!payload) {
      TP.ui.toast.error('That version could not be rebuilt, so nothing was exported.');
      return null;
    }
    var container = TP.container.create(payload, TP.store.buildInfo(), {
      keyframeInterval: history.keyframeInterval,
      head: commitId,
      commits: history.commits,
    });
    var result = TP.io.export.artifact(container);
    if (!result.ok) {
      TP.ui.modal.notice({
        title: 'This version was not exported',
        body: r().el('div', { class: 'info info--danger', text: result.reason }),
      });
      return null;
    }
    return TP.io.export.deliver(result).then(function (delivered) {
      if (delivered.aborted) return null;
      if (delivered.ok) TP.ui.toast.ok('Saved ' + delivered.filename + ' — it opens at this version.');
      else TP.ui.toast.warn(delivered.reason || 'The file could not be saved.');
      return delivered;
    });
  }

  return {
    render: render,
    inspect: inspect,
    revert: revert,
    exportVersion: exportVersion,
    storageKind: storageKind,
    when: when,
    selected: function () { return selected; },
  };
})();
