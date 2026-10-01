// Reading a file the user chose (specs/06-interchange.md §2, REQ-501–REQ-505).
//
// Two rules govern this whole file:
//
//   * The text is TEXT. It is never written into the document. No iframe, no innerHTML, no
//     parser fed the file in "HTML mode" — the app reads characters and decides what they
//     are (REQ-501, REQ-502). This is the one moment the app handles bytes it did not write.
//
//   * Nothing is merged. An import produces a candidate trip and a description of what the
//     format could and could not carry; the user then decides (REQ-505). A deep merge over
//     untrusted structure is how an import silently rewrites fields the user never saw.
//
// Container parse failures arrive as thrown GuardErrors, because that is what the codec does;
// they are caught here, at the boundary, and turned into a sentence for the user.

TP.io = TP.io || {};

TP.io.import = (function () {
  'use strict';

  var MAX_SOURCE_CHARS = TP.container.LIMITS.maxSourceChars;

  // ---- Format detection ----
  //
  // By structural markers, never by filename (REQ-503). A file called trip.json that holds an
  // iCalendar is an iCalendar; the extension is a hint from a filesystem, not evidence.

  function detect(text) {
    if (typeof text !== 'string' || !text.length) return { format: 'unknown', reason: 'The file is empty.' };
    if (text.length > MAX_SOURCE_CHARS) {
      return { format: 'unknown', reason: 'This file is ' + text.length.toLocaleString() +
        ' characters, beyond the ' + MAX_SOURCE_CHARS.toLocaleString() + ' this app will read.' };
    }

    var head = text.slice(0, 8192);

    // A PVD artifact: the data block's id is the marker, and it survives any reformatting of
    // the surrounding HTML.
    if (head.indexOf('id="' + TP.container.BLOCK_ID + '"') !== -1 ||
        head.indexOf("id='" + TP.container.BLOCK_ID + "'") !== -1 ||
        /<!doctype html|<html[\s>]/i.test(head)) {
      var blockText = TP.container.scanBlock(text);
      if (blockText == null) {
        return { format: 'unknown', reason: 'This looks like a web page, but it has no planner data block in it.' };
      }
      return { format: 'artifact', blockText: blockText };
    }

    var t = text.replace(/^\uFEFF/, '').replace(/^[\s\u2028\u2029]+/, '');
    if (t.slice(0, 15).toUpperCase() === 'BEGIN:VCALENDAR') return { format: 'ical' };

    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      var value;
      try {
        // `t`, not `text`: the branch above tests the BOM-stripped string, and `JSON.parse` rejects a
        // leading U+FEFF, so parsing the raw text refused the very file this line just recognised —
        // a trip-data.json written by an editor that adds a BOM (Notepad among them).
        value = TP.container.parseJSONHardened(t, 'file');
      } catch (e) {
        return { format: 'unknown', reason: e && e.message ? e.message : 'The file is not valid JSON.' };
      }
      if (TP.tripdatajson.detect(value)) return { format: 'tripdata', value: value };
      if (value && typeof value === 'object' && value.payload && value.history) {
        return { format: 'unknown', reason: 'This file holds a planner document, but without the page around it there is nothing to show it in. Open the .html file it came from instead.' };
      }
      return { format: 'unknown', reason: 'This is JSON, but it is not trip data and not a planner document.' };
    }

    return { format: 'unknown', reason: 'This file is not a planner document, trip data, or a calendar.' };
  }

  // ---- Reading ----

  function parseText(text, options) {
    var opts = options || {};
    var found = detect(text);
    if (found.format === 'unknown') return { ok: false, reason: found.reason };

    if (found.format === 'artifact') return readArtifact(found.blockText);
    if (found.format === 'ical') return readICal(text, opts);
    if (found.format === 'tripdata') return readTripData(found.value, opts);
    return { ok: false, reason: 'This file could not be read.' };
  }

  function readArtifact(blockText) {
    var container;
    try {
      container = TP.container.parseBlock(blockText);
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : 'The data block could not be read.' };
    }
    // The envelope is validated against the vendored schema FIRST, and by a different function
    // from the one that applies the limits below. `TP.container.validate` bounds size and count;
    // this says whether the shape is a container at all. Two questions, two answers, neither
    // standing in for the other (REQ-516, ADR-0008).
    var shape = TP.validators.check('artifact', container);
    if (!shape.ok) {
      return { ok: false, reason: TP.validators.explain(shape) };
    }
    try {
      container = TP.container.validate(container);
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : 'The data block could not be read.' };
    }
    // Reading is structural: the file is understood, not trusted. The chain is checked where it
    // is acted on — the confirmation dialog and the open — so that one verification decides both
    // what the user is told and what happens next.
    return { ok: true, format: 'artifact', formatId: 'document', container: container };
  }

  function readTripData(value, opts) {
    // An older generation of this same format first (`ADR-0019`). `trip-data.json` carries no version
    // marker, and the shape of a value is the only evidence there is, so the upgrade is a no-op on a
    // file this generation wrote. Doing it BEFORE the validator is the point: the older spellings are
    // not type errors this app should report, they are a different generation of its own format, and a
    // validator that refuses a file the detector accepted has two answers to one question.
    var up = TP.tripdatajson.upgrade(value);
    value = up.value;
    // Validate the STRUCTURE before mapping it. The mapper is tolerant by design — it takes what it
    // can and bags the rest — so it is the wrong place to ask whether a file is well-formed: a
    // mapper asked that question answers with what it managed to salvage. This is the file that
    // says no (REQ-516).
    var shape = TP.validators.check('tripdata', value);
    if (!shape.ok) {
      return { ok: false, reason: TP.validators.explain(shape) };
    }
    var trip;
    try {
      trip = TP.tripdatajson.toTrip(value);
    } catch (e) {
      return { ok: false, reason: 'That trip data could not be read: ' + (e && e.message ? e.message : e) };
    }
    trip = TP.model.normalize(trip, opts.docId);
    return {
      ok: true,
      format: 'tripdata',
      formatId: TP.tripdatajson.ID,
      trip: trip,
      losses: TP.tripdatajson.losses(),
      blocked: [],
      // The user is told when the file was an older generation, because it is the honest answer to
      // "why does this say 1.0.0" if they open the file after exporting it again.
      message: up.from
        ? 'Read as ' + TP.tripdatajson.ID + ', upgraded from generation ' + up.from + ' (' + up.marker + ').'
        : 'Read as ' + TP.tripdatajson.ID + '.',
      upgradedFrom: up.from,
    };
  }

  function readICal(text, opts) {
    // Structural validation first, by a parser that is deliberately NOT the mapper's: a validator
    // that unfolds lines the same way the mapper does agrees with the mapper about a malformed file
    // by making the same mistake (see src/validators/ical.js).
    var shape = TP.validators.check('ical', text);
    if (!shape.ok) {
      return { ok: false, reason: TP.validators.explain(shape) };
    }
    var trip;
    try {
      trip = TP.ical.toTrip(text, opts);
    } catch (e) {
      return { ok: false, reason: 'That calendar could not be read: ' + (e && e.message ? e.message : e) };
    }
    trip = TP.model.normalize(trip, opts.docId);
    return {
      ok: true,
      format: 'ical',
      formatId: TP.ical.ID,
      trip: trip,
      losses: TP.ical.losses(),
      blocked: [],
      message: 'Read as ' + TP.ical.ID + '.',
    };
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { resolve({ ok: false, reason: 'No file was chosen.' }); return; }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('The file could not be read from disk.')); };
      reader.onload = function () {
        var result;
        try {
          result = parseText(String(reader.result));
        } catch (e) {
          result = { ok: false, reason: 'The file could not be read: ' + (e && e.message ? e.message : e) };
        }
        resolve(result);
      };
      // Text only. Never readAsDataURL, never readAsArrayBuffer into a decoder we did not write.
      reader.readAsText(file, 'utf-8');
    });
  }

  // A short, honest description of what came in, for the confirmation step (REQ-505).
  function describe(result) {
    if (!result || !result.ok) return '';
    if (result.format === 'artifact') {
      // What the file IS. The verdict on its history is stated separately, by the dialog that
      // shows this line, so the two cannot end up saying the same thing twice or disagreeing.
      var commits = TP.container.commits(result.container).length;
      return '“' + TP.model.tripTitle(TP.container.payloadTrip(result.container)) +
        '” — a planner document with ' + TP.format.plural(commits, 'commit') + '.';
    }
    var trip = result.trip;
    var days = (trip.days || []).length;
    var itemCount = 0;
    (trip.days || []).forEach(function (d) { itemCount += (d.items || []).length; });
    return TP.model.tripTitle(trip) + ' — ' + days + (days === 1 ? ' day' : ' days') + ', ' +
      itemCount + (itemCount === 1 ? ' item' : ' items') + '.';
  }

  return {
    MAX_SOURCE_CHARS: MAX_SOURCE_CHARS,
    detect: detect,
    parseText: parseText,
    readFile: readFile,
    describe: describe,
  };
})();
