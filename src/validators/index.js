// The validator seam (specs/06-interchange.md §7, REQ-516, REQ-517, REQ-518).
//
// One entry point, three formats, one result shape. A caller — the import path, the AI panel — asks
// "is this well-formed for the format it claims to be?", and gets back the same structure either
// way. It does not have to know that one format is validated against a JSON Schema and the other by
// a hand-written structural walk.
//
// WHY THIS IS NOT THE MAPPER. The mappers are deliberately tolerant: they take what they can and put
// the rest in a bag (REQ-205–REQ-207). If the same code also decided whether a file was acceptable,
// there would be no answer to "what is a malformed file?" other than "one the mapper could not
// salvage" — and a mapper is written to salvage. So this runs FIRST, says yes or no, and the mapper
// then works on files that have already been told apart from their neighbours.

TP.validators = TP.validators || {};

TP.validators.index = (function () {
  'use strict';

  // The formats an import can produce. `artifact` is validated as its envelope: the payload inside
  // is the trip model, whose shape is checked by the model's own normaliser (`TP.model.normalize`)
  // and whose history is checked by chain verification (04-versioning.md §5). Validating the trip
  // model here as well would be a second, divergent answer to a question already answered.
  var FORMATS = ['artifact', 'tripdata', 'ical'];

  function problemList(result) {
    return (result && result.problems) || [];
  }

  // Validate whatever `input` is, for the format named.
  //
  //   check('tripdata', parsedJson)
  //   check('artifact', containerObject)
  //   check('ical', rawText)
  //
  // Anything else returns a refusal rather than throwing, because every caller is a boundary that
  // has to say something to a person.
  function check(format, input) {
    if (FORMATS.indexOf(format) === -1) {
      return {
        ok: false, format: format,
        problems: [{ path: '', keyword: 'format', message: 'There is no validator for ' + JSON.stringify(String(format)) + '.' }],
      };
    }

    if (format === 'ical') {
      var ical = TP.validators.ical.validateText(input);
      return { ok: ical.ok, format: format, problems: ical.problems };
    }

    if (format === 'artifact') {
      var env = TP.validators.schema.validate(TP.schemas.container, input);
      return { ok: env.ok, format: format, problems: env.problems };
    }

    var wire = TP.validators.schema.validate(TP.schemas.tripData, input);
    return { ok: wire.ok, format: format, problems: wire.problems };
  }

  // One sentence for the user (REQ-518: a guard failure explains itself). It names the format, says
  // how many problems there are, and quotes the first few — with the path, because "the third item
  // on the second day has no title" is actionable and "the file is invalid" is not.
  function explain(result, options) {
    var opts = options || {};
    var limit = opts.limit || 3;
    var problems = problemList(result);
    if (!problems.length) return '';

    var kind = result.format === 'ical' ? 'calendar' : result.format === 'tripdata' ? 'trip data'
      : result.format === 'artifact' ? 'planner document' : 'file';
    var lead = 'This ' + kind + ' has ' + problems.length +
      (problems.length === 1 ? ' problem that this app will not accept: ' : ' problems that this app will not accept: ');

    var named = problems.slice(0, limit).map(function (p) {
      return p.path ? p.path + ' — ' + p.message : p.message;
    });
    var rest = problems.length > limit
      ? ' (and ' + (problems.length - limit) + ' more)' : '';
    return lead + named.join(' ') + rest;
  }

  // Everything a schema-driven format refuses, stated as a list of (path, message) — for a test that
  // wants to assert on a specific failure, and for a dialog that wants to show them all.
  function problems(result) {
    return problemList(result).map(function (p) { return { path: p.path, keyword: p.keyword, message: p.message }; });
  }

  return {
    FORMATS: FORMATS,
    check: check,
    explain: explain,
    problems: problems,
  };
})();

// The seam itself, lifted onto the namespace: `TP.validators.check(format, input)` is what the
// import path and the AI panel call, and what a reader should find first. `index` stays reachable
// for the static checks, which want to assert on the whole module rather than one entry point.
TP.validators.check = TP.validators.index.check;
TP.validators.explain = TP.validators.index.explain;
TP.validators.problems = TP.validators.index.problems;
