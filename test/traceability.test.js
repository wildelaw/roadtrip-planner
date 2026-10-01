// The traceability check (specs/09-testing.md §7, REQ-801).
//
// `specs/01-requirements.md` is the source of truth for this instance, and its table is written in a
// fixed shape on purpose: the check parses it rather than parsing prose. A requirement added later
// with no citation, no verification method, or a duplicate id fails here rather than at review, which
// is the whole point of making it mechanical.
//
// Each assertion below corresponds to one row of §7's table, and each is a function returning its
// complaints rather than an inline `ok()`. That is deliberate: the last test in the file feeds every
// one of them a deliberately broken document and requires a complaint from each. A traceability check
// that cannot fail is the most convincing kind of false comfort, because its whole job is to be the
// thing that notices.

'use strict';

var fs = require('fs');
var path = require('path');

var h = require('./harness.js');

var REQUIREMENTS = path.join('specs', '01-requirements.md');
var PATTERN = 'PATTERN.md';

// The declared verification methods, read from the document rather than repeated here. A list copied
// into the test is a list that will disagree with the document it is checking.
function declaredMethods(text) {
  var section = /Verification codes:\s*\n([\s\S]*?)(?:\n---|\n## )/.exec(text);
  if (!section) throw new Error('01-requirements.md has no "Verification codes" table to read');
  var methods = [];
  section[1].split('\n').forEach(function (line) {
    var m = /^\|\s*`([a-z]+)`\s*\|/.exec(line);
    if (m && methods.indexOf(m[1]) === -1) methods.push(m[1]);
  });
  if (!methods.length) throw new Error('the "Verification codes" table declares no methods');
  return methods;
}

// The requirement tables: the numbered sections only.
//
// The document also carries a "Present-state gaps, measured" table whose rows begin with REQ ids.
// Counting those as declarations reports twelve duplicates that do not exist — which is how a real
// duplicate would come to be ignored.
function requirementRows(text) {
  var rows = [];
  var sections = text.split(/\n## /);
  sections.forEach(function (section) {
    var heading = section.split('\n')[0];
    var head = /^(\d+)\.\s/.exec(heading);
    if (!head) return;
    var group = Number(head[1]);
    var tableMatch = /`(REQ-(\d)xx)`/.exec(heading);
    section.split('\n').forEach(function (line) {
      var m = /^\|\s*`(REQ-(\d+))`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/.exec(line);
      if (!m) return;
      rows.push({
        id: m[1],
        number: m[2],
        group: group,
        headingGroup: tableMatch ? Number(tableMatch[2]) : null,
        text: m[3].trim(),
        source: m[4].trim(),
        method: m[5].trim().replace(/`/g, ''),
      });
    });
  });
  return rows;
}

function specFiles() {
  var files = [];
  fs.readdirSync(path.join(h.ROOT, 'specs')).forEach(function (f) {
    files.push(path.join('specs', f));
  });
  var decisions = path.join(h.ROOT, 'decisions');
  if (fs.existsSync(decisions)) {
    fs.readdirSync(decisions).forEach(function (f) { files.push(path.join('decisions', f)); });
  }
  if (fs.existsSync(path.join(h.ROOT, PATTERN))) files.push(PATTERN);
  return files;
}

function load() {
  var text = h.read(REQUIREMENTS);
  return {
    file: REQUIREMENTS,
    text: text,
    rows: requirementRows(text),
    methods: declaredMethods(text),
    others: specFiles()
      .filter(function (f) { return f !== REQUIREMENTS; })
      .map(function (f) { return { file: f, text: h.read(f) }; }),
    pattern: h.read(PATTERN),
  };
}

// The traceability table's two pattern columns. The ids are written as bare numbers there ("01, 08")
// because the table is grouped by prefix, so the check has to read numbers and reassemble the id.
function traceabilityTable(text) {
  // The section ends at the next `###` as well as the next `##`: the present-state table that follows
  // it is a different table, and reading it as traceability would count requirements the group table
  // never names.
  var section = /## Traceability\b([\s\S]*?)(?=\n## |\n### )/.exec(text);
  if (!section) throw new Error('01-requirements.md has no "Traceability" section');
  var found = { inv: [], dec: [] };
  section[1].split('\n').forEach(function (line) {
    var m = /^\|\s*`REQ-\w+`\s*\|([^|]*)\|([^|]*)\|/.exec(line);
    if (!m) return;
    (m[1].match(/\d{2}/g) || []).forEach(function (n) {
      if (found.inv.indexOf(n) === -1) found.inv.push(n);
    });
    (m[2].match(/\d{2}/g) || []).forEach(function (n) {
      if (found.dec.indexOf(n) === -1) found.dec.push(n);
    });
  });
  return found;
}

// ---- The assertions. Each returns its complaints; empty means the document holds. ----

function checkUnique(data) {
  var seen = Object.create(null);
  var out = [];
  data.rows.forEach(function (row) {
    if (seen[row.id]) out.push(row.id + ' is declared twice');
    seen[row.id] = true;
  });
  return out;
}

function checkPrefix(data) {
  var out = [];
  data.rows.forEach(function (row) {
    if (row.headingGroup === null) return;
    if (Number(row.number[0]) !== row.headingGroup) {
      out.push(row.id + ' is declared under REQ-' + row.headingGroup + 'xx');
    }
  });
  return out;
}

function checkDeclared(data) {
  var out = [];
  data.rows.forEach(function (row) {
    if (!row.source) out.push(row.id + ' has no source');
    if (data.methods.indexOf(row.method) === -1) {
      out.push(row.id + ' verifies by ' + JSON.stringify(row.method) + ', which is not in the declared set');
    }
  });
  return out;
}

function checkCited(data) {
  return data.rows.filter(function (row) {
    return !data.others.some(function (o) { return o.text.indexOf(row.id) !== -1; });
  }).map(function (row) { return row.id + ' is cited by no other spec'; });
}

function checkPatternIdsExist(data) {
  var out = [];
  data.others.concat([{ file: data.file, text: data.text }]).forEach(function (o) {
    (o.text.match(/PAT-(?:INV|DEC|AP)-\d{2}/g) || []).forEach(function (id) {
      if (data.pattern.indexOf(id) === -1) out.push(id + ' cited by ' + o.file);
    });
  });
  return out;
}

function checkPatternReachesTable(data) {
  var table = traceabilityTable(data.text);
  var out = [];
  ['inv', 'dec'].forEach(function (kind) {
    var label = kind === 'inv' ? 'PAT-INV' : 'PAT-DEC';
    for (var n = 1; n <= 14; n++) {
      var nn = String(n).padStart(2, '0');
      if (table[kind].indexOf(nn) === -1) out.push(label + '-' + nn + ' reaches no requirement group');
      if (data.pattern.indexOf(label + '-' + nn) === -1) {
        out.push(label + '-' + nn + ' is not declared in PATTERN.md');
      }
    }
  });
  return out;
}

function checkPatternCited(data) {
  var out = [];
  ['INV', 'DEC'].forEach(function (kind) {
    for (var n = 1; n <= 14; n++) {
      var id = 'PAT-' + kind + '-' + String(n).padStart(2, '0');
      if (!data.others.some(function (o) { return o.text.indexOf(id) !== -1; })) {
        out.push(id + ' is cited by no spec');
      }
    }
  });
  return out;
}

// A synthetic document that breaks every assertion. Used only to prove the checks fire; it is never
// written to disk and never compared against anything but these functions.
function brokenDocument() {
  return [
    '# 99 — A broken set',
    '',
    'Verification codes:',
    '',
    '| Code | Method |',
    '|---|---|',
    '| `static` | Static check |',
    '| `unit` | Unit test |',
    '',
    '---',
    '',
    '## 1. Artifact — `REQ-1xx`',
    '',
    '| id | Requirement | Source | Verification |',
    '|---|---|---|---|',
    '| `REQ-101` | A requirement. | `PAT-INV-01` | `static` |',
    '| `REQ-101` | The same id again. | `PAT-INV-01` | `static` |',
    '| `REQ-204` | Numbered for the wrong group. | `PAT-INV-10` | `unit` |',
    '| `REQ-103` | Names a method nobody declared. | `PAT-INV-01` | `vibes` |',
    '| `REQ-104` | Names an invariant that does not exist. | `PAT-INV-99` | `static` |',
    '| `REQ-105` |  | `PAT-INV-01` | `static` |',
    '',
    '---',
    '',
    '## Traceability',
    '',
    '| Group | Primary `PAT-INV` | Primary `PAT-DEC` | `PAT-AP` guarded against |',
    '|---|---|---|---|',
    '| `REQ-1xx` | 01 | 02 | — |',
    '',
    '### Present-state gaps, measured',
    '',
    '| Requirement | Present state |',
    '|---|---|',
    '| `REQ-101` | Nothing yet. |',
    '',
    '## Phased build order',
    '',
    'A table that is not a requirement table.',
    '',
  ].join('\n');
}

function brokenData() {
  var text = brokenDocument();
  return {
    file: 'a broken document',
    text: text,
    rows: requirementRows(text),
    methods: declaredMethods(text),
    // A second document that cites nothing, so "cited by at least one other spec" and "cited by some
    // spec" both have somewhere to fail. The broken document cites its own ids, which is exactly the
    // situation those two checks exist to catch.
    others: [{ file: 'a broken spec', text: 'This document cites nothing at all.' }],
    // Only three of the twenty-eight pattern ids are declared, so the two pattern checks fire too.
    pattern: 'PAT-INV-01 PAT-INV-10 PAT-DEC-02',
  };
}

var CHECKS = [
  { name: 'every REQ id is unique', run: checkUnique },
  { name: 'every REQ id sits in the section whose prefix it carries', run: checkPrefix },
  { name: 'every REQ declares a source and a verification method from the declared set', run: checkDeclared },
  { name: 'every REQ is cited by at least one other spec', run: checkCited },
  { name: 'every PAT id cited under specs/ exists in PATTERN.md', run: checkPatternIdsExist },
  { name: 'every PAT-INV and PAT-DEC reaches the traceability table', run: checkPatternReachesTable },
  { name: 'every PAT-INV and PAT-DEC is cited by some spec, so an unmet one is a visible deviation', run: checkPatternCited },
];

module.exports = {
  name: 'traceability (REQ-801)',
  tests: [
    {
      name: 'the requirement table parses, and the document declares its verification methods',
      run: function () {
        var d = load();
        h.ok(d.rows.length > 100, 'expected the requirement table to hold the full set, found ' + d.rows.length);
        h.ok(d.methods.length >= 8, 'expected the declared method set, found ' + JSON.stringify(d.methods));
      },
    },
  ].concat(CHECKS.map(function (check) {
    return {
      name: check.name,
      run: function () {
        h.equal(check.run(load()).join('; '), '', 'REQ-801');
      },
    };
  })).concat([
    {
      name: 'each of those checks fires on a document that breaks it',
      run: function () {
        var data = brokenData();
        var silent = CHECKS.filter(function (check) { return !check.run(data).length; });
        h.equal(silent.map(function (c) { return c.name; }).join('; '), '',
          'a traceability check that cannot fail is false comfort');
      },
    },
    {
      name: 'the parser does not read the present-state table as requirements',
      run: function () {
        // The broken document carries the same requirement id in both the requirement table and the
        // present-state table. A parser that reads both reports a duplicate that is not there.
        var data = brokenData();
        var declared = data.rows.filter(function (r) { return r.id === 'REQ-101'; });
        h.equal(declared.length, 2, 'the requirement table declares REQ-101 twice — that is the point');
        h.equal(checkUnique(data).filter(function (c) { return c.indexOf('REQ-101') !== -1; }).length, 1,
          'exactly one of the two duplicates comes from the requirement table, not the present-state one');
      },
    },
  ]),
};
