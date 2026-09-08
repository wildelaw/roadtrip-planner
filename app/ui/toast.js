// Toast notifications + error banners (incl. CORS guidance).

let host = null;

function mount() {
  if (!host) host = document.getElementById('toasts');
  return host;
}

export function toast(message, kind = 'info', ttl = 4200) {
  const el = document.createElement('div');
  el.className = `toast toast--${kind === 'info' ? '' : kind}`.trim();
  el.textContent = message;
  mount().appendChild(el);
  if (ttl > 0) setTimeout(() => fade(el), ttl);
  return el;
}

export function persistent(kind, message) {
  const el = toast(message, kind, 0);
  const close = document.createElement('button');
  close.className = 'btn--ghost';
  close.textContent = '×';
  close.style.cssText = 'float:right;color:inherit;cursor:pointer;background:none;border:none;font-size:16px';
  close.onclick = () => fade(el);
  el.prepend(close);
  return el;
}

function fade(el) {
  el.style.opacity = '0';
  el.style.transition = 'opacity .2s';
  setTimeout(() => el.remove(), 220);
}

// Map a typed AI error {kind, status, message} to actionable copy + banner.
export function showApiError(err) {
  if (!err || !err.kind) { toast(String(err || 'Unknown error'), 'error', 0); return; }
  switch (err.kind) {
    case 'cors':
    case 'network':
      persistent('error',
        `Request blocked (likely CORS). ${err.message || ''} ` +
        `Set a proxy URL in Settings, or for local mode run Ollama with OLLAMA_ORIGINS=*.`);
      break;
    case 'auth':
      toast(`API key rejected (${err.status || ''}). Check the key in Settings.`, 'error', 0);
      break;
    case 'webgpu':
      toast(`WebGPU: ${err.message || 'engine error'}`, 'error', 0);
      break;
    default:
      toast(`AI error ${err.status || ''}: ${err.message || ''}`.trim(), 'error', 0);
  }
}