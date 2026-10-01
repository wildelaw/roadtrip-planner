// environment.js — the only module that reads location (REQ-601, specs/07-ui.md §1).
//
// Three platform behaviours, three booleans, one file. This is PAT-INV-12's discipline —
// "all persistence goes through one adapter" — applied to the platform: a platform
// difference confined to one module is a configuration; the same difference spread across
// forty call sites is a bug class.

TP.environment = (function () {
  var isFile = location.protocol === 'file:';
  return {
    isFile:            isFile,
    aiEnabled:         !isFile,                                            // REQ-602
    canSaveInPlace:    !isFile && typeof window.showSaveFilePicker === 'function',  // REQ-607
    prefersTextExport: isFile,                                             // REQ-510
  };
})();
