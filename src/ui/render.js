// The render seam (specs/07-ui.md §2, REQ-701).
//
// Every view builds DOM through these four functions and nothing else. That is what makes the
// "no HTML string ever becomes markup" rule checkable: there is exactly one place to look, and
// payload text can only arrive as a text node.
//
//   el(tag, props, children)  create an element
//   text(string)              create a text node
//   frag(children)            create a fragment
//   clear(node)               empty a node safely
//
// props accepts:
//   class / className         string or array
//   text                      string -> text node child
//   on                        {event: handler}   (addEventListener, never an on* attribute)
//   dataset                   {key: value}
//   attrs                     {name: value}      setAttribute; null/undefined/false skips.
//                                                `style` is refused here — see `style` below.
//   style                     {prop: value}      CSSOM properties; a string is an error
//   value                     property assignment for form controls, plus the attribute
//   everything else           property assignment when the property exists, else attribute

TP.ui = TP.ui || {};

TP.ui.render = (function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function isNode(v) {
    return v && typeof v === 'object' && typeof v.nodeType === 'number';
  }

  function text(value) {
    return document.createTextNode(value == null ? '' : String(value));
  }

  function frag(children) {
    var f = document.createDocumentFragment();
    appendAll(f, children);
    return f;
  }

  function appendAll(parent, children) {
    // The parent has to be a NODE, and the easy mistake is an array: a view that builds `body` as a
    // list of nodes — which is what `modal.open` takes, and what half the dialogs in this app pass —
    // then adds a warning to it with `append(body, …)`, because "append to body" reads as "add to
    // this list". It reads that way and it is wrong: without this line the failure is
    // `parent.appendChild is not a function`, raised from inside whichever `el()` call happened to be
    // the child, so the stack points at the wrong file — and only when the branch that appends is
    // taken, which for a dialog about history is the interesting case and not the common one
    // (`src/ui/settings-view.js` was shipped with exactly this, four times over).
    //
    // No working call passes an array here, because such a call cannot work, so this cannot break
    // anything that works today. It only says where the mistake is. Use `push` for a list.
    if (Array.isArray(parent)) {
      throw new TypeError('render.append: the parent is an array, not a node — use push to add to a list of nodes');
    }
    if (children == null || children === false || children === true) return parent;
    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i++) appendAll(parent, children[i]);
      return parent;
    }
    if (isNode(children)) {
      parent.appendChild(children);
      return parent;
    }
    // Anything else is text. A number, a string, a boolean rendered as "true" — all of it
    // enters the document as characters, never as markup.
    parent.appendChild(text(children));
    return parent;
  }

  function classOf(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join(' ');
    return value == null || value === false ? '' : String(value);
  }

  function kebabCase(name) {
    return String(name).replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
  }

  function el(tag, props, children) {
    var node = tag === 'svg' || tag === 'path' || tag === 'circle' || tag === 'line'
      ? document.createElementNS(SVG_NS, tag)
      : document.createElement(tag);
    var p = props || {};

    for (var key in p) {
      if (!Object.prototype.hasOwnProperty.call(p, key)) continue;
      var value = p[key];
      if (value === undefined) continue;

      if (key === 'class' || key === 'className') {
        var cls = classOf(value);
        if (cls) node.setAttribute('class', cls);
        continue;
      }
      if (key === 'text') { if (value !== null && value !== false) node.appendChild(text(value)); continue; }
      if (key === 'children') continue;
      if (key === 'on') {
        for (var evt in value) {
          if (Object.prototype.hasOwnProperty.call(value, evt)) node.addEventListener(evt, value[evt]);
        }
        continue;
      }
      if (key === 'dataset') {
        for (var dk in value) {
          if (Object.prototype.hasOwnProperty.call(value, dk) && value[dk] != null) {
            node.dataset[dk] = String(value[dk]);
          }
        }
        continue;
      }
      if (key === 'attrs') {
        for (var ak in value) {
          if (!Object.prototype.hasOwnProperty.call(value, ak)) continue;
          var av = value[ak];
          if (av == null || av === false) continue;
          // `attrs` is for attributes. A `style` attribute is blocked by the document's policy
          // and fails silently, so it is refused here rather than rendered and dropped.
          if (ak === 'style') {
            throw new Error('render: set `style` as an object of CSS properties, not as an ' +
              'attribute — an inline style attribute is blocked by this document’s content policy.');
          }
          if (av === true) node.setAttribute(ak, '');
          else node.setAttribute(ak, String(av));
        }
        continue;
      }

      // `style` is an object of CSS properties, applied through the CSSOM. It is never a string
      // and never an attribute, and the difference is not cosmetic: the artifact pins `style-src`
      // to a hash, and a hash-pinned policy blocks `style="..."` — both in the shell markup and
      // when a view sets it with `setAttribute`. That failure is silent: the page renders
      // unstyled and nothing reports why. Assigning through `node.style` is not covered by
      // `style-src`, so it is the route that keeps working. A string here is a mistake, and it
      // throws rather than shipping a rule the policy will drop on the floor.
      if (key === 'style') {
        if (value == null) continue;
        if (typeof value !== 'object') {
          throw new Error('render: `style` takes an object of CSS properties, not a string — ' +
            'an inline style attribute is blocked by this document’s content policy.');
        }
        for (var sk in value) {
          if (!Object.prototype.hasOwnProperty.call(value, sk)) continue;
          if (value[sk] == null) continue;
          node.style.setProperty(kebabCase(sk), String(value[sk]));
        }
        continue;
      }

      // A property that exists on the element is set as a property (checked, value, disabled,
      // hidden, href on an anchor, ...). Setting these as attributes is subtly wrong for form
      // controls — the attribute is the default, the property is the state.
      if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'hidden' ||
          key === 'selected' || key === 'textContent' || key === 'id' || key === 'type') {
        try { node[key] = value; } catch (e) { node.setAttribute(key, String(value)); }
        if (key === 'value') node.setAttribute('value', String(value));
        if (key === 'id') node.setAttribute('id', String(value));
        continue;
      }

      if (key in node) {
        try { node[key] = value; continue; } catch (e) { /* fall through to the attribute */ }
      }
      if (value === null || value === false) continue;
      node.setAttribute(key, value === true ? '' : String(value));
    }

    appendAll(node, children);
    return node;
  }

  function clear(node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  // Replace a node's contents in one step. Views call this instead of hand-managing children,
  // so a stale row cannot survive a re-render.
  function mount(node, children) {
    clear(node);
    appendAll(node, children);
    return node;
  }

  function show(node, visible) {
    if (!node) return node;
    if (visible) node.removeAttribute('hidden');
    else node.setAttribute('hidden', '');
    return node;
  }

  function toggleClass(node, name, on) {
    if (!node) return node;
    if (on) node.classList.add(name);
    else node.classList.remove(name);
    return node;
  }

  // Look up the element a view owns. Missing regions are a build error, not a runtime one, so
  // this throws rather than returning null and letting a view fail silently later.
  function region(id) {
    var node = document.getElementById(id);
    if (!node) throw new Error('render: the shell has no region "' + id + '"');
    return node;
  }

  function byId(id) { return document.getElementById(id); }

  // A button whose handler is attached, never written as an attribute.
  function button(label, onClick, props) {
    var p = {};
    for (var k in (props || {})) if (Object.prototype.hasOwnProperty.call(props, k)) p[k] = props[k];
    p.type = p.type || 'button';
    p.on = p.on || {};
    if (onClick) p.on.click = onClick;
    return el('button', p, p.text == null && label != null ? label : null);
  }

  function labelled(labelText, control) {
    return el('label', { class: 'field' }, [
      el('span', { class: 'field-label', text: labelText }),
      control,
    ]);
  }

  // ---- Markdown, as nodes ----
  //
  // Assistant messages arrive as markdown, and the earlier version turned them into an HTML string
  // with `renderMarkdown` and put it in the DOM with `innerHTML`. That is exactly the seam
  // REQ-701 closes, so this version PARSES TO NODES instead: the same subset, built out of
  // `createElement` and `createTextNode`, with no string that ever becomes markup.
  //
  // The subset is deliberate and small — paragraphs, bullets, headings, bold, italic, code, links.
  // Anything unrecognised stays literal text, which is the safe direction to fail in.

  var INLINE_PATTERN = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+)/g;
  var BULLET = /^\s*[-*+]\s+(.*)$/;
  var HEADING = /^\s*(#{1,6})\s+(.*)$/;

  function markdown(value) {
    var out = frag([]);
    var paragraph = [];
    var bullets = null;

    function flushParagraph() {
      if (!paragraph.length) return;
      out.appendChild(el('p', {}, inline(paragraph.join(' '))));
      paragraph = [];
    }
    function flushBullets() {
      if (!bullets) return;
      out.appendChild(el('ul', {}, bullets));
      bullets = null;
    }

    var lines = String(value == null ? '' : value).replace(/\r\n?/g, '\n').split('\n');
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      if (!line.trim()) { flushParagraph(); flushBullets(); return; }

      var heading = HEADING.exec(line);
      if (heading) {
        flushParagraph(); flushBullets();
        out.appendChild(el('h3', { class: 'md__head' }, inline(heading[2])));
        return;
      }
      var bullet = BULLET.exec(line);
      if (bullet) {
        flushParagraph();
        if (!bullets) bullets = [];
        bullets.push(el('li', {}, inline(bullet[1])));
        return;
      }
      flushBullets();
      paragraph.push(line.trim());
    });
    flushParagraph();
    flushBullets();
    return out;
  }

  function inline(str) {
    var s = String(str);
    var nodes = [];
    var last = 0;
    var m;
    INLINE_PATTERN.lastIndex = 0;
    while ((m = INLINE_PATTERN.exec(s)) !== null) {
      if (m.index > last) nodes.push(text(s.slice(last, m.index)));
      var node = inlineToken(m[0]);
      if (node) nodes.push(node);
      last = m.index + m[0].length;
    }
    if (last < s.length) nodes.push(text(s.slice(last)));
    return nodes;
  }

  function inlineToken(token) {
    if (token.indexOf('**') === 0 || token.indexOf('__') === 0) {
      return el('strong', {}, inline(token.slice(2, -2)));
    }
    if (token.charAt(0) === '`') return el('code', { text: token.slice(1, -1) });
    if (token.charAt(0) === '*') return el('em', {}, inline(token.slice(1, -1)));
    if (token.charAt(0) === '_') return el('em', {}, inline(token.slice(1, -1)));

    var link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
    if (link) {
      // The label is a text node and the href goes through the scheme allowlist (REQ-704), so a
      // link a model invented cannot become `javascript:`.
      return anchor(link[2], link[1]);
    }
    return anchor(token, token);
  }

  function anchor(href, label) {
    var safe = TP.format.linkifyTarget(href);
    if (!safe) return text(label);
    return el('a', { href: safe, rel: 'noreferrer noopener', target: '_blank' }, [label]);
  }

  return {
    el: el,
    text: text,
    frag: frag,
    clear: clear,
    mount: mount,
    append: appendAll,
    show: show,
    toggleClass: toggleClass,
    region: region,
    byId: byId,
    button: button,
    labelled: labelled,
    markdown: markdown,
    isNode: isNode,
  };
})();
