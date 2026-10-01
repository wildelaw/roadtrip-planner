// The JSON Schema subset validator (specs/06-interchange.md §7, REQ-516, ADR-0008).
//
// ADR-0008 names the force honestly: "a subtly wrong validator is worse than none, because it gives
// confident wrong answers". The way to have a small validator without that failure is to make its
// incompleteness MECHANICAL rather than a matter of care:
//
//   * `SUPPORTED` is an explicit list, and `unsupportedKeywords()` reports anything in a schema
//     that is not on it. The test suite fails if a vendored schema uses an unimplemented keyword,
//     so a schema cannot come to rely on a check that never runs. That is the whole defence:
//     silently ignoring `format` or `if/then` is exactly how a validator becomes confidently wrong.
//
//   * No `format`. Format assertions are the most commonly-ignored keyword in the ecosystem and
//     the easiest to believe in. `pattern` is here instead, and it is checked.
//
// The validator is used on the two vendored JSON Schemas — the trip-data wire and the PVD envelope
// — and on nothing else. It is not a general-purpose implementation and does not claim to be.

TP.validators = TP.validators || {};

TP.validators.schema = (function () {
  'use strict';

  // Keywords that assert something and are implemented below.
  var SUPPORTED = [
    'type', 'required', 'properties', 'additionalProperties', 'items',
    'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties',
    'enum', 'const', 'pattern', 'minLength', 'maxLength',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'anyOf', 'oneOf', 'allOf', 'not', '$ref', '$defs', 'definitions',
  ];

  // Keywords that carry no assertion and are safe to pass over: documentation, and the
  // identifiers that tell a reader where the schema came from.
  var ANNOTATIONS = [
    '$schema', '$id', 'id', 'title', 'description', 'default', 'examples',
    '$comment', 'deprecated', 'readOnly', 'writeOnly',
  ];

  var MAX_DEPTH = 24;

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  // ---- The incompleteness check ----
  //
  // Every keyword anywhere in the schema, minus the two lists. A non-empty result means the schema
  // is asking for a check this validator will not perform — so the schema and the validator
  // disagree, and the caller must be told rather than trusted.

  function unsupportedKeywords(schema) {
    var found = [];
    var seen = [];

    function visit(node, path, depth) {
      if (depth > MAX_DEPTH || !node) return;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) visit(node[i], path + '[' + i + ']', depth + 1);
        return;
      }
      if (!isObject(node)) return;
      // A property NAMED like a keyword is a name, not a keyword: `{"properties": {"type": {...}}}`
      // declares a field called `type`. Only the schema's own keys are keywords.
      for (var k in node) {
        if (!has(node, k)) continue;
        var here = path ? path + '.' + k : k;
        if (k === 'properties' || k === '$defs' || k === 'definitions') {
          var map = node[k];
          for (var name in map) {
            if (has(map, name)) visit(map[name], here + '.' + name, depth + 1);
          }
          continue;
        }
        if (SUPPORTED.indexOf(k) === -1 && ANNOTATIONS.indexOf(k) === -1) {
          if (seen.indexOf(k) === -1) { seen.push(k); found.push({ keyword: k, at: here }); }
        }
        visit(node[k], here, depth + 1);
      }
    }

    visit(schema, '', 0);
    return found;
  }

  // ---- $ref ----
  //
  // Only the three forms the vendored schemas use. A ref this validator cannot follow is an error,
  // never a skip: a skipped ref is a whole branch of the schema that silently does not apply.

  function resolveRef(root, ref) {
    var m = /^#\/(\$defs|definitions)\/(.+)$/.exec(ref);
    if (m) {
      var section = root[m[1]];
      var target = section && section[m[2]];
      if (!target) throw new Error('the schema references #/' + m[1] + '/' + m[2] + ', which it does not define');
      return target;
    }
    if (ref === '#') return root;
    throw new Error('the schema references ' + JSON.stringify(ref) +
      ', which this validator does not follow (it follows #/$defs/name, #/definitions/name and #)');
  }

  // ---- The assertion set ----

  function typeOf(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    return typeof value;   // string, boolean, object
  }

  function matchesType(value, wanted) {
    var actual = typeOf(value);
    if (wanted === 'number') return actual === 'number' || actual === 'integer';
    return actual === wanted;
  }

  function typeName(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'nothing';
    if (Array.isArray(value)) return 'a list';
    if (typeof value === 'string') return 'a string';
    if (typeof value === 'number') return 'a number';
    if (typeof value === 'boolean') return Number.isNaN(value) ? 'a number' : 'true or false';
    return 'an object';
  }

  function describe(value) {
    if (typeof value === 'string') return JSON.stringify(value.length > 40 ? value.slice(0, 40) + '…' : value);
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'a list of ' + value.length;
    if (typeof value === 'object') return 'an object';
    return String(value);
  }

  // One node of the value against one node of the schema. Problems are pushed, not thrown, so a
  // caller can report ALL of them: an import that names one failure at a time is an import the user
  // fights one round at a time.
  function check(root, schema, value, path, problems, depth) {
    if (depth > MAX_DEPTH) {
      problems.push({ path: path, keyword: 'depth', message: 'the value nests deeper than ' + MAX_DEPTH + ' levels, which this app will not walk' });
      return;
    }
    // JSON HAS NO `undefined`. A property whose value is `undefined` is ABSENT to every other part of
    // this app: `JSON.stringify` drops the key, and `TP.canonical.serialize` sorts and stringifies, so
    // `{a: undefined}` and `{}` are the same document to the payload hash and the same bytes in a
    // file. A validator that disagreed would be STRICTER THAN THE APP THAT WRITES THE FILE, which is
    // the worst version of this module's failure mode: it would refuse a document this app exported,
    // over a key that is not in the document. Found by the corpus — `history.append` sets `docId` from
    // `meta.docId`, which is `undefined` when the caller does not supply one.
    if (value === undefined) return;
    if (schema === true || schema === undefined) return;
    if (schema === false) {
      problems.push({ path: path, keyword: 'false', message: 'nothing is allowed here' });
      return;
    }
    if (!isObject(schema)) return;

    var where = path || 'the document';

    if (has(schema, '$ref')) {
      check(root, resolveRef(root, schema.$ref), value, path, problems, depth + 1);
      return;
    }

    function fail(keyword, message) { problems.push({ path: path, keyword: keyword, message: message }); }

    // -- const / enum --
    if (has(schema, 'const') && !same(schema.const, value)) {
      fail('const', where + ' must be ' + describe(schema.const) + ', but it is ' + describe(value));
    }
    if (schema.enum && schema.enum.length && !schema.enum.some(function (e) { return same(e, value); })) {
      fail('enum', where + ' is ' + describe(value) + ', which is not one of ' + schema.enum.join(', '));
    }

    // -- type --
    if (has(schema, 'type')) {
      var wanted = Array.isArray(schema.type) ? schema.type : [schema.type];
      var ok = wanted.some(function (t) { return matchesType(value, t); });
      if (!ok) {
        fail('type', where + ' should be ' + (wanted.length > 1 ? wanted.join(' or ') : wanted[0]) +
          ', but it is ' + typeName(value));
        return;   // the keywords below all assume the type; reporting them too is noise
      }
    }

    // -- strings --
    if (typeof value === 'string') {
      if (has(schema, 'minLength') && value.length < schema.minLength) {
        fail('minLength', where + ' is ' + value.length + ' characters, shorter than the ' + schema.minLength + ' required');
      }
      if (has(schema, 'maxLength') && value.length > schema.maxLength) {
        fail('maxLength', where + ' is ' + value.length + ' characters, longer than the ' + schema.maxLength + ' allowed');
      }
      if (has(schema, 'pattern') && !new RegExp(schema.pattern).test(value)) {
        fail('pattern', where + ' is ' + describe(value) + ', which does not match ' + schema.pattern);
      }
    }

    // -- numbers --
    if (typeof value === 'number' && isFinite(value)) {
      if (has(schema, 'minimum') && value < schema.minimum) fail('minimum', where + ' is ' + value + ', below the minimum of ' + schema.minimum);
      if (has(schema, 'maximum') && value > schema.maximum) fail('maximum', where + ' is ' + value + ', above the maximum of ' + schema.maximum);
      if (has(schema, 'exclusiveMinimum') && value <= schema.exclusiveMinimum) fail('exclusiveMinimum', where + ' is ' + value + ', which must be above ' + schema.exclusiveMinimum);
      if (has(schema, 'exclusiveMaximum') && value >= schema.exclusiveMaximum) fail('exclusiveMaximum', where + ' is ' + value + ', which must be below ' + schema.exclusiveMaximum);
      if (has(schema, 'multipleOf') && schema.multipleOf > 0 && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-9) {
        fail('multipleOf', where + ' is ' + value + ', which is not a multiple of ' + schema.multipleOf);
      }
    }

    // -- lists --
    if (Array.isArray(value)) {
      if (has(schema, 'minItems') && value.length < schema.minItems) fail('minItems', where + ' has ' + value.length + ' entries, fewer than the ' + schema.minItems + ' required');
      if (has(schema, 'maxItems') && value.length > schema.maxItems) fail('maxItems', where + ' has ' + value.length + ' entries, more than the ' + schema.maxItems + ' allowed');
      if (schema.uniqueItems) {
        var seenItems = value.map(function (v) { return JSON.stringify(v); });
        for (var u = 0; u < seenItems.length; u++) {
          if (seenItems.indexOf(seenItems[u]) !== u) { fail('uniqueItems', where + ' repeats an entry (' + describe(value[u]) + ')'); break; }
        }
      }
      if (schema.items && isObject(schema.items)) {
        for (var i = 0; i < value.length; i++) check(root, schema.items, value[i], path + '[' + i + ']', problems, depth + 1);
      }
    }

    // -- objects --
    if (isObject(value)) {
      // The fields that are there, where "there" means the word JSON means by it: a key whose value is
      // `undefined` is not a field. The same rule as the guard at the top of this function, applied to
      // counting and to presence so the three agree.
      var keys = Object.keys(value).filter(function (k) { return value[k] !== undefined; });
      if (has(schema, 'minProperties') && keys.length < schema.minProperties) fail('minProperties', where + ' has ' + keys.length + ' fields, fewer than the ' + schema.minProperties + ' required');
      if (has(schema, 'maxProperties') && keys.length > schema.maxProperties) fail('maxProperties', where + ' has ' + keys.length + ' fields, more than the ' + schema.maxProperties + ' allowed');

      if (schema.required) {
        for (var r = 0; r < schema.required.length; r++) {
          if (!has(value, schema.required[r]) || value[schema.required[r]] === undefined) {
            fail('required', where + ' has no ' + schema.required[r] + ' field, which this format requires');
          }
        }
      }
      var declared = schema.properties || {};
      for (var p = 0; p < keys.length; p++) {
        var key = keys[p];
        var child = path ? path + '.' + key : key;
        // A field named `__proto__` has no own-property presence in a plain object literal but does
        // in JSON.parse output; `has` handles both, and the walk below never writes.
        if (has(declared, key)) {
          check(root, declared[key], value[key], child, problems, depth + 1);
        } else if (schema.additionalProperties === false) {
          fail('additionalProperties', where + ' has a ' + key + ' field, which this format does not define');
        } else if (isObject(schema.additionalProperties)) {
          check(root, schema.additionalProperties, value[key], child, problems, depth + 1);
        }
      }
    }

    // -- combinators --
    if (schema.allOf) {
      for (var a = 0; a < schema.allOf.length; a++) check(root, schema.allOf[a], value, path, problems, depth + 1);
    }
    if (schema.anyOf) {
      var anyOk = false;
      for (var y = 0; y < schema.anyOf.length && !anyOk; y++) {
        if (holds(root, schema.anyOf[y], value, depth + 1)) anyOk = true;
      }
      if (!anyOk) fail('anyOf', where + ' is ' + describe(value) + ', which matches none of the forms this format allows');
    }
    if (schema.oneOf) {
      var matched = 0;
      for (var o = 0; o < schema.oneOf.length; o++) {
        if (holds(root, schema.oneOf[o], value, depth + 1)) matched++;
      }
      if (matched === 0) {
        fail('oneOf', where + ' is ' + describe(value) + ', which matches none of the forms this format allows');
      } else if (matched > 1) {
        // Ambiguity is a defect in the schema, not in the file, and it is worth saying so rather
        // than picking one branch.
        fail('oneOf', where + ' matches ' + matched + ' of the forms this format allows, so the schema is ambiguous here');
      }
    }
    if (schema.not && holds(root, schema.not, value, depth + 1)) {
      fail('not', where + ' matches a form the schema forbids');
    }
  }

  // Does the value satisfy this schema, ignoring the problems? Used by the combinators, which need
  // a yes/no rather than a report.
  function holds(root, schema, value, depth) {
    var problems = [];
    check(root, schema, value, '', problems, depth || 0);
    return problems.length === 0;
  }

  // Identity for `const`/`enum`, by canonical serialization: `1` and `1.0` are the same number and
  // a key order is not a value (P1, REQ-305).
  function same(a, b) {
    return TP.canonical.serialize(a) === TP.canonical.serialize(b);
  }

  // ---- The entry point ----

  // Validate `value` against `schema`. Returns every problem, not the first: an import that names
  // one failure at a time is one the user fights one round at a time.
  function validate(schema, value, options) {
    var opts = options || {};
    var root = opts.root || schema;
    var problems = [];
    // A schema that asks for checks this validator does not perform is reported as a problem in
    // its own right. Silently validating a subset is the failure ADR-0008 exists to prevent.
    var gaps = unsupportedKeywords(schema);
    if (gaps.length) {
      problems.push({
        path: '', keyword: 'unsupported',
        message: 'the schema uses ' + gaps.map(function (g) { return g.keyword; }).join(', ') +
          ', which this validator does not implement — it will not silently pretend to check ' +
          (gaps.length === 1 ? 'it' : 'them'),
      });
    }
    check(root, schema, value, '', problems, 0);
    return { ok: problems.length === 0, problems: problems };
  }

  // The problems as one sentence for a dialog (REQ-518: a guard failure explains itself). The first
  // three, then a count — a file with two hundred problems needs a summary, not a wall.
  function explain(result, limit) {
    var max = limit || 3;
    var lines = result.problems.slice(0, max).map(function (p) { return p.message; });
    if (result.problems.length > max) {
      lines.push('and ' + (result.problems.length - max) + ' more like ' + (result.problems.length - max === 1 ? 'it' : 'them') + '.');
    }
    return lines.join(' ');
  }

  return {
    SUPPORTED: SUPPORTED,
    ANNOTATIONS: ANNOTATIONS,
    MAX_DEPTH: MAX_DEPTH,
    validate: validate,
    holds: holds,
    explain: explain,
    unsupportedKeywords: unsupportedKeywords,
    resolveRef: resolveRef,
    typeOf: typeOf,
  };
})();
