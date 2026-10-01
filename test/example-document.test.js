// The example document, held to the same standard as the artifact (specs/09-testing.md §8).
//
// `West-Cost-Road-Trip.html` is the repository's one committed DOCUMENT: a trip, its history, and the
// program that edits them, in one file. Nothing rebuilds it — `node build.js` writes `dist/`, not
// this — and nothing else in the suite opens it, so without this file it could rot in silence and the
// person who found out would be someone who opened it expecting a trip.
//
// It is a document FROM THE PAST on purpose: it carries the program as it stood when it was exported,
// which is what makes it self-contained. So nothing here compares it to what `src/` says today. What
// is asserted is that it holds together on its own terms — its own hash over its own program, its own
// chain, its own trip — which is exactly what the app checks before it will offer a download
// (REQ-508), applied to the file as it sits in the tree.

'use strict';

var crypto = require('crypto');
var h = require('./harness.js');

var FILE = 'West-Cost-Road-Trip.html';

// The artifact split into markup and program, the same way test/artifact.test.js splits it: a rule
// about what the DOCUMENT references must not be applied to the program's own text, where `src` is a
// variable name.
function split(html) {
  var open = '<script id="app-script">';
  var at = html.indexOf(open);
  if (at === -1) throw new h.AssertionError('the example carries no program script');
  var start = at + open.length;
  var end = html.indexOf('<' + '/script', start);
  if (end === -1) throw new h.AssertionError('the example’s program script is not closed');
  return {
    markup: html.slice(0, start) + html.slice(end),
    program: html.slice(start, end),
  };
}

function meta(html, name) {
  var m = new RegExp('<meta name="' + name + '" content="([^"]*)"').exec(html);
  return m ? m[1] : null;
}

function policy(html) {
  var m = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html);
  return m ? m[1] : null;
}

function digestOf(program) {
  return 'sha256-' + crypto.createHash('sha256').update(program, 'utf8').digest('base64');
}

module.exports = {
  name: 'the example document (REQ-405, REQ-507, REQ-508)',

  tests: [
    {
      name: 'the example opens: its block parses, its history verifies, and its trip is the one its name says',
      run: function () {
        var TP = h.pure({}).TP;
        var text = h.read(FILE);

        // The block is found by scanning the TEXT, which is the path every reader uses — including
        // the untrusted one — so a block the app could not find is a block this test cannot find.
        var block = TP.container.scanBlock(text);
        h.ok(block, 'the example carries no data block, so it is not a document');

        var container = TP.container.validate(TP.container.parseBlock(block));
        h.equal(TP.container.isReadableFormat(container.format), true,
          'the example is in format ' + container.format + ', which this version cannot read — it would open read-only');

        var chain = TP.verify.chain(container.history);
        h.ok(chain.ok, 'the example’s history does not hold together: ' +
          ((chain.errors[0] && TP.verify.shortId(chain.errors[0].commitId) + ' ' + chain.errors[0].problem) || 'no reason recorded'));
        h.equal(chain.checked, container.history.commits.length, 'the chain was not checked to the end');

        var rebuilt = TP.verify.payload(container.history);
        h.ok(rebuilt.ok, 'the example’s contents do not rebuild from its own history');

        var trip = TP.container.payloadTrip(container);
        h.ok(trip, 'the example carries no trip');
        h.ok((trip.days || []).length > 0, 'the example’s trip has no days in it');

        // The filename is a claim about what is in the file, and it is the whole of what a person
        // browsing the repository has to go on.
        h.equal(
          String(TP.model.tripTitle(trip)).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          FILE.replace(/\.html$/, '').toLowerCase(),
          'the example is not the trip its filename names: ' + TP.model.tripTitle(trip)
        );

        // Self-consistency, which is the one thing a stale example must not lose: the hashes in the
        // file describe the program IN the file. Regenerating the example keeps this true; editing
        // it by hand does not, and that is the point.
        var program = split(text).program;
        var digest = digestOf(program);
        h.equal(container.build.appHash, digest,
          'the example’s data block declares a build hash that is not the hash of the program it carries');
        h.equal(meta(text, 'app-hash'), digest,
          'the example’s meta tag and its data block disagree about which program it carries');
        h.ok(String(policy(text)).indexOf(digest) !== -1,
          'the example’s content policy does not pin the program it carries, so its own script would be refused');
      },
    },

    {
      name: 'the example is self-contained: two scripts, nothing fetched, and no markup its browser added',
      run: function () {
        // The lesson this test was written from. The file that prompted it was saved by a browser
        // whose own extension had injected a `<script src="moz-extension://…">` into the page before
        // the pristine copy was taken at boot, so every export from that browser carried it — a
        // reference to an extension nobody else has, which the document's own policy then refused at
        // load with a console error. A document has to be the app's bytes and the user's trip, and
        // nothing else.
        var text = h.read(FILE);
        var parts = split(text);

        // Counted in the MARKUP, not the file: the program's own text mentions a `<script>` tag in a
        // comment about how the data block is located, and a rule over the whole file would count the
        // documentation as markup.
        var scripts = parts.markup.match(/<script\b[^>]*>/gi) || [];
        h.equal(scripts.length, 2,
          'the example carries ' + scripts.length + ' script elements, not two: ' + scripts.join(' '));
        scripts.forEach(function (tag) {
          h.ok(!/\ssrc\s*=/i.test(tag), 'the example fetches a script rather than carrying it: ' + tag);
        });

        h.ok(!/\ssrc\s*=/i.test(parts.markup),
          'the example carries markup that loads something external, so it is not one file');
        h.ok(!/<link\b/i.test(parts.markup), 'the example links a stylesheet rather than inlining it');
        h.ok(!/\son[a-z]+\s*=\s*["']/i.test(parts.markup), 'the example carries an inline event handler');
        h.ok(!/moz-extension|chrome-extension|webkit-extension|safari-extension/i.test(text),
          'the example carries a script injected by the browser it was saved from');
      },
    },
  ],
};
