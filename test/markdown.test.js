// The markdown parser in the render seam (specs/07-ui.md §2, REQ-701).
//
// `TP.ui.render.markdown` turns an assistant message into DOM nodes, and its one caller is the AI
// panel's message bubble. This file exists because it did not, and that absence shipped a defect
// that took the browser down.
//
// `inline` recurses — bold and italic call back into it — and the earlier version iterated ONE
// module-level `g` regex. The recursive call reset `lastIndex` to 0 on entry and the spec resets it
// again when its own `exec` fails, so the outer loop resumed from 0 and re-matched the token it had
// just consumed. `m.index > last` was then false, so nothing advanced and no text was added: it
// pushed a `<strong>`/`<em>` subtree per turn, forever. Any assistant message containing `**bold**`
// or `*italic*` — which a cloud model emits constantly — froze the tab at ~32 GB. `code` and links
// were unharmed, because those branches do not recurse. That is why only some messages hung.
//
// A NOTE ON THE FAILURE MODE. What this file guards against is a synchronous infinite loop, so a
// regression does not fail an assertion — it HANGS. `test/run.js` runs each file in a child process
// with a 300 s timeout (`test/run.js:95-98`), so the symptom is this one file reported as killed,
// with every other file still running. If this file ever shows a case name with no result beside it,
// that case is the loop.
//
// The DOM is stubbed, and deliberately: the document is the platform here, not the thing under
// test. What is under test is the parser — which pattern matches what, and whether the loop
// terminates — and that is the same code the artifact runs.

'use strict';

var h = require('./harness.js');

// ---- The realm, with a document ----

// The real fragment chain up to and including `ui/render.js`, so `TP.format.linkifyTarget` and the
// rest of the render seam are the shipped ones. `h.pure` gives the realm no `document` (it is a Node
// realm, and `render.js` reaches for one only inside a function, never at load), so there is exactly
// one thing to supply — and it is supplied before anything is rendered.
function realm() {
  var ctx = h.pure({ end: 'ui/render.js', protocol: 'https:' });
  ctx.document = dom();
  return ctx.TP;
}

