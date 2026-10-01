// In-memory store: fully functional for the session, discarded on close. Chosen when
// localStorage throws on access, so that every operation still reaches a correct outcome
// (REQ-403) instead of the app degrading into warnings.

TP.storageMemory = (function () {
  'use strict';

  function create() {
    var map = Object.create(null);

    function get(key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    }

    function set(key, value) {
      map[key] = JSON.parse(JSON.stringify(value));
      return value;
    }

    function del(key) {
      delete map[key];
    }

    function keys(prefix) {
      var out = [];
      for (var k in map) {
        if (!prefix || k.indexOf(prefix) === 0) out.push(k);
      }
      return out;
    }

    function bytesUsed() {
      var total = 0;
      for (var k in map) total += k.length + JSON.stringify(map[k]).length;
      return total;
    }

    function available() { return true; }

    function kind() { return 'memory'; }

    function describe() {
      return 'Held in memory for this session only — this browser page cannot keep local storage. ' +
        'Export the document to keep your work.';
    }

    return {
      get: get, set: set, del: del, keys: keys,
      bytesUsed: bytesUsed, available: available,
      kind: kind, describe: describe, downgraded: false,
    };
  }

  return { create: create };
})();
