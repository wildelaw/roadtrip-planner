// Canonical serialization and the hash primitive (specs/09-testing.md §2 P1, P5; REQ-305, REQ-306,
// REQ-307).
//
// P1 is the property that makes `REQ-305` real: key order in memory must never change a hash. It is
// also a property that passes trivially for a serializer that returns the empty string, so every
// property here is paired with a negative control that fails if the serializer stops distinguishing
// things that are not equal. A property test with no negative control is a test of the test.

'use strict';

var path = require('path');
var crypto = require('crypto');
var childProcess = require('child_process');

var h = require('./harness.js');

// The published NIST vectors (FIPS 180-4). A hand-written primitive is a classic bug source, and
// these are the mitigation (ADR-0004). They are checked here and at build time because the build is
// where the hash first matters.
var NIST = [
  { input: '', digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { input: 'abc', digest: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
  {
    input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    digest: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  },
  {
    input: 'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
    digest: 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
  },
];

// The message lengths that exercise each padding branch: 0, under the length field, exactly at the
// 56-byte boundary, and past it into a second block.
var LENGTHS = [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4096, 65536, 500000];

// Node's own SHA-256, as the oracle. A hand-written primitive cross-checked against a published
// implementation over a corpus is a far stronger check than four fixed vectors — and it is the check
// `REQ-806`'s validator cross-check is the same shape of.
function oracle(s) {
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

// A pathological input needs its own process.
//
// In this Node (v24.15.0), hashing a ~1,000,000-character string through the vm-loaded program
// SEGFAULTS — but only when the same program text has already run in an earlier realm in the same
// process. Each piece alone is fine (`utf8Bytes` alone, `digestBytes` alone), one realm with any
// amount of warm-up is fine, and a plain vm script with a 1M-element push loop is fine, so this is a
// defect in the toolchain's cross-realm compilation and not in the app: a browser runs one realm, and
// `node build.js` hashes this vector successfully on every build.
//
// The answer is an isolated process rather than a smaller input. Dropping the long-input coverage to
// fit the toolchain would be the suite lying about what it checked.
//
// The input is described to the child, not inlined into it: a megabyte of `'a'` as a source literal
// exceeds the stack this Node runs with, which is a different failure with the same smell.
function hashRepeatedInFreshProcess(ch, n) {
  var script = 'var h = require(' + JSON.stringify(path.join(h.ROOT, 'test', 'harness.js')) + ');' +
    'process.stdout.write(h.pure({}).TP.sha256.hex(String(' + JSON.stringify(ch) + ').repeat(' + n + ')));';
  return childProcess.execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 120000,
    cwd: h.ROOT,
  }).trim();
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') {
    var out = {};
    Object.keys(value).reverse().forEach(function (k) { out[k] = reverseKeys(value[k]); });
    return out;
  }
  return value;
}

