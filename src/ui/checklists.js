// Checklists: collapsible category groups with per-item done state (specs/03 §2.4).
//
// The canonical model stores {id, category, items:[{id, text, done}]}. The trip-data.json wire
// format has no place for `done`, so it is dropped on export — disclosed in the export dialog
// rather than silently forgotten (the ledger's one D on the checklist side).

TP.ui.checklists = (function () {
  'use strict';

  var R = null;
  function r() { R = R || TP.ui.render; return R; }

  function render(root) {
    var trip = TP.store.trip();
    var lists = trip.checklists || [];
    var done = 0;
    var total = 0;
    lists.forEach(function (c) {
      (c.items || []).forEach(function (i) { total++; if (i.done) done++; });
    });

    r().append(root, r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Checklists' }),
        r().el('span', { class: 'subtle', text: total ? done + ' of ' + total + ' done' : 'Nothing here yet' }),
      ]),
      r().el('p', { class: 'subtle mb0', text:
        'Grouped lists — packing, documents, shopping. Whether an item is ticked is kept in this ' +
        'planner, and is the one thing the plain-JSON export cannot carry.' }),
    ]));

    if (!lists.length) {
      r().append(root, r().el('div', { class: 'empty' }, [
        r().el('h2', { text: 'No checklists yet' }),
        r().el('p', { text: 'Add a category, then add items to it.' }),
        r().button('Add a checklist', function () { addList(); }, { class: 'btn btn--primary' }),
      ]));
      return;
    }

    lists.forEach(function (list) { r().append(root, listCard(list)); });
  }

  function listCard(list) {
    var items = list.items || [];
    var doneCount = items.filter(function (i) { return i.done; }).length;

    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: list.category || 'Untitled list' }),
        r().el('span', { class: 'subtle', text: items.length ? doneCount + '/' + items.length : 'empty' }),
        r().el('span', { class: 'flex gap ml-auto' }, [
          r().button('Rename', function () { renameList(list.id); }, { class: 'btn btn--ghost btn--sm' }),
          r().button('Delete', function () { removeList(list.id); }, { class: 'btn btn--ghost btn--sm' }),
        ]),
      ]),
    ]);

    if (!items.length) {
      r().append(card, r().el('p', { class: 'subtle', text: 'No items in this list yet.' }));
    } else {
      items.forEach(function (item) {
        r().append(card, r().el('div', { class: 'cl-item' }, [
          (function () {
            var box = r().el('input', { type: 'checkbox', checked: !!item.done, attrs: { 'aria-label': item.text || 'Item' } });
            box.addEventListener('change', function () { toggleItem(list.id, item.id, box.checked); });
            return box;
          })(),
          r().el('span', { class: ['cl-text', item.done ? 'cl-text--done' : ''], text: item.text || '' }),
          r().el('span', { class: 'flex gap' }, [
            r().button('✎', function () { editItem(list.id, item.id); }, { class: 'btn btn--ghost btn--sm', attrs: { 'aria-label': 'Edit this item' } }),
            r().button('✕', function () { removeItem(list.id, item.id); }, { class: 'btn btn--ghost btn--sm', attrs: { 'aria-label': 'Remove this item' } }),
          ]),
        ]));
      });
    }

    r().append(card, r().el('div', { class: 'mt' }, [
      r().button('+ Add an item', function () { addItem(list.id); }, { class: 'btn btn--sm' }),
    ]));

    return card;
  }

  // ---- Mutations ----

  function applyEdit(mutate) {
    TP.store.edit('Change a checklist', mutate);
    TP.ui.shell.renderAll();
  }

  function addList() {
    return TP.ui.modal.prompt({
      title: 'New checklist',
      body: r().el('p', { class: 'subtle', text: 'A name for the list — "Packing", "Documents", "Before we leave".' }),
      required: true,
      okLabel: 'Add it',
      placeholder: 'Packing',
    }).then(function (name) {
      if (!name) return null;
      applyEdit(function (trip) {
        trip.checklists = trip.checklists || [];
        trip.checklists.push({ id: TP.uid(), category: name.trim(), items: [] });
      });
      return name;
    });
  }

  function renameList(listId) {
    var trip = TP.store.trip();
    var list = TP.model.findIn(trip.checklists, listId);
    if (!list) return null;
    return TP.ui.modal.prompt({
      title: 'Rename checklist',
      value: list.category || '',
      required: true,
      okLabel: 'Rename',
    }).then(function (name) {
      if (!name) return null;
      applyEdit(function (t) {
        var target = TP.model.findIn(t.checklists, listId);
        if (target) target.category = name.trim();
      });
      return name;
    });
  }

  function removeList(listId) {
    var trip = TP.store.trip();
    var list = TP.model.findIn(trip.checklists, listId);
    if (!list) return null;
    var items = (list.items || []).length;
    var go = items
      ? TP.ui.modal.confirm({
        title: 'Delete this checklist?',
        body: r().el('p', { text: 'It has ' + TP.format.plural(items, 'item') + '. They go with it, and History can put the whole list back.' }),
        confirmLabel: 'Delete it',
        danger: true,
      })
      : Promise.resolve(true);
    return go.then(function (yes) {
      if (!yes) return null;
      applyEdit(function (t) {
        t.checklists = (t.checklists || []).filter(function (c) { return c.id !== listId; });
      });
      return listId;
    });
  }

  function addItem(listId) {
    return TP.ui.modal.prompt({
      title: 'New item',
      required: true,
      okLabel: 'Add it',
      placeholder: 'Passport',
    }).then(function (text) {
      if (!text) return null;
      applyEdit(function (t) {
        var list = TP.model.findIn(t.checklists, listId);
        if (!list) return;
        list.items = list.items || [];
        list.items.push({ id: TP.uid(), text: text.trim(), done: false });
      });
      return text;
    });
  }

  function editItem(listId, itemId) {
    var trip = TP.store.trip();
    var list = TP.model.findIn(trip.checklists, listId);
    if (!list) return null;
    var item = TP.model.findIn(list.items, itemId);
    if (!item) return null;
    return TP.ui.modal.prompt({
      title: 'Edit item',
      value: item.text || '',
      required: true,
      okLabel: 'Save',
    }).then(function (text) {
      if (!text) return null;
      applyEdit(function (t) {
        var l = TP.model.findIn(t.checklists, listId);
        var i = l ? TP.model.findIn(l.items, itemId) : null;
        if (i) i.text = text.trim();
      });
      return text;
    });
  }

  function toggleItem(listId, itemId, done) {
    applyEdit(function (t) {
      var list = TP.model.findIn(t.checklists, listId);
      var item = list ? TP.model.findIn(list.items, itemId) : null;
      if (item) item.done = !!done;
    });
  }

  function removeItem(listId, itemId) {
    applyEdit(function (t) {
      var list = TP.model.findIn(t.checklists, listId);
      if (!list) return;
      list.items = (list.items || []).filter(function (i) { return i.id !== itemId; });
    });
  }

  return {
    render: render,
    addList: addList,
    renameList: renameList,
    removeList: removeList,
    addItem: addItem,
    editItem: editItem,
    toggleItem: toggleItem,
    removeItem: removeItem,
  };
})();
