// Formatting helpers. Pure string/number work — nothing here touches the DOM.
//
// The present app's `escapeHTML` and `renderMarkdown`-returning-a-string are gone: the render
// seam (ui/render.js) is the only path from data to DOM (REQ-701), so a formatter that
// produced markup would be a second one.

TP.format = (function () {
  'use strict';

  function fmtMoney(amount, currency) {
    var n = Number(amount);
    if (!isFinite(n)) n = 0;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 2,
      }).format(n);
    } catch (e) {
      return (currency || 'USD') + ' ' + n.toFixed(2);
    }
  }

  function fmtNumber(n, digits) {
    var v = Number(n);
    if (!isFinite(v)) v = 0;
    try {
      return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits == null ? 2 : digits }).format(v);
    } catch (e) {
      return String(v);
    }
  }

  function truncate(s, n) {
    var str = s == null ? '' : String(s);
    if (!n || str.length <= n) return str;
    return str.slice(0, n - 1) + '…';
  }

  // The one place a free-text cost string becomes a number. Shared by the model, the
  // interchange mappers and the budget roll-up so they cannot disagree.
  function parseCost(s) {
    if (s == null) return undefined;
    if (typeof s === 'number') return isFinite(s) ? s : undefined;
    var m = String(s).match(/\$?\s*([\d,]+(?:\.\d+)?)/);
    if (!m) return undefined;
    var n = parseFloat(m[1].replace(/,/g, ''));
    return isFinite(n) ? n : undefined;
  }

  // URL-valued fields are validated against a scheme allowlist (REQ-704).
  var ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:'];

  function safeUrl(raw) {
    var s = raw == null ? '' : String(raw).trim();
    if (!s) return null;
    // Reject anything that is not an absolute URL with an allowed scheme. A relative URL has
    // no scheme and is rejected too: every link this app renders is absolute.
    var m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s);
    if (!m) return null;
    var scheme = m[1].toLowerCase() + ':';
    if (ALLOWED_SCHEMES.indexOf(scheme) === -1) return null;
    return s;
  }

  // A link label that might itself be a URL: only returns a URL when it is a safe one.
  function linkifyTarget(raw) {
    var s = raw == null ? '' : String(raw).trim();
    if (!s) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return safeUrl(s);
    if (/^www\./i.test(s)) return safeUrl('https://' + s);
    return null;
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  return {
    fmtMoney: fmtMoney,
    fmtNumber: fmtNumber,
    truncate: truncate,
    parseCost: parseCost,
    safeUrl: safeUrl,
    linkifyTarget: linkifyTarget,
    plural: plural,
    ALLOWED_SCHEMES: ALLOWED_SCHEMES,
  };
})();
