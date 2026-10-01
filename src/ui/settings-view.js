// Settings: identity, storage, the documents this browser has seen, and what this
// environment can and cannot do (specs/07-ui.md §9, specs/08-environment.md).
//
// Everything here is about the SHELL rather than the trip, which is why none of it is a commit:
// changing your name does not change the document's content, so writing it into the history
// would put a line in the log that says nothing happened.

TP.ui.settingsView = (function () {
  'use strict';

  var R = null;
  function r() { R = R || TP.ui.render; return R; }

  function render(root) {
    // This view APPENDS, and it is called directly on the panel by two handlers below as well as
    // through `shell.renderActive` (which clears first). Without this the panel gains a second copy
    // of every card, drawn below the first.
    r().clear(root);
    r().append(root, tripCard());
    r().append(root, identityCard());
    // The AI connection card belongs to the AI subsystem, which owns whether it exists at all:
    // under `file://` this returns the explanatory callout instead (REQ-604, REQ-605).
    if (TP.ui.aiPanel && TP.ui.aiPanel.settingsCard) r().append(root, TP.ui.aiPanel.settingsCard());
    r().append(root, storageCard());
    r().append(root, compactionCard());
    r().append(root, documentsCard());
    r().append(root, environmentCard());
    r().append(root, migrationCard());
  }

  // ---- The document itself ----

  function tripCard() {
    var container = TP.store.container();
    var history = TP.store.history();
    var build = container.build || {};
    var chain = TP.verify.chain(history);

    return r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [r().el('h2', { text: 'This document' })]),
      r().el('dl', { class: 'kv' }, [
        r().el('dt', { text: 'Identity' }),
        r().el('dd', { text: TP.store.docIdOf(container) || 'none yet — the first commit assigns one' }),
        r().el('dt', { text: 'Format' }),
        r().el('dd', { text: String(container.format || TP.container.FORMAT) + (TP.container.isReadableFormat(container.format) ? '' : ' — newer than this app reads') }),
        r().el('dt', { text: 'History' }),
        r().el('dd', { text: chain.ok ? TP.verify.label(chain) : 'does not hold together' }),
        r().el('dt', { text: 'Made with' }),
        r().el('dd', { text: (build.appVersion || 'unknown version') + (build.generatedAt ? ' on ' + TP.dates.fmtDate(String(build.generatedAt).slice(0, 10)) : '') }),
        r().el('dt', { text: 'App hash' }),
        r().el('dd', { text: build.appHash || 'not recorded' }),
      ]),
      TP.store.isReadOnly()
        ? r().el('div', { class: 'info info--warn mt', text: 'This document is open read-only. Nothing you do here is written to it, and nothing is written to this browser.' })
        : null,
    ]);
  }

  // ---- Who the commits are by ----

  function identityCard() {
    var settings = TP.store.readSettings();
    var author = settings.author || { name: '', email: '' };

    var name = r().el('input', { class: 'input', type: 'text', value: author.name || '', attrs: { placeholder: 'Your name' } });
    var email = r().el('input', { class: 'input', type: 'text', value: author.email || '', attrs: { placeholder: 'you@example.com' } });
    var saved = r().el('span', { class: 'subtle' });

    function save() {
      TP.store.writeSettings({ author: { name: name.value.trim() || 'You', email: email.value.trim() } });
      saved.textContent = 'Saved. Commits from now on carry this name.';
      TP.ui.toast.ok('Saved.');
    }
    name.addEventListener('change', save);
    email.addEventListener('change', save);

    return r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Commits are by' }),
        saved,
      ]),
      r().el('p', { class: 'subtle', text: 'This is written beside each commit you make. It stays in this browser and travels with the document when you export — a shared file shows who changed what.' }),
      r().el('div', { class: 'row' }, [
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Name' }), name]),
        r().el('div', { class: 'field' }, [r().el('label', { text: 'Email (optional)' }), email]),
      ]),
    ]);
  }

  // ---- Where it is kept ----

  function storageCard() {
    var storage = TP.store.storage();
    var status = TP.store.saveStatus();
    var bytes = storage && storage.bytesUsed ? storage.bytesUsed() : 0;
    var docId = TP.store.docIdOf(TP.store.container());
    var docBytes = storage && docId && storage.available() ? TP.registry.bytesFor(storage, docId) : 0;

    return r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Where this document is kept' }),
        storage && storage.available()
          ? r().button('Clear local copies…', function () { clearLocal(); }, { class: 'btn btn--ghost btn--sm' })
          : null,
      ]),
      r().el('div', { class: storage && storage.available() ? 'info' : 'info info--warn', text:
        storage && storage.describe ? storage.describe() : 'Nothing can be saved locally, so every change lives only on screen until you export.' }),
      r().el('dl', { class: 'kv' }, [
        r().el('dt', { text: 'Kept in' }), r().el('dd', { text: kindLabel(storage) }),
        r().el('dt', { text: 'This document' }), r().el('dd', { text: TP.format.fmtNumber(docBytes) + ' bytes' }),
        r().el('dt', { text: 'Everything here' }), r().el('dd', { text: TP.format.fmtNumber(bytes) + ' bytes' }),
        r().el('dt', { text: 'Last autosave' }), r().el('dd', { text: status.lastSavedAt ? TP.ui.history.when(status.lastSavedAt) : 'nothing saved yet' }),
      ]),
      status.error
        ? r().el('div', { class: 'info info--danger mt', text: status.error })
        : null,
      r().el('p', { class: 'subtle mt mb0', text:
        'What is stored here is a copy of the document, kept so you can carry on after a reload. The file you export is the document; deleting this copy never changes that file. No amount of local storage trouble is ever resolved by discarding your work — when space runs out the app says so rather than throwing something away.' }),
    ]);
  }

  function kindLabel(storage) {
    if (!storage) return 'nowhere';
    if (storage.downgraded) return 'this tab only (the browser blocked lasting storage)';
    var kind = storage.kind ? storage.kind() : 'unknown';
    if (kind === 'localstorage') return 'this browser';
    if (kind === 'memory') return 'this tab only';
    return 'nowhere — read-only';
  }

  // ---- Compaction (REQ-318, REQ-319, PAT-INV-05) ----
  //
  // The quota message in the storage adapter tells the person to "compact its history in Settings", and
  // this is that action, in the card under the sentence that promised it.
  //
  // WHAT IT DOES. Every commit stores its content one of three ways: a full copy, a list of changes
  // against its parent, or nothing at all (it inherits). Compaction re-decides which, replaying the
  // history from the start, and leaves everything else alone: the ids, the parents, the authors, the
  // timestamps and the head are all untouched. That is possible only because the commit hash never
  // covers the storage representation (REQ-302) — if it did, rewriting the representation would rewrite
  // the history, and this card could not exist.
  //
  // WHAT IT DOES NOT DO. It does not delete history. Removing commits the head cannot reach is a
  // different act, it loses something, and it is offered separately — only when such commits exist,
  // named by id and message, behind its own confirmation. PAT-INV-05: no code path deletes commits
  // without explicit informed user confirmation.
  function compactionCard() {
    if (TP.store.isReadOnly()) return null;
    var commits = TP.store.commits() || [];
    // One commit has nothing to rewrite: the root is a keyframe and stays one. Offering an action that
    // cannot change anything would be a button that teaches the wrong thing about the app.
    if (commits.length < 2) return null;

    return r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'History' }),
        r().el('span', { class: 'subtle', text: TP.format.plural(commits.length, 'commit') }),
        r().button('Compact…', function () { plan(); }, { class: 'btn btn--ghost btn--sm' }),
      ]),
      r().el('p', { class: 'subtle mb0', text:
        'Compacting rewrites how each commit is STORED — a full copy, a list of changes, or an inherited one — ' +
        'and changes nothing else. Every commit keeps its id and its place, so no part of your history is lost ' +
        'and every version stays openable. It is worth doing when this browser runs short of space.' }),
    ]);
  }

  // The dialog. The numbers come from the store, which gets them from the same function the action
  // itself will call, so what is promised here is what happens.
  function plan() {
    var dry = TP.store.planCompaction();
    var orphans = dry.unreachable || [];
    var worthwhile = dry.saved > 0;
    var dirty = TP.store.isDirty();

    var facts = r().el('dl', { class: 'kv' }, [
      r().el('dt', { text: 'Commits' }), r().el('dd', { text: String(TP.store.commits().length) + ' — all kept' }),
      r().el('dt', { text: 'Stored history now' }), r().el('dd', { text: TP.format.fmtNumber(dry.before) + ' bytes' }),
      r().el('dt', { text: 'After compacting' }), r().el('dd', { text: TP.format.fmtNumber(dry.after) + ' bytes' }),
      r().el('dt', { text: 'Saved' }), r().el('dd', { text: worthwhile ? TP.format.fmtNumber(dry.saved) + ' bytes' : 'nothing — it is already as small as this makes it' }),
      r().el('dt', { text: 'Full copies kept' }), r().el('dd', { text: dry.keyframesBefore + ' now, ' + dry.keyframesAfter + ' after' }),
    ]);

    // `body` is a LIST of nodes, which is what `modal.open` takes (`src/ui/modal.js` appends
    // `s.body` through `render.append`, which handles an array). So it is filled with `push` and
    // never with `r().append`: `append` calls `appendChild` on its parent, and an array has none —
    // which threw `parent.appendChild is not a function` from this function the moment there was a
    // dirty working copy or an unreachable commit to report, i.e. in both of the cases this dialog
    // exists for. It went unnoticed because a history with neither never reaches those lines.
    var body = [
      r().el('p', { text: 'Compaction replays this document’s history and re-decides how each commit is stored. ' +
        'The commits themselves are not touched: same ids, same order, same authors, same messages.' }),
      facts,
    ];

    if (dirty) {
      // The working copy holds edits that are not committed yet. Compaction does not touch them (the
      // store carries them across), but a person about to press a button about their history deserves
      // to know that the thing they can see and the thing being rewritten are not the same thing.
      body.push(r().el('div', { class: 'info info--warn' }, [
        r().el('div', { text: 'You have changes that are not committed yet. They are left exactly as they are — compaction only looks at what is already in the history.' }),
      ]));
    }

    if (orphans.length) {
      // The same question asked the other way, because the dialog is making two offers and a person
      // comparing them needs both numbers. `dry` is a plan that KEEPS the unreachable commits (what
      // the default action does), so on a history whose reachable part is already stored as compactly
      // as it goes, `saved` is 0 and the facts above say "nothing" — of a screen whose other button
      // offers to discard a thousand bytes. Both figures come from `TP.history.compact` through
      // `planCompaction`, so neither can drift from what pressing the button actually does.
      var without = TP.store.planCompaction({ removeOrphans: true });
      var extra = without.saved - dry.saved;
      var warning = [
        r().el('strong', { text: TP.format.plural(orphans.length, 'commit') + ' this document can no longer reach.' }),
        r().el('div', { text: 'These were left behind by a merge or a revert. Nothing points at them, so nothing here shows them — but they are still in the file, and they are still readable if anything ever changes its mind. Compacting KEEPS them unless you say otherwise.' }),
      ];
      if (extra > 0) {
        warning.push(r().el('div', { text: 'Discarding them as well would save a further ' + TP.format.fmtNumber(extra) + ' bytes.' }));
      }
      body.push(r().el('div', { class: 'info info--warn' }, warning));
      var list = r().el('ul', { class: 'sublist' });
      orphans.slice(0, 8).forEach(function (id) {
        var c = commitById(id);
        r().append(list, r().el('li', { text: TP.verify.shortId(id) + ' · ' + TP.ui.history.when(c && c.timestamp) + ' · ' + ((c && c.message) || 'no message') }));
      });
      if (orphans.length > 8) r().append(list, r().el('li', { class: 'subtle', text: 'and ' + (orphans.length - 8) + ' more' }));
      body.push(list);
    }

    var actions = [{ id: 'cancel', label: 'Leave it alone' }];
    if (worthwhile) {
      actions.push({ id: 'compact', label: 'Compact', run: function (settle) { apply(false, settle, dry); } });
    }
    if (orphans.length) {
      actions.push({
        id: 'compact-drop', label: worthwhile ? 'Compact and discard ' + TP.format.plural(orphans.length, 'unreachable commit') : 'Discard ' + TP.format.plural(orphans.length, 'unreachable commit'),
        danger: true,
        run: function (settle) { confirmDiscard(settle, orphans, dry); },
      });
    }

    if (!worthwhile && !orphans.length) {
      // Nothing to offer. Saying so is better than a disabled button with no explanation.
      body.push(r().el('p', { class: 'subtle mb0', text: 'There is nothing to gain right now: this history is already stored as compactly as this app knows how.' }));
    }

    return TP.ui.modal.open({
      title: 'Compact this history?',
      body: body,
      defaultAction: 'cancel',
      actions: actions,
    });
  }

  function commitById(id) {
    var list = TP.store.commits() || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // Discarding unreachable commits is the one destructive option, so it gets the second question — the
  // same two-step `clearLocal` uses for deleting a local copy. A danger action that fires on one click
  // is a danger action that will fire by accident.
  function confirmDiscard(settle, orphans, dry) {
    TP.ui.modal.confirm({
      title: 'Discard them for good?',
      body: r().el('div', {}, [
        r().el('p', { text: 'This removes ' + TP.format.plural(orphans.length, 'commit') + ' from this document. ' +
          'Nothing can reach them, so nothing will look different — and that is exactly why this is worth reading twice.' }),
        r().el('p', { text: 'They are not recoverable from this app afterwards. If any of them is work you might want back, ' +
          'export the document first: the file carries the whole history, reachable or not.' }),
        r().el('p', { class: 'subtle', text: 'The other ' + TP.format.plural((TP.store.commits().length - orphans.length), 'commit') + ' — everything this document actually shows — are kept.' + (dry.saved > 0 ? ' Compacting also saves ' + TP.format.fmtNumber(dry.saved) + ' bytes by itself.' : '') }),
      ]),
      confirmLabel: 'Discard them',
      danger: true,
    }).then(function (yes) {
      // No settle on "no", matching `confirmDelete` above: opening this dialog already closed the one
      // underneath it, so there is nothing left to settle — and asking again should be a fresh question,
      // not a resumed one.
      if (!yes) return;
      apply(true, settle, dry);
    });
  }

  function apply(removeOrphans, settle, dry) {
    var result = TP.store.compactHistory({ removeOrphans: removeOrphans });
    if (!result.ok) {
      TP.ui.toast.error(result.reason);
      settle(null);
      return;
    }
    TP.store.save({ silent: true });
    var report = result.report;
    var bits = ['History compacted — ' + TP.format.plural((TP.store.commits() || []).length, 'commit') + ' kept.'];
    if (report.saved > 0) bits.push(TP.format.fmtNumber(report.saved) + ' bytes saved.');
    else bits.push('It was already as small as this makes it.');
    if (removeOrphans) bits.push(TP.format.plural(report.removedOrphans, 'unreachable commit') + ' discarded.');
    else if (report.keptOrphans) bits.push(TP.format.plural(report.keptOrphans, 'unreachable commit') + ' kept.');
    TP.ui.toast.ok(bits.join(' '));
    settle(null);
    TP.ui.shell.renderActive();
  }

  function clearLocal() {
    var storage = TP.store.storage();
    var docId = TP.store.docIdOf(TP.store.container());
    if (!storage || !docId) return null;
    var bytes = TP.registry.bytesFor(storage, docId);
    var otherDocs = TP.registry.load(storage).docs.length - 1;

    return TP.ui.modal.open({
      title: 'Delete the local copies?',
      body: [
        r().el('div', { class: 'info info--danger' }, [
          r().el('strong', { text: 'This deletes work, and it cannot be undone.' }),
          r().el('div', { text: 'The copy of this document kept in this browser is removed — ' +
            TP.format.fmtNumber(bytes) + ' bytes' + (otherDocs > 0 ? ', and the ' + TP.format.plural(otherDocs, 'other document') + ' listed here are untouched' : '') + '.' }),
        ]),
        r().el('p', { text: 'The file you exported is not affected. If you have not exported since your last change, that change exists only here and will be gone.' }),
        r().el('p', { class: 'subtle', text: 'If you would rather keep it, export first — then this removes only the spare copy.' }),
      ],
      defaultAction: 'cancel',
      actions: [
        { id: 'cancel', label: 'Keep it' },
        { id: 'export-first', label: 'Export first' },
        { id: 'delete', label: 'Delete the copy', danger: true, run: function (settle) {
          confirmDelete(settle, storage, docId);
        } },
      ],
    });
  }

  function confirmDelete(settle, storage, docId) {
    TP.ui.modal.confirm({
      title: 'Last check',
      body: r().el('div', {}, [
        r().el('p', { text: 'Delete this browser’s copy of “' + TP.model.tripTitle(TP.store.trip()) + '”?' }),
        r().el('p', { class: 'subtle', text: 'Its commits are removed from this browser. The document on disk is not touched.' }),
      ]),
      confirmLabel: 'Delete it',
      danger: true,
    }).then(function (yes) {
      if (!yes) return;
      TP.registry.forget(storage, docId);
      TP.registry.removeEntry(storage, docId);
      TP.ui.tripList.render();
      TP.ui.shell.renderSidebarFoot();
      TP.ui.toast.info('The local copy is gone. Open the file to work on this document again.');
      settle(null);
      TP.ui.shell.renderActive();
    });
  }

  // ---- The documents this browser has seen ----

  function documentsCard() {
    var storage = TP.store.storage();
    var rows = storage && storage.available() ? TP.registry.load(storage).docs : [];
    var currentDoc = TP.store.docIdOf(TP.store.container());

    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Documents this browser has seen' }),
        r().el('span', { class: 'subtle', text: rows.length ? TP.format.plural(rows.length, 'document') : 'none yet' }),
      ]),
      r().el('p', { class: 'subtle', text: 'This list is a convenience, not a library. It is rebuilt from the files you open, and clearing it never deletes a document — the file you hold is the document.' }),
    ]);

    if (!rows.length) {
      r().append(card, r().el('p', { class: 'subtle mb0', text: 'No documents have been opened here yet. Use Import to open one.' }));
      return card;
    }

    rows.slice().sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); })
      .forEach(function (doc) {
        var bytes = TP.registry.bytesFor(storage, doc.docId);
        var held = TP.registry.hasLocal(storage, doc.docId);
        r().append(card, r().el('div', { class: 'cl-item' }, [
          r().el('div', { class: 'flex-1' }, [
            r().el('div', {}, [
              r().el('strong', { text: doc.title || 'Untitled trip' }),
              doc.docId === currentDoc ? r().el('span', { class: 'badge badge--done', text: 'open' }) : null,
              held ? null : r().el('span', { class: 'badge badge--optional', text: 'no copy here' }),
            ]),
            r().el('div', { class: 'subtle', text: (doc.updatedAt ? 'last opened ' + TP.ui.history.when(doc.updatedAt) : 'not opened since') + ' · ' + (held ? TP.format.fmtNumber(bytes) + ' bytes' : 'nothing stored in this browser') }),
          ]),
          r().el('span', { class: 'flex gap' }, [
            doc.docId === currentDoc ? null : r().button('Open', function () { TP.ui.tripList.openLocal(doc.docId); }, { class: 'btn btn--ghost btn--sm' }),
            r().button('Forget this entry', function () { forgetEntry(doc); }, { class: 'btn btn--ghost btn--sm' }),
          ]),
        ]));
      });

    return card;
  }

  function forgetEntry(doc) {
    return TP.ui.modal.open({
      title: 'Forget this document?',
      body: [
        r().el('p', { text: '“' + (doc.title || 'Untitled trip') + '” is removed from this list, along with the copy of it kept in this browser.' }),
        r().el('p', { class: 'subtle', text: 'The document itself is the file you have. It is not deleted, and you can open it again at any time.' }),
      ],
      defaultAction: 'forget',
      actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'forget', label: 'Forget it', danger: true }],
    }).then(function (id) {
      if (id !== 'forget') return null;
      var storage = TP.store.storage();
      var isCurrent = doc.docId === TP.store.docIdOf(TP.store.container());
      TP.registry.forget(storage, doc.docId);
      TP.registry.removeEntry(storage, doc.docId);
      TP.ui.tripList.render();
      TP.ui.toast.info('Forgotten. The file is untouched.');
      if (isCurrent) TP.ui.shell.renderActive();
      else render(TP.ui.render.byId('panel-settings'));
      return id;
    });
  }

  // ---- What this environment can do ----

  function environmentCard() {
    var env = TP.environment;
    var rows = [
      ['Your itinerary, budget, bookings and checklists', true, ''],
      ['Import from a file', true, ''],
      ['Export a document you can open anywhere', true, ''],
      ['History, revert, and reopening from this browser', true, env.isFile ? 'the browser may decline to keep copies for a file on disk' : ''],
      ['Save back over the file you opened', env.canSaveInPlace, env.canSaveInPlace ? '' : 'the browser offers no in-place save here'],
      ['Keeping a list of the documents you have opened', env.isFile ? false : true, env.isFile ? 'some browsers keep no lasting storage for a file on disk' : ''],
      ['Reaching an AI service', env.aiEnabled, env.aiEnabled ? '' : 'a file on disk has no web identity, so it cannot be given a key safely'],
    ];

    return r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'What works here' }),
        r().el('span', { class: 'badge badge--optional', text: env.isFile ? 'opened from a file' : 'opened from a web address' }),
      ]),
      r().el('table', { class: 'data compact' }, [
        r().el('tbody', {}, rows.map(function (row) {
          return r().el('tr', {}, [
            r().el('td', { text: row[0] }),
            r().el('td', { text: row[1] ? 'yes' : 'no' }),
            r().el('td', { class: 'subtle', text: row[2] || '' }),
          ]);
        })),
      ]),
      r().el('p', { class: 'subtle mb0', text: 'The only thing an address changes is the AI tab. Everything else about the planner is the same in both places, which is the point of a document that is also the program.' }),
    ]);
  }

  // ---- Older trips ----

  function migrationCard() {
    var env = TP.environment;
    if (env.isFile) {
      return r().el('div', { class: 'card' }, [
        r().el('div', { class: 'card__head' }, [r().el('h2', { text: 'Trips from the earlier version' })]),
        r().el('p', { class: 'subtle mb0', text: 'The earlier version of this planner kept trips in a browser database. Browsers do not give a file opened from disk access to that database, so the import cannot be offered here. Open this same planner from a web address and it appears.' }),
      ]);
    }
    if (!TP.registry.idbAvailable()) return null;

    var result = r().el('div', { class: 'mt' });

    return r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [r().el('h2', { text: 'Trips from the earlier version' })]),
      r().el('p', { class: 'subtle', text: 'If you used the earlier version of this planner in this browser, its trips can be brought forward. Each becomes its own document with its own history, and the older data is left exactly where it is.' }),
      r().el('div', { class: 'mt' }, [
        r().button('Look for older trips', function () {
          result.textContent = 'Looking…';
          Promise.resolve(TP.registry.migrateFromIndexedDB(TP.store.storage())).then(function (res) {
            R.mount(result, [r().el('div', { class: res.ok ? 'info' : 'info info--warn', text: res.message || 'Nothing was changed.' })]);
            if (res.ok && res.imported) {
              TP.ui.tripList.render();
              render(TP.ui.render.byId('panel-settings'));
            }
          });
        }, { class: 'btn' }),
      ]),
      result,
    ]);
  }

  return {
    render: render,
    identityCard: identityCard,
    storageCard: storageCard,
    documentsCard: documentsCard,
    environmentCard: environmentCard,
    migrationCard: migrationCard,
    forgetEntry: forgetEntry,
    clearLocal: clearLocal,
  };
})();
