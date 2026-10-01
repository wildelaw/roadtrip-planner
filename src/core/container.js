// The container codec seam (specs/02-architecture.md §2, §5).
//
// Nothing else reads or writes `#app-data`, and nothing else knows the escaping rule. That is
// the point of the seam: the one place where a change in the embedding format has to happen.

TP.container = (function () {
  'use strict';

  var SCHEMA = 'https://trip-planner.invalid/schemas/container-1.0.0.schema.json';
  var FORMAT = '1.0.0';
  var BLOCK_ID = 'app-data';

  // Resource guards (REQ-517). Every one of them fails with an explanation naming the limit
  // and the actual value, and offers to export what was readable — never a blank page
  // (REQ-518).
  //
  // `maxSourceChars` bounds the WHOLE FILE a user hands to Import, and it has to sit above the
  // largest file this app can write. A document carries its own program — ~430 KB of it — plus a
  // data block that `maxBytes` allows to reach 16 MB, so the largest file this app produces is
  // under 17 MB. A limit below that made the app refuse its own exports, which is the one file it
  // must always be able to read back (REQ-404). The cap is therefore set at twice that: 32 M
  // characters, high enough for any document it can write and low enough to refuse a file that
  // was never one.
  var LIMITS = {
    maxBytes: 16 * 1024 * 1024,
    maxCommits: 20000,
    maxPatchOps: 200000,
    maxDepth: 64,
    maxSourceChars: 32 * 1024 * 1024,
  };

  function GuardError(message) { this.name = 'GuardError'; this.message = message; }
  GuardError.prototype = Object.create(Error.prototype);

  // ---- Escaping ----
  //
  // The sequence `<\/script` anywhere in the JSON would end the block early and turn the rest
  // of the payload into markup. (Every occurrence of that sequence in these sources is written
  // with the backslash, because the literal one would end the INLINE script in the artifact —
  // see build.js.) Escaping every `<` as \u003c is safe: inside a JSON string it denotes the
  // same character, and outside a string `<` cannot appear in valid JSON.

  function escapeForScriptBlock(jsonText) {
    return String(jsonText)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  // ---- Null-prototype reconstruction (REQ-503) ----
  //
  // JSON.parse produces objects with Object.prototype, so a key named `__proto__` in a
  // hostile file is a prototype-pollution primitive the moment anything merges over it.
  // Every parsed object becomes null-prototype, and depth is bounded while we walk.

  function nullProto(value, depth, limit) {
    var d = depth || 0;
    if (d > limit) {
      throw new GuardError('The file nests deeper than ' + limit + ' levels (found at least ' + d +
        '). It may be malformed or hostile; nothing was loaded.');
    }
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      var arr = [];
      for (var i = 0; i < value.length; i++) arr.push(nullProto(value[i], d + 1, limit));
      return arr;
    }
    var out = Object.create(null);
    for (var k in value) {
      if (Object.prototype.hasOwnProperty.call(value, k)) {
        out[k] = nullProto(value[k], d + 1, limit);
      }
    }
    return out;
  }

  function parseJSONHardened(text, context) {
    var value;
    try {
      value = JSON.parse(text);
    } catch (e) {
      throw new GuardError('The ' + context + ' is not valid JSON: ' + e.message);
    }
    return nullProto(value, 0, LIMITS.maxDepth);
  }

  // ---- Locating the block by string scanning (REQ-502) ----
  //
  // Never a DOM parser: the file being read is untrusted, and a DOM parse builds a document
  // from hostile markup (06-interchange.md §5.1). We look for the marker, take the text after
  // the first `>` that closes the tag, and read up to the next `<\/script`.
  //
  // The marker is deliberately the id attribute alone. A hostile file could write
  // `<script type="text/plain" id="app-data">`, and it would still be found — which is
  // correct: we are reading text, and every script element's content is raw text.

  function scanBlock(source) {
    var src = String(source == null ? '' : source);
    var marker = 'id="' + BLOCK_ID + '"';
    var altMarker = "id='" + BLOCK_ID + "'";
    var at = src.indexOf(marker);
    if (at === -1) at = src.indexOf(altMarker);
    if (at === -1) return null;
    var open = src.indexOf('>', at);
    if (open === -1) return null;
    // Split rather than written whole: the literal would terminate the artifact's own inline
    // script element, which the HTML parser ends at the first occurrence of that sequence.
    var close = src.indexOf('<' + '/script', open);
    if (close === -1) return null;
    return src.slice(open + 1, close);
  }

  function parseBlock(text) {
    var raw = String(text == null ? '' : text);
    // Char count is a lower bound on byte count, so this is the cheap conservative check.
    if (raw.length > LIMITS.maxBytes) {
      throw new GuardError('The data block is ' + raw.length + ' characters, beyond the ' +
        LIMITS.maxBytes + '-byte ceiling this app will load.');
    }
    return parseJSONHardened(raw, 'data block');
  }

  // ---- The running document ----
  //
  // For the running artifact the block is read from our own document. It is still the same
  // text the HTML parser produced — nothing here parses markup, and the untrusted path
  // (import) goes through scanBlock over the file's text instead.

  function readRaw() {
    var el = document.getElementById(BLOCK_ID);
    if (!el) return null;
    return el.textContent;
  }

  function read() {
    var raw = readRaw();
    if (raw == null) {
      throw new GuardError('This file has no data block (no element with id="' + BLOCK_ID + '").');
    }
    var container = parseBlock(raw);
    return validate(container);
  }

  // ---- Envelope ----

  function create(payload, build, history) {
    return {
      $schema: SCHEMA,
      format: FORMAT,
      payload: payload,
      history: history || { keyframeInterval: 20, head: null, commits: [] },
      build: build || { appVersion: '0.0.0', appHash: '', generatedAt: new Date().toISOString() },
    };
  }

  function validate(container) {
    if (!container || typeof container !== 'object') {
      throw new GuardError('The data block does not contain a container object.');
    }
    if (typeof container.format !== 'string') {
      throw new GuardError('The container has no `format` field, so this app cannot tell whether it can read it.');
    }
    if (!container.payload || typeof container.payload !== 'object') {
      throw new GuardError('The container has no `payload`.');
    }
    var h = container.history;
    if (!h || typeof h !== 'object') {
      throw new GuardError('The container has no `history`.');
    }
    if (!Array.isArray(h.commits)) {
      throw new GuardError('The container’s `history.commits` is not a list.');
    }
    if (h.commits.length > LIMITS.maxCommits) {
      throw new GuardError('The container holds ' + h.commits.length + ' commits, beyond the ' +
        LIMITS.maxCommits + ' this app will load.');
    }
    if (typeof h.keyframeInterval !== 'number' || !(h.keyframeInterval >= 1)) {
      h.keyframeInterval = 20;
    }
    return container;
  }

  // A container whose `format` is newer than the app's is opened read-only, with an
  // explanation (REQ-212). The app never guesses at a format's semantics — a guess that
  // parses is a guess that gets written back.
  function compareFormat(a, b) {
    var pa = String(a || '').split('.').map(function (x) { return parseInt(x, 10) || 0; });
    var pb = String(b || '').split('.').map(function (x) { return parseInt(x, 10) || 0; });
    for (var i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
    }
    return 0;
  }

  function isReadableFormat(format) {
    return compareFormat(format, FORMAT) <= 0;
  }

  // ---- Serialization ----
  //
  // The container as it appears in the file is pretty-printed: the whole premise of the
  // pattern is that a person can open the file and read it. Hashing uses
  // TP.canonical.serialize over the payload, never this.

  function serialize(container) {
    return JSON.stringify(container, null, 2);
  }

  function toBlockText(container) {
    return escapeForScriptBlock(serialize(container));
  }

  function payloadTrip(container) {
    var p = container && container.payload;
    return p && p.trip ? p.trip : null;
  }

  function commits(container) {
    return (container && container.history && container.history.commits) || [];
  }

  return {
    SCHEMA: SCHEMA,
    FORMAT: FORMAT,
    BLOCK_ID: BLOCK_ID,
    LIMITS: LIMITS,
    GuardError: GuardError,
    escapeForScriptBlock: escapeForScriptBlock,
    nullProto: nullProto,
    parseJSONHardened: parseJSONHardened,
    scanBlock: scanBlock,
    parseBlock: parseBlock,
    readRaw: readRaw,
    read: read,
    create: create,
    validate: validate,
    compareFormat: compareFormat,
    isReadableFormat: isReadableFormat,
    serialize: serialize,
    toBlockText: toBlockText,
    payloadTrip: payloadTrip,
    commits: commits,
  };
})();
