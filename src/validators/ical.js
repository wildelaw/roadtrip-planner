// The iCalendar structural validator (specs/06-interchange.md §7, REQ-516, ADR-0008).
//
// iCalendar is not JSON, so there is no JSON Schema to hand it to. What can be checked structurally
// is checked here against the vendored table in `vendor/icalendar-rfc5545.json`: that components
// nest the way the RFC says, that each component carries the properties it must, that the lines are
// the shape a line has, and that the values of the properties this app reads are the type they claim.
//
// TWO RULES SHAPE THIS FILE.
//
// It is deliberately incomplete, and the incompleteness is stated rather than discovered. Only the
// properties in the vendored table have their values checked; anything else is accepted and passed
// through (the model keeps unmodelled properties as a bag, REQ-207), because a calendar from the
// wider world is not malformed just for being unfamiliar. `NOT CHECKED` in the code below is the
// list of things this validator does not claim.
//
// It does not share a parser with the mapper. A validator that unfolds lines with the same function
// the mapper does is testing that function, not the file: the two would agree about a malformed file
// by making the same mistake. The unfolding here is a separate, simpler implementation whose only
// job is to decide whether the file is a calendar at all — and the mapper can then be as tolerant as
// it likes, because something stricter has already said yes.

TP.validators.ical = (function () {
  'use strict';

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  // ---- Logical lines ----
  //
  // RFC 5545 §3.1. A physical line longer than 75 octets is folded, and continues on the next line
  // which begins with a single space or tab. Unfolding is a loop over the input, and a loop fed
  // hostile input is a hang — which is why the property count is bounded before it starts (REQ-517).

  function logicalLines(text, limits) {
    var raw = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i];
      if (line === '' && i === raw.length - 1) continue;   // the trailing newline
      if (line.charAt(0) === ' ' || line.charAt(0) === '\t') {
        if (!out.length) {
          return { error: 'The file begins with a folded continuation line, which has nothing to continue.' };
        }
        out[out.length - 1].text += line.slice(1);
        out[out.length - 1].folded++;
        continue;
      }
      out.push({ text: line, number: i + 1, folded: 0 });
      if (out.length > limits.maxPropertyCount) {
        return { error: 'This calendar has more than ' + limits.maxPropertyCount.toLocaleString() +
          ' lines, beyond what this app will read.' };
      }
    }
    return { lines: out };
  }

  // NAME(;PARAM=VAL)*:VALUE, where a parameter value may be quoted and may contain the delimiter.
  // The split is done by scanning rather than by a single regex, because a regex that handles quoted
  // values containing `:` and `;` is a regex nobody can check by reading it.
  function parseLine(text) {
    var inQuotes = false;
    var nameEnd = -1;
    var colon = -1;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (c === '"') { inQuotes = !inQuotes; continue; }
      if (inQuotes) continue;
      if (c === ':' && colon === -1) { colon = i; break; }
    }
    if (colon === -1) return { error: 'has no colon, so it is not a property line' };

    var head = text.slice(0, colon);
    var value = text.slice(colon + 1);
    var semi = -1;
    inQuotes = false;
    for (var j = 0; j < head.length; j++) {
      var h = head.charAt(j);
      if (h === '"') { inQuotes = !inQuotes; continue; }
      if (h === ';' && !inQuotes) { semi = j; break; }
    }
    var name = (semi === -1 ? head : head.slice(0, semi)).toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(name)) {
      return { error: 'starts with ' + JSON.stringify(head.split(':')[0].slice(0, 20)) + ', which is not a property name' };
    }

    var params = {};
    if (semi !== -1) {
      var rest = head.slice(semi + 1);
      var parts = [];
      var buf = '';
      inQuotes = false;
      for (var k = 0; k < rest.length; k++) {
        var r = rest.charAt(k);
        if (r === '"') { inQuotes = !inQuotes; buf += r; continue; }
        if (r === ';' && !inQuotes) { parts.push(buf); buf = ''; continue; }
        buf += r;
      }
      parts.push(buf);
      for (var p = 0; p < parts.length; p++) {
        var eq = parts[p].indexOf('=');
        if (eq === -1) continue;
        var pname = parts[p].slice(0, eq).toUpperCase();
        var pvalue = parts[p].slice(eq + 1);
        if (pvalue.length > 1 && pvalue.charAt(0) === '"' && pvalue.charAt(pvalue.length - 1) === '"') {
          pvalue = pvalue.slice(1, -1);
        }
        params[pname] = pvalue;
      }
    }

    return { name: name, params: params, value: value };
  }

  // ---- Value types ----
  //
  // NOT CHECKED, and said so: TEXT escaping, RECUR, PERIOD, BINARY, URI form beyond "has a scheme",
  // and every parameter other than VALUE. A calendar that gets one of those wrong is still readable,
  // and rejecting it would be this validator inventing a rule the RFC does not state as a limit.

  var VALUE_CHECKS = {
    DATE: function (v) { return /^\d{8}$/.test(v) ? null : 'should be a date in the form YYYYMMDD'; },
    'DATE-TIME': function (v) {
      return /^\d{8}T\d{6}Z?$/.test(v) ? null : 'should be a date and time in the form YYYYMMDDTHHMMSS';
    },
    'DATE-TIME-OR-DATE': function (v) {
      if (/^\d{8}$/.test(v) || /^\d{8}T\d{6}Z?$/.test(v)) return null;
      return 'should be a date (YYYYMMDD) or a date and time (YYYYMMDDTHHMMSS)';
    },
    INTEGER: function (v) { return /^[+-]?\d+$/.test(v) ? null : 'should be a whole number'; },
    DURATION: function (v) {
      if (!/^[+-]?P(?!$)/.test(v)) return 'should be a duration beginning with P';
      if (!/^[+-]?P(\d+W|\d+D)?(T(\d+H|\d+M|\d+S|(\d+H\d+M|\d+H\d+S|\d+M\d+S|\d+H\d+M\d+S)))?$/.test(v) ||
          /^[+-]?P$/.test(v) || /^[+-]?PT$/.test(v)) {
        return 'should be a duration in the form PnDTnHnMnS';
      }
      return null;
    },
    'UTC-OFFSET': function (v) { return /^[+-]\d{4}(\d{2})?$/.test(v) ? null : 'should be an offset in the form +HHMM'; },
    BOOLEAN: function (v) { return /^(TRUE|FALSE)$/i.test(v) ? null : 'should be TRUE or FALSE'; },
    FLOAT: function (v) { return /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(v) ? null : 'should be a number'; },
    'FLOAT-PAIR': function (v) { return /^[+-]?(\d+(\.\d+)?|\.\d+);[+-]?(\d+(\.\d+)?|\.\d+)$/.test(v) ? null : 'should be two numbers separated by a semicolon'; },
    'CAL-ADDRESS': function (v) { return /^[a-z][a-z0-9+.-]*:/i.test(v) ? null : 'should be an address with a scheme, such as mailto:someone@example.com'; },
    URI: function (v) { return /^[a-z][a-z0-9+.-]*:/i.test(v) ? null : 'should be a URI'; },
  };

  // The properties the RFC writes as a comma-separated list. The split is NOT applied to every
  // typed property, which is what this once did: a URI may legitimately contain a comma — a map link
  // reads `…/maps?q=35.0,135.0` — and splitting it checked the fragments instead of the URL and
  // refused a calendar `TP.ical.toTrip` reads without complaint. A file the mapper accepts and the
  // validator rejects is exactly the disagreement 06-interchange.md §2 forbids.
  var LIST_PROPERTIES = { CATEGORIES: 1, RESOURCES: 1, RDATE: 1, EXDATE: 1, FREEBUSY: 1 };

  function checkValue(propertyName, line, type, where, path, problems) {
    // An explicit VALUE= parameter overrides the table: that is what the parameter IS for, and a
    // TRIGGER carrying an absolute date is the case where ignoring it rejects a valid file.
    var declared = String(line.params.VALUE || '').toUpperCase();
    if (declared && declared !== 'TEXT') type = declared;
    var check = VALUE_CHECKS[type];
    if (!check) return;   // TEXT, RECUR, PERIOD, BINARY and the rest: not checked, deliberately
    if (LIST_PROPERTIES[propertyName]) {
      // A multi-valued property carries a list; each part is checked on its own, and an empty part
      // is the RFC's way of writing an empty text value, not a broken number.
      var parts = line.value.split(',');
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] === '') continue;
        var why = check(parts[i]);
        if (why) problems.push({ path: path, keyword: 'value', message: propertyName + ' in ' + where + ' ' + why + ' (it reads ' + JSON.stringify(parts[i]) + ')' });
      }
      return;
    }
    var reason = check(line.value);
    if (reason) {
      problems.push({ path: path, keyword: 'value', message: propertyName + ' in ' + where + ' ' + reason + ' (it reads ' + JSON.stringify(line.value) + ')' });
    }
  }

  // ---- The structural walk ----

  function validate(text, options) {
    var table = TP.schemas.icalendar;
    var limits = table.limits;
    var components = table.components;
    var problems = [];

    function fail(path, keyword, message) { problems.push({ path: path, keyword: keyword, message: message }); }

    var unfolded = logicalLines(text, limits);
    if (unfolded.error) {
      return { ok: false, problems: [{ path: '', keyword: 'lines', message: unfolded.error }] };
    }
    var lines = unfolded.lines;
    if (!lines.length) return { ok: false, problems: [{ path: '', keyword: 'empty', message: 'The file is empty.' }] };

    // The stack of open components. A component is a name, the properties seen on it, and the name
    // of the component it sits inside — which is what makes the nesting check a stack and not a
    // separate parse.
    var stack = [];
    var rootSeen = false;
    var depthLimit = limits.maxComponentDepth;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var parsed = parseLine(line.text);
      if (parsed.error) {
        fail('line ' + line.number, 'line', 'Line ' + line.number + ' ' + parsed.error + '.');
        // One unreadable line is not a reason to abandon the file: the structural checks below are
        // still worth making, and the caller reports all of them together.
        continue;
      }

      if (parsed.name === 'BEGIN') {
        var opening = parsed.value.toUpperCase();
        if (!components[opening]) {
          fail('line ' + line.number, 'component', 'The file opens a ' + opening + ' component, which is not one this app knows how to read.');
          stack.push({ unknown: true, name: opening, line: line.number });
          continue;
        }
        if (stack.length >= depthLimit) {
          fail('line ' + line.number, 'depth', 'The components nest more than ' + depthLimit + ' deep, beyond what this app will read.');
          stack.push({ unknown: true, name: opening, line: line.number });
          continue;
        }
        if (!stack.length) {
          if (rootSeen) fail('line ' + line.number, 'root', 'The file has a second ' + opening + ' at the top level; a calendar file holds one.');
          if (opening !== table.root) {
            fail('line ' + line.number, 'root', 'The file begins with ' + opening + ' rather than ' + table.root + ', so it is not a calendar.');
          }
          rootSeen = true;
        } else {
          var parent = stack[stack.length - 1];
          if (!parent.unknown) {
            var allowed = components[parent.name].contains || [];
            if (allowed.indexOf(opening) === -1) {
              fail('line ' + line.number, 'nesting', 'A ' + opening + ' cannot appear inside a ' + parent.name +
                (allowed.length ? '; the RFC allows ' + allowed.join(', ') + ' there' : '; it holds no other components') + '.');
            }
          }
        }
        stack.push({ name: opening, line: line.number, props: Object.create(null), propsList: [], unknown: false });
        continue;
      }

      if (parsed.name === 'END') {
        var closing = parsed.value.toUpperCase();
        if (!stack.length) {
          fail('line ' + line.number, 'nesting', 'Line ' + line.number + ' closes ' + closing + ', but no component is open.');
          continue;
        }
        var open = stack[stack.length - 1];
        if (open.name !== closing) {
          fail('line ' + line.number, 'nesting', 'Line ' + line.number + ' closes ' + closing + ', but the open component is ' + open.name + '.');
          // Recover at the closed name if it is somewhere on the stack, so one bad END does not
          // cascade into a report about every component after it.
          for (var s = stack.length - 2; s >= 0; s--) {
            if (stack[s].name === closing) { stack.length = s; open = null; break; }
          }
          if (open) { stack.pop(); continue; }
          continue;
        }
        stack.pop();
        if (!open.unknown) finishComponent(open, components, problems);
        continue;
      }

      // A property line.
      if (!stack.length) {
        fail('line ' + line.number, 'line', 'Line ' + line.number + ' is a property outside any component, so there is nothing for it to describe.');
        continue;
      }
      var current = stack[stack.length - 1];
      if (current.unknown) continue;
      current.propsList.push({ line: line, parsed: parsed });
      current.props[parsed.name] = true;
    }

    // Unclosed components. This is the case a truncating read produces, and naming it is the
    // difference between "this file is corrupt" and "the app found nothing and said nothing".
    while (stack.length) {
      var unclosed = stack.pop();
      fail('line ' + unclosed.line, 'unclosed', 'The ' + unclosed.name + ' opened on line ' + unclosed.line + ' is never closed.');
    }

    if (!rootSeen) {
      fail('', 'root', 'The file contains no ' + table.root + ' component, so it is not a calendar.');
    }

    return { ok: problems.length === 0, problems: problems };
  }

  // Required properties, and the two relations the RFC states as relations rather than tables.
  function finishComponent(open, components, problems) {
    var spec = components[open.name];
    var where = 'the ' + open.name + ' on line ' + open.line;

    for (var r = 0; r < spec.required.length; r++) {
      var req = spec.required[r];
      if (open.props[req]) continue;
      // The one exception the vendored table documents: a VEVENT in an object with no METHOD may
      // omit DTSTART in a calendar that describes a task rather than a time. This app's own files
      // always carry it, so the check is applied and the exception is not: an import that refuses a
      // file whose events have no times would refuse the very thing it is for.
      problems.push({
        path: open.name, keyword: 'required',
        message: where + ' has no ' + req + ' property, which an iCalendar ' + open.name + ' must have',
      });
    }

    // DTEND and DURATION are mutually exclusive (RFC 5545 §3.6.1). A relation, so it is code.
    if (open.name === 'VEVENT' && open.props.DTEND && open.props.DURATION) {
      problems.push({
        path: open.name, keyword: 'exclusive',
        message: where + ' has both DTEND and DURATION; an event states its length one way or the other, not both',
      });
    }

    // Value types, for the properties the vendored table names.
    var declared = spec.properties || {};
    for (var p = 0; p < open.propsList.length; p++) {
      var entry = open.propsList[p];
      var name = entry.parsed.name;
      if (!declared[name]) continue;   // unmodelled: kept as a bag, not interpreted (REQ-207)
      if (name === 'DTEND' && open.props.DURATION) continue;   // already reported; the value adds noise
      checkValue(name, entry.parsed, declared[name], where, open.name, problems);
    }
  }

  // ---- The entry point ----

  // `text` is the raw file. The result has the same shape as `TP.validators.schema.validate`, so a
  // caller does not have to know which format it validated.
  function validateText(text) {
    if (typeof text !== 'string' || !text.length) {
      return { ok: false, problems: [{ path: '', keyword: 'empty', message: 'The file is empty.' }] };
    }
    // The root is checked here as well as in `detect`, because this function is also called on text
    // that did not come from the import path — an AI answer, or a fixture in a test. A byte-order
    // mark and any leading whitespace are skipped; `\s` covers the two Unicode line terminators as
    // well, so a file saved with them is still recognised rather than reported as "not a calendar".
    var head = text;
    var bom = String.fromCharCode(0xFEFF);
    while (head.length && (head.charAt(0) === bom || /\s/.test(head.charAt(0)))) head = head.slice(1);
    if (head.slice(0, 15).toUpperCase() !== 'BEGIN:VCALENDAR') {
      return { ok: false, problems: [{ path: '', keyword: 'root', message: 'This is not a calendar: it does not begin with BEGIN:VCALENDAR.' }] };
    }
    return validate(text);
  }

  return {
    validate: validate,
    validateText: validateText,
    logicalLines: logicalLines,
    parseLine: parseLine,
    VALUE_CHECKS: VALUE_CHECKS,
  };
})();
