// Producing a file (specs/02-architecture.md §5, specs/06-interchange.md §4).
//
// The document is assembled from a PRISTINE copy of the page taken before anything ran, not
// from the live DOM. This is the whole reason export is trustworthy: the running page has
// buttons, focus rings, toasts, a highlighted row, a half-typed title in an input — none of
// which belong in a file. Exporting the live DOM would write the user's momentary UI state
// into a document that is supposed to be reproducible.
//
// Every export passes five checks before the user is offered the result, and a failed check
// withholds the file rather than offering one the app has just proven wrong.

TP.io.export = (function () {
  'use strict';

  var SCRIPT_ID = 'app-script';
  var HASH_META = 'app-hash';

  // Called as boot.js's first statement, before any other code can touch the document.
  function capturePristine(root) {
    var source = root || document.documentElement;
    TP.pristine = source.cloneNode(true);
    return TP.pristine;
  }

  function pristine() {
    if (!TP.pristine) throw new Error('export: the pristine copy was not captured at boot');
    return TP.pristine;
  }

  // ---- Assembly ----

  function assemble(container) {
    var clone = pristine().cloneNode(true);
    var block = clone.querySelector('#' + TP.container.BLOCK_ID);
    if (!block) throw new Error('export: the pristine copy has no #' + TP.container.BLOCK_ID + ' block');
    // textContent assigns characters; it does not parse them. The escaping is what keeps a
    // payload containing the "<\/script>" sequence from ending the block early.
    block.textContent = TP.container.toBlockText(container);
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  // ---- The five checks ----

  function checkDocument(html, container) {
    var checks = [];
    function add(name, ok, detail) { checks.push({ name: name, ok: !!ok, detail: detail || '' }); }

    // 1. The assembled document re-parses far enough to find the data block.
    var blockText = TP.container.scanBlock(html);
    add('The document re-reads as a document', blockText != null,
      blockText == null ? 'No data block was found in the assembled text.' : '');

    // 2. The block's text is JSON.
    var parsed = null;
    var parseError = '';
    if (blockText != null) {
      try { parsed = TP.container.parseBlock(blockText); }
      catch (e) { parseError = e && e.message ? e.message : String(e); }
    }
    add('The data block is valid JSON', !!parsed, parseError);

    // 3. What came back out is what went in — compared canonically, so key order and
    //    formatting are not mistaken for content.
    var same = false;
    if (parsed) {
      try {
        same = TP.canonical.serialize(parsed) === TP.canonical.serialize(container);
      } catch (e) { same = false; }
    }
    add('The data block carries exactly this document', same,
      same ? '' : 'The document read back differs from the one written.');

    // 4. The script text is byte-identical to the one that is running.
    var clone = pristine().cloneNode(true);
    var liveScript = document.getElementById(SCRIPT_ID);
    var cloneScript = clone.querySelector('#' + SCRIPT_ID);
    var identical = !!(liveScript && cloneScript) && liveScript.textContent === cloneScript.textContent;
    add('The program text is unchanged', identical,
      identical ? '' : 'The embedded program differs from the one running.');

    // 5. The declared hash matches the program it claims to describe.
    var declared = clone.querySelector('meta[name="' + HASH_META + '"]');
    var declaredHash = declared ? declared.getAttribute('content') : null;
    var computed = liveScript ? 'sha256-' + TP.sha256.base64(liveScript.textContent) : null;
    var hashOk = !!declaredHash && declaredHash === computed;
    add('The program matches its declared hash', hashOk,
      hashOk ? '' : 'Declared ' + (declaredHash || 'nothing') + ', computed ' + (computed || 'nothing') + '.');

    return {
      ok: checks.every(function (c) { return c.ok; }),
      checks: checks,
    };
  }

  // ---- The three exports ----

  function artifact(container) {
    var html;
    try {
      html = assemble(container);
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : String(e), checks: [] };
    }
    var result = checkDocument(html, container);
    if (!result.ok) {
      var failed = result.checks.filter(function (c) { return !c.ok; });
      return {
        ok: false,
        checks: result.checks,
        reason: 'This file failed its own check, so it was not offered for saving. ' +
          failed.map(function (c) { return c.name + (c.detail ? ' (' + c.detail + ')' : ''); }).join(' '),
      };
    }
    return {
      ok: true,
      checks: result.checks,
      text: html,
      mime: 'text/html',
      filename: filenameFor(TP.model.tripTitle(TP.container.payloadTrip(container)) || 'trip', 'html'),
    };
  }

  function tripData(trip) {
    var value = TP.tripdatajson.fromTrip(trip);
    return {
      ok: true,
      checks: [],
      text: JSON.stringify(value, null, 2) + '\n',
      mime: 'application/json',
      filename: filenameFor(TP.model.tripTitle(trip) || 'trip', 'json'),
      losses: TP.tripdatajson.losses(),
    };
  }

  function ical(trip) {
    var out;
    try {
      out = TP.ical.fromTrip(trip);
    } catch (e) {
      return { ok: false, reason: 'The calendar could not be produced: ' + (e && e.message ? e.message : e) };
    }
    return {
      ok: true,
      checks: [],
      text: out.text,
      mime: 'text/calendar',
      filename: filenameFor(TP.model.tripTitle(trip) || 'trip', 'ics'),
      losses: out.losses,
      blocked: out.blocked || [],
      synthesized: out.synthesized || [],
    };
  }

  // The printable plan. Not an interchange format: it is a one-way rendering of the model for
  // paper, so it has no round-trip and no self-checks — only a declared disclosure of the
  // machine-only metadata it does not carry (specs/06-interchange.md §3.4's habit).
  function markdown(trip) {
    var out;
    try {
      out = TP.markdown.fromTrip(trip);
    } catch (e) {
      return { ok: false, reason: 'The printable document could not be produced: ' + (e && e.message ? e.message : e) };
    }
    return {
      ok: true,
      checks: [],
      text: out.text,
      mime: 'text/markdown',
      filename: filenameFor(TP.model.tripTitle(trip) || 'trip', 'md'),
      losses: out.losses && out.losses.length ? out.losses : TP.markdown.losses(),
    };
  }

  // What a format cannot carry, phrased for the confirmation dialog. The list is the same data
  // the mappers were written against, so the two cannot drift apart (REQ-512).
  function disclosures(format) {
    var losses = format === 'ical' ? TP.ical.losses()
      : format === 'tripdata' ? TP.tripdatajson.losses()
        : format === 'markdown' ? TP.markdown.losses() : [];
    if (!losses.length) return { items: [], text: '' };
    return {
      items: losses,
      text: 'What this format cannot carry: ' + losses.map(function (l) {
        return l.field + (l.note ? ' (' + l.note + ')' : '');
      }).join('; ') + '. Everything else in your trip is included.',
    };
  }

  // ---- Delivery ----

  function filenameFor(title, ext) {
    var base = String(title || 'trip')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '')
      .slice(0, 60) || 'trip';
    return base + '.' + ext;
  }

  function download(text, filename, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // The node is removed on the next turn, so the click has certainly been dispatched.
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  // Returns a promise. Written without async/await so the artifact stays parseable by any
  // engine the app claims to support.
  function deliver(result) {
    if (!result || !result.ok) {
      return Promise.resolve(result || { ok: false, reason: 'Nothing to export.' });
    }
    var env = TP.environment;

    // Saving in place is offered only where the platform really has it. When it is absent the
    // download is not a downgrade, it is the same file by a route that always exists.
    if (env.canSaveInPlace && typeof window.showSaveFilePicker === 'function') {
      var accept = {};
      accept[result.mime] = ['.' + result.filename.split('.').pop()];
      return window.showSaveFilePicker({
        suggestedName: result.filename,
        types: [{ description: result.mime === 'text/html' ? 'Planner document' : 'Data file', accept: accept }],
      }).then(function (handle) {
        return handle.createWritable().then(function (writable) {
          return writable.write(result.text).then(function () { return writable.close(); });
        });
      }).then(function () {
        return {
          ok: true, via: 'save-in-place', filename: result.filename,
          checks: result.checks || [], text: result.text, offerCopy: false,
        };
      }).catch(function (e) {
        if (e && e.name === 'AbortError') {
          return { ok: false, aborted: true, reason: 'The save was cancelled. Nothing was written.' };
        }
        // Fall back to the download rather than reporting a failure the user cannot act on.
        return byDownload(result, env);
      });
    }

    return Promise.resolve(byDownload(result, env));
  }

  function byDownload(result, env) {
    download(result.text, result.filename, result.mime);
    return {
      ok: true,
      via: 'download',
      filename: result.filename,
      checks: result.checks || [],
      // A download from a file:// page can be refused by the browser's settings. The text is
      // offered in the UI as well, so there is always a route that works (REQ-510, REQ-604).
      offerCopy: !!env.prefersTextExport,
      text: result.text,
    };
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return { ok: true, via: 'clipboard' }; })
        .catch(function () { return { ok: false, reason: 'The browser refused clipboard access. Select the text and copy it by hand.' }; });
    }
    return Promise.resolve({ ok: false, reason: 'This browser has no clipboard API. Select the text and copy it by hand.' });
  }

  return {
    SCRIPT_ID: SCRIPT_ID,
    HASH_META: HASH_META,
    capturePristine: capturePristine,
    assemble: assemble,
    checkDocument: checkDocument,
    artifact: artifact,
    tripData: tripData,
    ical: ical,
    markdown: markdown,
    disclosures: disclosures,
    filenameFor: filenameFor,
    download: download,
    deliver: deliver,
    copyToClipboard: copyToClipboard,
  };
})();
