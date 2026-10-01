// Canonical serialization: the one implementation shared by the application and the tests
// (REQ-305, REQ-306, 04-versioning.md §2).
//
// Two implementations that "should" agree are two that will eventually disagree, and the
// failure presents as every commit in every circulated file failing to verify — a bug that
// looks like corruption. Hence one function, loaded by both.

TP.canonical = (function () {
  'use strict';

  // Numbers: finite only; -0 becomes 0; integers carry no decimal point; an exponent form is
  // used only when it is shorter than the decimal form. Everything else is String(n).
  function numToString(n) {
    if (typeof n !== 'number' || !isFinite(n)) {
      throw new Error('canonical: not a finite number: ' + String(n));
    }
    if (n === 0) return '0';                       // covers -0
    var s = String(n);
    if (s.indexOf('e') === -1 && s.indexOf('E') === -1) return s;
    // Only integers have a decimal form that can be shorter than the exponent form.
    if (Number.isInteger(n)) {
      var d;
      try { d = BigInt(n).toString(); } catch (e) { d = null; }
      if (d !== null && d.length < s.length) return d;
    }
    return s;
  }

  // Sorted lexicographically by UTF-16 code unit, at every depth. Array#sort's default
  // comparator is exactly that.
  function sortedKeys(obj) {
    var keys = [];
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) keys.push(k);
    }
    return keys.sort();
  }

  function write(value, out) {
    if (value === null) { out.push('null'); return; }
    var t = typeof value;
    if (t === 'string') { out.push(JSON.stringify(value)); return; }
    if (t === 'number') { out.push(numToString(value)); return; }
    if (t === 'boolean') { out.push(value ? 'true' : 'false'); return; }
    if (t === 'undefined') {
      // Only reachable for array elements; in objects the key is omitted before we get here.
      out.push('null');
      return;
    }
    if (t === 'bigint') { out.push(numToString(Number(value))); return; }
    if (t !== 'object') {
      throw new Error('canonical: unsupported value of type ' + t);
    }
    if (Array.isArray(value)) {
      out.push('[');
      for (var i = 0; i < value.length; i++) {
        if (i) out.push(',');
        write(value[i], out);
      }
      out.push(']');
      return;
    }
    var keys = sortedKeys(value);
    out.push('{');
    var first = true;
    for (var j = 0; j < keys.length; j++) {
      var v = value[keys[j]];
      // `undefined` is omitted; `null` is preserved. The distinction is meaningful here:
      // a cleared field versus an absent one.
      if (v === undefined) continue;
      if (!first) out.push(',');
      first = false;
      out.push(JSON.stringify(keys[j]), ':');
      write(v, out);
    }
    out.push('}');
  }

  function serialize(value) {
    var out = [];
    write(value, out);
    return out.join('');
  }

  // Hashing helper: `sha256:<hex>` — the form used by commit ids and payload hashes.
  function hash(value) {
    return 'sha256:' + TP.sha256.hex(serialize(value));
  }

  return { serialize: serialize, hash: hash, numToString: numToString };
})();
