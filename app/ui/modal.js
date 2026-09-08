// Lightweight modal helper. Renders into #modal-host.
// openModal({title, body: HTMLElement|htmlString, actions:[{label,kind,onclick,dismiss}] })

let host;

export function openModal({ title, body, actions = [] }) {
  host = host || document.getElementById('modal-host');
  const modal = document.createElement('div');
  modal.className = 'modal';

  const h = document.createElement('h3');
  h.textContent = title || '';
  modal.appendChild(h);

  const bodyEl = document.createElement('div');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body instanceof Node) bodyEl.appendChild(body);
  modal.appendChild(bodyEl);

  const acts = document.createElement('div');
  acts.className = 'modal__actions';
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => closeModal();
  acts.appendChild(cancel);
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = `btn btn--${a.kind || 'primary'}`;
    b.textContent = a.label;
    b.onclick = () => a.onclick?.(bodyEl, closeModal);
    if (a.dismiss !== false) { /* default closes handled by caller */ }
    acts.appendChild(b);
  }
  modal.appendChild(acts);

  host.replaceChildren(modal);
  host.hidden = false;
  return { modal, bodyEl, close: closeModal };
}

export function closeModal() {
  if (!host) return;
  host.replaceChildren();
  host.hidden = true;
}

// Build a labeled field element: <div class="field"><label>..</label>input</div>
export function field(labelText, control, hint) {
  const f = document.createElement('div');
  f.className = 'field';
  const lab = document.createElement('label');
  lab.textContent = labelText;
  f.appendChild(lab);
  if (typeof control === 'string') f.insertAdjacentHTML('beforeend', control);
  else f.appendChild(control);
  if (hint) {
    const h = document.createElement('p');
    h.className = 'subtle mb0';
    h.textContent = hint;
    f.appendChild(h);
  }
  return f;
}