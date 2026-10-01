// Toasts: the app's one channel for "something happened" (specs/07-ui.md §8).

TP.ui.toast = (function () {
  'use strict';

  var DEFAULTS = { ok: 3200, info: 4200, warn: 6000, error: 9000 };

  function host() {
    return TP.ui.render.byId('toasts');
  }

  function show(message, kind, options) {
    var hostEl = host();
    if (!hostEl) return null;
    var opts = options || {};
    var text = message == null ? '' : String(message);
    var node = TP.ui.render.el('div', {
      class: ['toast', kind && kind !== 'info' ? 'toast--' + kind : ''],
      attrs: { role: kind === 'error' ? 'alert' : 'status' },
      text: text,
    });
    if (opts.action && opts.action.label && typeof opts.action.run === 'function') {
      node.appendChild(TP.ui.render.el('div', { class: 'toast__action mt' }, [
        TP.ui.render.button(opts.action.label, function () {
          dismiss(node);
          opts.action.run();
        }, { class: 'btn btn--sm' }),
      ]));
    }
    hostEl.appendChild(node);
    var ms = opts.ms != null ? opts.ms : (DEFAULTS[kind] || DEFAULTS.info);
    if (ms > 0) setTimeout(function () { dismiss(node); }, ms);
    return node;
  }

  function dismiss(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  function clear() {
    var hostEl = host();
    if (hostEl) TP.ui.render.clear(hostEl);
  }

  return {
    show: show,
    ok: function (m, o) { return show(m, 'ok', o); },
    info: function (m, o) { return show(m, 'info', o); },
    warn: function (m, o) { return show(m, 'warn', o); },
    error: function (m, o) { return show(m, 'error', o); },
    dismiss: dismiss,
    clear: clear,
  };
})();
