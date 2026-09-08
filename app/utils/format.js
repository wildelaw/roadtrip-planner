// Formatting helpers: currency, truncation (for tool results), HTML escaping.

export function escapeHTML(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtMoney(amount, currency = 'USD') {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

// Truncate to roughly maxChars, on a word boundary, with an ellipsis.
export function truncate(text, maxChars = 8000) {
  const s = String(text ?? '');
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return cut.slice(0, lastSpace > 0 ? lastSpace : maxChars) + '… [truncated]';
}

// Render untrusted markdown to safe HTML.
// Self-contained: we ESCAPE first, then apply a small whitelist of inline/block
// transformations. Because the input is escaped before any markup is introduced,
// no raw HTML from the model can ever reach the DOM — this is XSS-safe without
// needing a sanitizer dependency.
export function renderMarkdown(text) {
  const raw = String(text ?? '').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const out = [];
  let listOpen = false;
  const closeList = () => { if (listOpen) { out.push('</ul>'); listOpen = false; } };

  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!listOpen) { out.push('<ul>'); listOpen = true; }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    if (line.trim() === '') { closeList(); out.push(''); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

function inline(s) {
  let t = escapeHTML(s);
  // inline code
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  // links [text](http(s)://url)
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // bare URLs
  t = t.replace(/(^|[\s(])((https?:\/\/[^\s<)]+))/g,
    '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  // bold **x**
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italic _x_ (avoid touching ** already handled)
  t = t.replace(/(^|[^\w])_([^_]+)_([^\w]|$)/g, '$1<em>$2</em>$3');
  return t;
}