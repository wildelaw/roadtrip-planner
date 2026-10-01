// Modals: the app's one channel for "decide something" (specs/07-ui.md §8).
//
// Every modal returns a promise for the id of the action chosen, or null if it was dismissed.
// A caller therefore cannot forget to handle "the user closed it" — there is no path where a
// destructive act proceeds because a dialog vanished.

TP.ui.modal = (function () {
  'use strict';

  var current = null;

  function host() { return TP.ui.render.byId('modal-host'); }

  function open(spec) {
    var s = spec || {};
    var hostEl = host();
    if (!hostEl) return Promise.resolve(null);

    close(null);

    return new Promise(function (resolve) {
      var settled = false;

      function settle(id) {
        if (settled) return;
        settled = true;
        close(id);
        resolve(id);
      }

      var body = TP.ui.render.el('div', { class: 'modal__body' });
      TP.ui.render.append(body, s.body);

      var actions = TP.ui.render.el('div', { class: 'modal__actions' });
      (s.actions || [{ id: 'close', label: 'Close' }]).forEach(function (a) {
        // An action may supply `run(settle)` when it needs to validate before the dialog
        // closes. Returning without calling settle keeps the dialog open.
        var handler = a.run
          ? function () { a.run(settle); }
          : function () { settle(a.id); };
        actions.appendChild(TP.ui.render.button(a.label, handler, {
          class: a.danger ? 'btn btn--danger' : (a.id === (s.defaultAction || '') ? 'btn btn--primary' : 'btn'),
        }));
      });

      var box = TP.ui.render.el('div', {
        class: 'modal',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': s.title || 'Dialog' },
      }, [
        s.title ? TP.ui.render.el('h3', { text: s.title }) : null,
        body,
        actions,
      ]);

      var onKey = function (e) {
        if (e.key === 'Escape' && s.dismissible !== false) { settle(null); }
      };
      var onBackdrop = function (e) {
        if (e.target === hostEl && s.dismissible !== false) settle(null);
      };

      TP.ui.render.mount(hostEl, box);
      hostEl.removeAttribute('hidden');
      hostEl.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);

      current = {
        settle: settle,
        cleanup: function () {
          document.removeEventListener('keydown', onKey);
          hostEl.removeEventListener('click', onBackdrop);
        },
      };

      var focusable = box.querySelector('button, input, select, textarea, a[href]');
      if (focusable) focusable.focus();
    });
  }

  function close() {
    var hostEl = host();
    if (current && current.cleanup) current.cleanup();
    current = null;
    if (hostEl) {
      TP.ui.render.clear(hostEl);
      hostEl.setAttribute('hidden', '');
    }
  }

  // A confirmation. The default action is deliberately the safe one, and `danger` styles the
  // affirmative button so a destructive click is never the visually quiet one.
  function confirm(spec) {
    var s = spec || {};
    return open({
      title: s.title || 'Are you sure?',
      body: s.body,
      defaultAction: 'cancel',
      dismissible: s.dismissible !== false,
      actions: [
        { id: 'cancel', label: s.cancelLabel || 'Cancel' },
        { id: 'confirm', label: s.confirmLabel || 'Confirm', danger: !!s.danger },
      ],
    }).then(function (id) { return id === 'confirm'; });
  }

  // Information with one way out. Used for disclosures the user must actually read — the
  // lossiness ledger, an integrity failure, a read-only explanation.
  function notice(spec) {
    var s = spec || {};
    return open({
      title: s.title || 'Notice',
      body: s.body,
      defaultAction: 'ok',
      dismissible: s.dismissible !== false,
      actions: [{ id: 'ok', label: s.okLabel || 'OK' }],
    });
  }

  // A prompt for one string. Returns null when dismissed, so "empty" and "cancelled" stay
  // distinguishable — a blank commit message is not the same as not committing.
  function prompt(spec) {
    var s = spec || {};
    var input = TP.ui.render.el('input', {
      class: 'input', type: 'text', value: s.value || '',
      attrs: { placeholder: s.placeholder || '', 'aria-label': s.title || 'Value' },
    });
    var area = s.multiline
      ? TP.ui.render.el('textarea', { class: 'input', value: s.value || '', attrs: { rows: s.rows || 5 } })
      : input;
    var control = s.multiline ? area : input;

    var error = TP.ui.render.el('div', { class: 'subtle mt' });

    var promise = open({
      title: s.title || 'Enter a value',
      body: [s.body || null, TP.ui.render.el('div', { class: 'field' }, control), error],
      defaultAction: 'ok',
      dismissible: true,
      actions: [
        { id: 'cancel', label: 'Cancel' },
        {
          id: 'ok',
          label: s.okLabel || 'OK',
          run: function (settle) {
            var value = String(control.value == null ? '' : control.value);
            // Validation happens with the dialog still open, so a rejected value is a
            // correction the user can make rather than a dialog that vanished.
            if (s.required && !value.trim()) {
              error.textContent = s.requiredMessage || 'A value is needed here.';
              control.focus();
              return;
            }
            settle('ok');
          },
        },
      ],
    });

    return promise.then(function (id) {
      if (id !== 'ok') return null;
      return String(control.value == null ? '' : control.value);
    });
  }

  function isOpen() { return !!current; }

  return {
    open: open,
    close: close,
    confirm: confirm,
    notice: notice,
    prompt: prompt,
    isOpen: isOpen,
  };
})();
