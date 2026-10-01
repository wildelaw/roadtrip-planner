// The null adapter: read-only mode.
//
// It exists so that "cannot write" is a supported configuration with an existing code path,
// rather than a branch bolted onto each write site. Read-only mode is reached by an integrity
// failure (REQ-317) or by an unknown newer container format (REQ-212).

TP.storageNull = (function () {
  'use strict';

  function create(reason) {
    var why = reason || 'This document is open read-only.';

    function refuse(what) {
      throw new TP.storage.ReadOnlyError(why + ' ' + what + ' was not written.');
    }

    return {
      get: function () { return null; },
      set: function (key) { refuse('"' + key + '"'); },
      del: function (key) { refuse('The removal of "' + key + '"'); },
      keys: function () { return []; },
      bytesUsed: function () { return 0; },
      available: function () { return false; },
      kind: function () { return 'null'; },
      describe: function () { return why; },
      reason: why,
    };
  }

  return { create: create };
})();
