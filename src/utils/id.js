// Identity generation (03-data-model.md §3). Unchanged from the present app: identity
// generation is not security-sensitive and the fallback path already covers `file://`,
// where crypto.randomUUID is not guaranteed to exist.

TP.uid = function uid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (e) { /* fall through */ }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
};