function dom() {
  function node(tag) {
    var n = {
      nodeType: 1,
      tagName: tag,
      childNodes: [],
      attributes: {},
      style: { setProperty: function (k, v) { this[k] = v; } },
      dataset: {},
      classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
      setAttribute: function (k, v) { this.attributes[k] = String(v); },
      removeAttribute: function (k) { delete this.attributes[k]; },
      getAttribute: function (k) { return k in this.attributes ? this.attributes[k] : null; },
      appendChild: function (child) { this.childNodes.push(child); return child; },
      removeChild: function (child) {
        var at = this.childNodes.indexOf(child);
        if (at !== -1) this.childNodes.splice(at, 1);
        return child;
      },
      addEventListener: function () {},
    };
    // `clear` walks `firstChild`, so it has to be live rather than a stored field.
    Object.defineProperty(n, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
    return n;
  }
  return {
    createElement: node,
    createElementNS: function (ns, tag) { return node(tag); },
    createTextNode: function (value) { return { nodeType: 3, textContent: String(value) }; },
    createDocumentFragment: function () { return node('#fragment'); },
    getElementById: function () { return null; },
  };
}

// The tag names of a node's children, with text written as `#text` — so one comparison says both
// what was built and what order it is in.
function shape(n) {
  return n.childNodes.map(function (c) { return c.tagName || '#text'; });
}

// The first block of the fragment `markdown` returns: every case below is a single block, so it is
// one paragraph, one heading or one list.
function block(out) { return out.childNodes[0]; }

module.exports = {
  name: 'the markdown parser (REQ-701)',

  tests: [
    {
      // The regression itself. These inputs did not fail before — they never returned.
      name: 'bold and italic terminate, and become the right elements (REQ-701)',
      run: function () {
        var TP = realm();
        var md = TP.ui.render.markdown;

        [['**bold**', 'strong', 'bold'],
         ['__bold__', 'strong', 'bold'],
         ['*italic*', 'em', 'italic'],
         ['_italic_', 'em', 'italic']].forEach(function (c) {
          h.equal(shape(md(c[0])).join(), 'p', c[0] + ' did not become one paragraph');
          var span = block(md(c[0])).childNodes[0];
          h.equal(span.tagName, c[1], c[0] + ' did not become a ' + c[1]);
          h.equal(shape(span).join(), '#text', c[0] + ' gained children it should not have');
          h.equal(span.childNodes[0].textContent, c[2],
            c[0] + ' lost its text on the way into the ' + c[1]);
        });
      },
    },

    {
      name: 'text around and between spans is kept, in order (REQ-701)',
      run: function () {
        var TP = realm();
        var p = block(TP.ui.render.markdown('Some **important** advice.'));

        h.equal(shape(p).join(), '#text,strong,#text', 'the span did not land between its text');
        h.equal(p.childNodes[0].textContent, 'Some ', 'the text before the span was changed');
        h.equal(p.childNodes[1].childNodes[0].textContent, 'important', 'the span holds the wrong text');
        h.equal(p.childNodes[2].textContent, ' advice.', 'the text after the span was changed');

        // Two spans in one line. The second is where a stale `lastIndex` used to re-match, so a
        // single-span case alone would not have caught this.
        var both = block(TP.ui.render.markdown('a **b** c *d* e'));
        h.equal(shape(both).join(), '#text,strong,#text,em,#text', 'two spans in a line were mis-parsed');
        h.equal(both.childNodes[3].childNodes[0].textContent, 'd', 'the italic span holds the wrong text');
      },
    },

    {
      name: 'markup nests, and the inner call does not disturb the outer (REQ-701)',
      run: function () {
        var TP = realm();
        var md = TP.ui.render.markdown;

        var code = block(md('**bold with `code` inside**'));
        h.equal(shape(code).join(), 'strong', 'the outer span was not built');
        h.equal(shape(code.childNodes[0]).join(), '#text,code,#text', 'the code span inside bold was lost');
        h.equal(code.childNodes[0].childNodes[1].childNodes[0].textContent, 'code',
          'the nested code span holds the wrong text');

        // A span inside a span: the inner `inline` call is the one that used to reset the outer loop.
        var nested = block(md('**_very important_**'));
        h.equal(shape(nested).join(), 'strong', 'the outer span was not built');
        h.equal(shape(nested.childNodes[0]).join(), 'em', 'the italic span inside bold was lost');
        h.equal(nested.childNodes[0].childNodes[0].childNodes[0].textContent, 'very important',
          'the nested span holds the wrong text');
      },
    },

    {
      // The branches that never recursed, and so never hung. They must keep working: a fix that
      // changed their output would be a fix that broke the safe half of the parser.
      name: 'code and links are unaffected (REQ-701, REQ-704)',
      run: function () {
        var TP = realm();
        var md = TP.ui.render.markdown;

        var p = block(md('Use `npm test` now.'));
        h.equal(shape(p).join(), '#text,code,#text', 'a code span was lost');
        h.equal(p.childNodes[1].childNodes[0].textContent, 'npm test', 'the code span holds the wrong text');

        var link = block(md('See [the docs](https://example.com/guide).'));
        h.equal(shape(link).join(), '#text,a,#text', 'a link was lost');
        var a = link.childNodes[1];
        h.equal(a.childNodes[0].textContent, 'the docs', 'the link label was lost');
        // The label is a text node and the target goes through the scheme allowlist (REQ-704), so a
        // link a model invented cannot become `javascript:`.
        h.equal(a.getAttribute('href'), 'https://example.com/guide', 'the link target was lost');
        h.equal(a.getAttribute('rel'), 'noreferrer noopener', 'the link lost its rel');
      },
    },

    {
      name: 'headings, bullets and plain text still render as before (REQ-701)',
      run: function () {
        var TP = realm();
        var md = TP.ui.render.markdown;

        var head = block(md('## Day two'));
        h.equal(head.tagName, 'h3', 'a heading did not become an h3');
        h.equal(head.childNodes[0].textContent, 'Day two', 'the heading lost its text');

        var list = block(md('- **Breakfast** at the hotel\n- Walk the old town'));
        h.equal(list.tagName, 'ul', 'bullets did not become a list');
        h.equal(shape(list).join(), 'li,li', 'the list lost a bullet');
        h.equal(shape(list.childNodes[0])[0], 'strong', 'bold inside a bullet was lost');
        h.equal(list.childNodes[0].childNodes[0].childNodes[0].textContent, 'Breakfast',
          'the bold bullet holds the wrong text');

        var plain = block(md('Nothing special here.'));
        h.equal(shape(plain).join(), '#text', 'plain text did not stay plain text');
        h.equal(plain.childNodes[0].textContent, 'Nothing special here.', 'plain text was changed');
      },
    },

    {
      // The shape of the message that froze the browser: a summary with bold, a heading and a list.
      // One line with bold is enough to hang, so this is what a real reply looks like.
      name: 'a realistic assistant reply renders (REQ-701)',
      run: function () {
        var TP = realm();
        var out = TP.ui.render.markdown([
          '## What I planned',
          '',
          'I have written a **three-day** itinerary for your trip, with the **key stops** placed.',
          '',
          '- **Day 1** — arrival and the old town',
          '- **Day 2** — the coast road, `~120 mi` of driving',
          '- **Day 3** — departure',
          '',
          'Sources: [park info](https://example.com/park) and https://example.com/roads',
        ].join('\n'));

        h.equal(shape(out).join(), 'h3,p,ul,p', 'the reply did not build the expected blocks');
        h.equal(block(out).tagName, 'h3', 'the heading was lost');
        h.equal(out.childNodes[2].tagName, 'ul', 'the bullet list was lost');
        h.equal(shape(out.childNodes[1]).join(), '#text,strong,#text,strong,#text',
          'bold in the summary paragraph was lost');
        // A bare URL becomes a link through the allowlist (REQ-704), not literal text.
        h.equal(shape(out.childNodes[3]).join(), '#text,a,#text,a', 'the source links were lost');
      },
    },
  ],
};