module.exports = {
  name: 'canonical serialization and SHA-256 (P1, REQ-305, REQ-307)',
  tests: [
    {
      name: 'SHA-256 matches the published NIST vectors',
      run: function () {
        var TP = h.pure({}).TP;
        NIST.forEach(function (v) {
          h.equal(TP.sha256.hex(v.input), v.digest, 'NIST vector of ' + v.input.length + ' bytes');
        });
      },
    },
    {
      name: 'SHA-256 agrees with Node’s own implementation across every padding boundary',
      run: function () {
        var TP = h.pure({}).TP;
        LENGTHS.forEach(function (n) {
          var s = 'a'.repeat(n);
          var digest = TP.sha256.hex(s);
          h.equal(digest.length, 64, 'a digest is 32 bytes of hex, at length ' + n);
          h.equal(digest, oracle(s), 'length ' + n);
          if (n) {
            var mutated = s.slice(0, n - 1) + 'b';
            h.equal(TP.sha256.hex(mutated), oracle(mutated), 'one changed byte, at length ' + n);
            h.ok(TP.sha256.hex(mutated) !== digest, 'and it must change the digest, at length ' + n);
          }
        });
      },
    },
    {
      name: 'SHA-256 agrees on multibyte text, lone surrogates and control characters',
      run: function () {
        var TP = h.pure({}).TP;
        var cases = [
          'Kyoto',
          'Tōkyō',
          '🛣️ a road',
          '\u0000\u0001\u001f',
          '‮RTL override',
          'a\u0000b',
          // A lone surrogate: the encoder replaces it, and the encoder here must agree with the one
          // a browser's TextEncoder would use, or a hash computed in each would differ.
          'x\ud800y',
          'x\udc00y',
          'emoji 🚗🚙🚐 in a row',
        ];
        cases.forEach(function (s) {
          h.equal(TP.sha256.hex(s), oracle(s), 'input ' + JSON.stringify(s));
        });
      },
    },
    {
      name: 'the 1,000,000-character vector matches, in a process of its own',
      run: function () {
        var big = 'a'.repeat(1000000);
        h.equal(oracle(big),
          'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
          'Node’s own digest must equal the published vector, or the oracle is wrong');
        h.equal(hashRepeatedInFreshProcess('a', 1000000),
          'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
      },
    },
    {
      name: 'P1: equal model values serialize identically, whatever order their keys were built in',
      run: function () {
        var TP = h.pure({}).TP;
        for (var seed = 1; seed <= 60; seed++) {
          var payload = h.randomTrip(TP, h.generator(seed));
          var again = reverseKeys(payload);
          h.equal(TP.canonical.serialize(again), TP.canonical.serialize(payload),
            'seed ' + seed + ': key order in memory must never change a hash (REQ-305)');
          h.equal(TP.canonical.hash(again), TP.canonical.hash(payload), 'seed ' + seed + ': the hash follows');
        }
      },
    },
    {
      name: 'P1 negative control: values that are not equal do not serialize identically',
      run: function () {
        var TP = h.pure({}).TP;
        var base = { a: 1, b: 'x', c: [1, 2, 3], d: { e: true } };
        var variants = {
          'a different number': { a: 2, b: 'x', c: [1, 2, 3], d: { e: true } },
          'a reordered array': { a: 1, b: 'x', c: [3, 2, 1], d: { e: true } },
          'a different string': { a: 1, b: 'X', c: [1, 2, 3], d: { e: true } },
          'a flipped boolean': { a: 1, b: 'x', c: [1, 2, 3], d: { e: false } },
          'a shorter array': { a: 1, b: 'x', c: [1, 2], d: { e: true } },
          'an absent key': { a: 1, b: 'x', c: [1, 2, 3] },
          'a null where there was an object': { a: 1, b: 'x', c: [1, 2, 3], d: null },
        };
        var baseText = TP.canonical.serialize(base);
        for (var label in variants) {
          h.ok(TP.canonical.serialize(variants[label]) !== baseText,
            label + ' must not serialize to the same bytes as the original');
        }
      },
    },
    {
      name: 'a key that is present with an undefined value is absent, and a null is not',
      run: function () {
        var TP = h.pure({}).TP;
        // The distinction is meaningful: a cleared field versus one that was never set. A
        // serializer that conflates them makes "the user cleared this" unrepresentable.
        h.equal(TP.canonical.serialize({ a: 1, b: undefined }), '{"a":1}');
        h.equal(TP.canonical.serialize({ a: 1, b: null }), '{"a":1,"b":null}');
        h.equal(TP.canonical.serialize([1, undefined, 3]), '[1,null,3]');
      },
    },
    {
      name: 'numbers normalize: no negative zero, no trailing point, and a defined exponent rule',
      run: function () {
        var TP = h.pure({}).TP;
        var n = TP.canonical.numToString;
        h.equal(n(0), '0');
        h.equal(n(-0), '0', '-0 and 0 are the same value and must be the same bytes');
        h.equal(n(1), '1');
        h.equal(n(1.5), '1.5');
        h.equal(n(-17), '-17');
        h.equal(n(1e21), '1e+21', 'the exponent form is shorter than 1 followed by 21 zeros');
        h.equal(n(2e21), '2e+21');
        h.equal(n(1e3), '1000', 'below the exponent threshold the decimal form needs no help');
        h.equal(n(Number.MAX_SAFE_INTEGER), '9007199254740991');
        h.throws(function () { n(NaN); }, 'NaN is not a finite number');
        h.throws(function () { n(Infinity); }, 'Infinity is not a finite number');
        h.equal(TP.canonical.serialize({ a: -0 }), '{"a":0}');
        // The rule the spec states is "no exponent form for values whose decimal form is shorter",
        // which is not the same as "never use an exponent". Above 1e21 the decimal form is longer,
        // so the exponent form is the correct choice; every value that reaches the conversion path
        // is one of those, which is why the conversion never fires in practice.
        [1e21, 1.5e21, 9.9e30].forEach(function (v) {
          h.ok(TP.canonical.numToString(v).length <= String(v).length, 'no longer than the default form');
          h.equal(Number(TP.canonical.numToString(v)), v, 'and it parses back to the same number');
        });
      },
    },
    {
      name: 'strings are JSON-escaped, so a quote in a value cannot break the encoding',
      run: function () {
        var TP = h.pure({}).TP;
        var hostile = ['"', '\\', '\n', '\t', '\u0000', '‮', '🛣️', '</script>', '<!--'];
        hostile.forEach(function (s) {
          var text = TP.canonical.serialize({ v: s });
          h.equal(JSON.parse(text).v, s, 'a round trip through the encoding must return the same string');
        });
      },
    },
    {
      name: 'a literal `</script` never survives into the data block, which would end the element',
      run: function () {
        var TP = h.pure({}).TP;
        // Canonical serialization is JSON, and JSON.stringify does NOT escape the solidus. So the
        // escape has to happen where the text becomes markup, which is the container's job. This is
        // the check that keeps the two from being confused for each other.
        h.ok(TP.canonical.serialize({ v: '</script>' }).indexOf('</script') !== -1,
          'JSON itself leaves the sequence alone — the container is what must escape it');
        var escaped = TP.container.escapeForScriptBlock(TP.canonical.serialize({ v: '</script>' }));
        h.ok(escaped.indexOf('</script') === -1, 'the escaped form carries no literal closing tag');
        h.ok(escaped.indexOf('<!--') === -1, 'nor an HTML comment opener, which is the other way in');
        h.equal(JSON.parse(escaped).v, '</script>', 'and it still parses back to the same string');
      },
    },
    {
      name: 'P5: applying a patch and then its inverse returns the original payload',
      run: function () {
        var TP = h.pure({}).TP;
        for (var seed = 1; seed <= 60; seed++) {
          var gen = h.generator(seed * 7919);
          var a = h.randomTrip(TP, gen);
          var b = h.randomTrip(TP, gen);
          var forward = TP.patch.diff(a, b);
          var back = TP.patch.diff(b, a);

          // Compared through the canonical serializer, not `deepEqual`: a patched payload carries
          // the source's key order, and P1/REQ-305 make key order not a part of the value.
          h.samePayload(TP, TP.patch.apply(a, forward), b, 'seed ' + seed + ': forward application');
          h.samePayload(TP, TP.patch.apply(b, back), a, 'seed ' + seed + ': inverse application');
          h.samePayload(TP, TP.patch.apply(TP.patch.apply(a, forward), back), a,
            'seed ' + seed + ': a patch and its inverse return the original');
          h.ok(TP.patch.equal(a, TP.patch.apply(TP.patch.apply(a, forward), back)),
            'seed ' + seed + ': equality agrees with canonical equality');
        }
      },
    },
    {
      name: 'P5 covers splices at both ends, where an off-by-one hides',
      run: function () {
        var TP = h.pure({}).TP;
        var cases = [
          { from: [1, 2, 3], to: [1, 2, 3, 4] },
          { from: [1, 2, 3], to: [0, 1, 2, 3] },
          { from: [1, 2, 3], to: [1, 3] },
          { from: [1, 2, 3], to: [2, 3] },
          { from: [1, 2, 3], to: [] },
          { from: [], to: [1, 2, 3] },
          { from: [], to: [] },
          { from: { a: [1, 2], b: [3] }, to: { a: [1, 2, 9], b: [] } },
        ];
        cases.forEach(function (c, i) {
          var f = TP.patch.diff(c.from, c.to);
          h.equal(TP.patch.apply(c.from, f).length, c.to.length, 'case ' + i + ': length');
          h.deepEqual(TP.patch.apply(c.from, f), c.to, 'case ' + i);
        });
      },
    },
    {
      name: 'P5 negative control: a patch applied to the wrong payload is refused, not silently wrong',
      run: function () {
        var TP = h.pure({}).TP;
        var from = { a: [1, 2, 3], b: { c: 'x' } };
        var to = { a: [1, 2, 9], b: { c: 'y' } };
        var patch = TP.patch.diff(from, to);
        var other = { a: [1], b: { c: 5 } };
        // Either the patch throws or it produces something that is not `to`. What it must not do is
        // report success and produce `to` from an unrelated base.
        var result;
        try { result = TP.patch.apply(other, patch); } catch (e) { return; }
        h.ok(!TP.patch.equal(result, to), 'a patch applied to an unrelated payload must not appear to succeed');
      },
    },
    {
      name: 'a diff of a value against its own clone is empty, and an empty patch changes nothing',
      run: function () {
        var TP = h.pure({}).TP;
        var payload = h.maximalTrip(TP, 'X');
        var clone = JSON.parse(JSON.stringify(payload));
        h.equal(TP.patch.diff(payload, clone).length, 0, 'a value against its own clone yields no operations');
        h.deepEqual(TP.patch.apply(payload, []), payload, 'an empty patch is the identity');
        // Negative control: two independently built maximal trips are NOT the same value, because
        // their generated ids differ. Without this, an empty diff would be indistinguishable from a
        // diff that gave up.
        h.ok(TP.patch.diff(payload, h.maximalTrip(TP, 'X')).length > 0,
          'two trips with different ids are not the same value');
      },
    },
  ],
};
