// The patch format and its application (04-versioning.md §4.1).
//
//   [ { op: 'replace', path: ['days', 2, 'items', 0, 'title'], value: '…' },
//     { op: 'add',     path: ['days', 2, 'items', 1],          value: { … } },
//     { op: 'remove',  path: ['expenses', 4] } ]
//
// `path` is an ARRAY OF SEGMENTS, not a JSON Pointer string. Two reasons, both about
// validation: array segments make bounds checking direct, and rejecting a `__proto__` /
// `constructor` / `prototype` segment is a comparison rather than a string-parse of an
// escaped pointer (REQ-705).

TP.patch = (function () {
  'use strict';

  var FORBIDDEN = ['__proto__', 'constructor', 'prototype'];
  var OPS = ['replace', 'add', 'remove'];
  var MAX_PATH = 64;

  function isForbidden(segment) {
    return typeof segment === 'string' && FORBIDDEN.indexOf(segment) !== -1;
  }

  // An empty path means the whole document. Only a `replace` may name it: there is no parent to add
  // a root into or remove it from. This case is reachable because `diff` emits it — replacing an
  // array of a different length, or any root whose type changed, is one operation at path [] — and a
  // patch the app can produce must be a patch the app can apply.
  function validatePath(path, allowEmpty) {
    if (!Array.isArray(path)) return 'path is not a list of segments';
    if (path.length === 0) return allowEmpty ? null : 'path is empty';
    if (path.length > MAX_PATH) return 'path has ' + path.length + ' segments, beyond the ' + MAX_PATH + ' this app will walk';
    for (var i = 0; i < path.length; i++) {
      var s = path[i];
      if (typeof s === 'string') {
        if (isForbidden(s)) return 'path segment "' + s + '" is not permitted';
      } else if (typeof s === 'number') {
        if (!Number.isInteger(s) || s < 0) return 'array index ' + String(s) + ' is not a non-negative integer';
      } else {
        return 'path segment ' + i + ' is neither a string nor an index';
      }
    }
    return null;
  }

  function validate(ops, limits) {
    var lim = limits || {};
    if (!Array.isArray(ops)) return 'the patch is not a list of operations';
    var maxOps = lim.maxPatchOps || 200000;
    if (ops.length > maxOps) {
      return 'the patch has ' + ops.length + ' operations, beyond the ' + maxOps + ' this app will apply';
    }
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (!op || typeof op !== 'object') return 'operation ' + i + ' is not an object';
      if (OPS.indexOf(op.op) === -1) return 'operation ' + i + ' has unknown op "' + String(op.op) + '"';
      var err = validatePath(op.path, op.op === 'replace');
      if (err) return 'operation ' + i + ': ' + err;
      if (op.op !== 'remove' && op.value === undefined) return 'operation ' + i + ' (' + op.op + ') has no value';
    }
    return null;
  }

  function isArrayIndex(key) {
    return typeof key === 'number' || (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key));
  }

  // Structural sharing: only the spine along the path is copied, so applying a patch to a
  // 400 KB payload does not clone 400 KB.
  function cloneAlong(value, path, depth) {
    if (depth >= path.length) return value;
    var key = path[depth];
    if (Array.isArray(value)) {
      var arr = value.slice();
      var idx = Number(key);
      arr[idx] = cloneAlong(value[idx], path, depth + 1);
      return arr;
    }
    if (value && typeof value === 'object') {
      var out = {};
      for (var k in value) if (Object.prototype.hasOwnProperty.call(value, k)) out[k] = value[k];
      out[key] = cloneAlong(value[key], path, depth + 1);
      return out;
    }
    throw new Error('patch: cannot walk into ' + (value === null ? 'null' : typeof value) +
      ' at segment ' + depth + ' (' + JSON.stringify(path.slice(0, depth + 1)) + ')');
  }

  function applyOne(root, op) {
    var path = op.path;
    // The whole document. `validate` permits an empty path only for a replace, so there is nothing
    // to insert into and nothing to delete from here.
    if (path.length === 0) return op.value;

    var parentPath = path.slice(0, -1);
    var last = path[path.length - 1];
    var next = cloneAlong(root, path, 0);

    // Walk to the parent and mutate the (already copied) spine.
    var parent = next;
    for (var i = 0; i < parentPath.length; i++) parent = parent[parentPath[i]];
    if (parent === null || typeof parent !== 'object') {
      throw new Error('patch: path ' + JSON.stringify(path) + ' does not resolve to a container');
    }
    if (Array.isArray(parent)) {
      var idx = Number(last);
      if (!isArrayIndex(last)) throw new Error('patch: "' + String(last) + '" is not an array index');
      if (op.op === 'add') {
        if (idx > parent.length) idx = parent.length;
        parent.splice(idx, 0, op.value);
      } else if (op.op === 'remove') {
        if (idx >= parent.length) throw new Error('patch: remove at index ' + idx + ' beyond the array (' + parent.length + ' entries)');
        parent.splice(idx, 1);
      } else {
        if (idx >= parent.length) throw new Error('patch: replace at index ' + idx + ' beyond the array (' + parent.length + ' entries)');
        parent[idx] = op.value;
      }
      return next;
    }
    if (isForbidden(last)) throw new Error('patch: path segment "' + last + '" is not permitted');
    if (op.op === 'remove') {
      delete parent[last];
    } else {
      parent[last] = op.value;
    }
    return next;
  }

  function apply(root, ops) {
    var err = validate(ops);
    if (err) throw new Error(err);
    var cur = root;
    for (var i = 0; i < ops.length; i++) cur = applyOne(cur, ops[i]);
    return cur;
  }

  function equal(a, b) {
    return TP.canonical.serialize(a) === TP.canonical.serialize(b);
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  // A minimal diff. It is not trying to be clever — rule 3 (§4.2) discards any patch that
  // comes out larger than the snapshot, so a bad diff costs space for one commit and never
  // costs correctness.
  function diff(a, b) {
    var out = [];
    walk([], a, b, out);
    return out;
  }

  function walk(path, a, b, out) {
    if (equal(a, b)) return;
    if (isPlainObject(a) && isPlainObject(b)) {
      var k;
      var seen = Object.create(null);
      for (k in a) {
        if (!Object.prototype.hasOwnProperty.call(a, k)) continue;
        seen[k] = true;
        if (!Object.prototype.hasOwnProperty.call(b, k)) {
          if (!isForbidden(k)) out.push({ op: 'remove', path: path.concat([k]) });
        } else if (a[k] !== b[k]) {
          walk(path.concat([k]), a[k], b[k], out);
        }
      }
      for (k in b) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
        if (seen[k]) continue;
        if (b[k] === undefined) continue;
        if (isForbidden(k)) continue;
        out.push({ op: 'add', path: path.concat([k]), value: b[k] });
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) walk(path.concat([i]), a[i], b[i], out);
      }
      return;
    }
    // Everything else — type change, length change, scalar — is one replace.
    out.push({ op: 'replace', path: path, value: b });
  }

  // The comparison rule 3 uses, applied before writing: is the patch bigger than the
  // snapshot it would replace?
  function byteSize(ops) {
    return TP.sha256.utf8Bytes(TP.canonical.serialize(ops)).length;
  }

  function opCount(ops) {
    return Array.isArray(ops) ? ops.length : 0;
  }

  return {
    FORBIDDEN: FORBIDDEN,
    MAX_PATH: MAX_PATH,
    validate: validate,
    validatePath: validatePath,
    isForbidden: isForbidden,
    apply: apply,
    diff: diff,
    equal: equal,
    byteSize: byteSize,
    opCount: opCount,
  };
})();
