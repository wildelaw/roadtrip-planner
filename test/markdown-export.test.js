// The printable plan (TP.markdown) — the whole trip as one markdown document.
//
// This is not an interchange format: nothing imports it and it does not round-trip, so there is no
// ledger column and no canonical comparison here. What is worth checking is different: that the
// document carries the free-text fields a person needs on paper (there is no phone field and no
// address field in the model — phones live in `contacts[].how`, addresses in `lodging.location`
// and `item.location`, and confirmations on `lodging` and items), that a value cannot restructure
// the document by carrying a newline, and that only the markdown subset the print view's parser
// understands is emitted.
//
// The realm is `h.pure()`, which ends at `io/export.js` and has no `document` — so any accidental
// DOM reach in the serializer throws rather than passing.

'use strict';

var h = require('./harness.js');

function realm() { return h.pure().TP; }

function lines(text) { return String(text).split('\n'); }

function headingLines(text) {
  return lines(text).filter(function (l) { return /^#{1,6}\s/.test(l); });
}

function bulletLines(text) {
  return lines(text).filter(function (l) { return /^\s*[-*+]\s/.test(l); });
}

module.exports = {
  name: 'the printable plan (markdown export)',

  tests: [
    {
      name: 'the serializer and the export wrapper return what delivery needs',
      run: function () {
        var TP = realm();
        var trip = h.maximalTrip(TP, 'X');

        var out = TP.markdown.fromTrip(trip);
        h.ok(out.text && out.text.length, 'the document is empty');
        h.ok(Array.isArray(out.headings) && out.headings.length, 'no heading list — the print view cannot restore levels');
        h.ok(Array.isArray(out.losses) && out.losses.length, 'no disclosure list');

        var result = TP.io.export.markdown(trip);
        h.equal(result.ok, true, 'the export reported a failure');
        h.equal(result.mime, 'text/markdown', 'the mime type is wrong');
        h.ok(/\.md$/.test(result.filename), 'the filename is not .md: ' + result.filename);
        h.ok(result.losses && result.losses.length, 'the export dropped its disclosure');
        h.equal(result.text, out.text, 'the wrapper and the serializer disagree');
      },
    },

    {
      name: 'a hostile trip title cannot escape the download filename',
      run: function () {
        var TP = realm();
        var name = TP.io.export.filenameFor('a/b:c*d?e"f<g>h|i', 'md');
        h.equal(name.indexOf('/'), -1, 'a path separator survived: ' + name);
        h.equal(name.indexOf('\\'), -1, 'a backslash survived: ' + name);
        h.ok(/\.md$/.test(name), 'the extension was lost: ' + name);
      },
    },

    {
      // The requirement in one case: the phone numbers, addresses and confirmation numbers a person
      // needs on paper all reach the document.
      name: 'phone numbers, addresses and confirmation numbers reach the page',
      run: function () {
        var TP = realm();
        var trip = h.maximalTrip(TP, 'X');

        trip.contacts = [{ id: 'c1', what: 'Hotel desk', how: '+1 555 0100' }];
        trip.lodging = [{
          id: 'l1', location: '12 Main St, Springfield', area: 'Old Town',
          checkIn: '2026-09-01', checkOut: '2026-09-02',
          confirmation: 'CONF-9931', notes: 'late arrival',
        }];
        trip.days[0].stay = 'Riverside Lodge';
        trip.days[0].items = [{
          id: 'i1', title: 'Dinner', time: '19:00', location: '9 Pier Rd',
          confirmation: 'RSV-77', flags: {},
        }];

        var text = TP.markdown.fromTrip(trip).text;

        ['+1 555 0100', '12 Main St, Springfield', 'Old Town', 'CONF-9931',
          'Riverside Lodge', '9 Pier Rd', 'RSV-77'].forEach(function (needle) {
          h.ok(text.indexOf(needle) !== -1, 'the document is missing ' + JSON.stringify(needle));
        });

        h.ok(text.indexOf('## Contacts') !== -1, 'there is no Contacts section');
        h.ok(text.indexOf('Hotel desk') !== -1, 'the contact is not named');
        h.ok(text.indexOf('Confirmation: CONF-9931') !== -1, 'the lodging confirmation is not labelled');
        h.ok(text.indexOf('confirmation RSV-77') !== -1, 'the item confirmation is not labelled');
      },
    },

    {
      // The structural defence: a value with line breaks, heading markers or bullet markers must
      // not add, remove or re-type a line. It is folded, not escaped — the parser honours no
      // backslash escapes, so escaping would corrupt the text.
      name: 'a value containing markdown structure cannot restructure the document',
      run: function () {
        var TP = realm();

        function variant(value) {
          var trip = h.maximalTrip(TP, 'Z');
          trip.lodging = [{ id: 'l1', location: value, confirmation: value }];
          return TP.markdown.fromTrip(trip).text;
        }

        var benign = variant('Zed');
        var hostile = variant('# Injected\n- Injected\n## Deep *em* `code` | pipe <b>x</b> ' + String.fromCharCode(0x2028) + ' tail');

        h.equal(lines(hostile).length, lines(benign).length, 'a value changed the number of lines');
        h.equal(headingLines(hostile).length, headingLines(benign).length, 'a value added a heading');
        h.equal(bulletLines(hostile).length, bulletLines(benign).length, 'a value added a bullet');
        h.equal(lines(hostile).indexOf('# Injected'), -1, 'a value opened a heading');
        h.equal(lines(hostile).indexOf('- Injected'), -1, 'a value opened a bullet');
        h.equal(headingLines(hostile).indexOf('## Deep *em* `code` | pipe <b>x</b>'), -1,
          'a value opened a section');
        h.equal(hostile.indexOf('&lt;'), -1, 'the value was HTML-escaped on the way out');
        h.equal(hostile.indexOf('&#'), -1, 'the value was entity-escaped on the way out');
      },
    },

    {
      // The print view feeds this text to TP.ui.render.markdown, which understands headings,
      // bullets, paragraphs, bold, code and links — and nothing else. Emitting a construct it does
      // not parse would print as literal punctuation.
      name: 'only markdown the print parser understands is emitted',
      run: function () {
        var TP = realm();
        var text = TP.markdown.fromTrip(h.maximalTrip(TP, 'X')).text;

        lines(text).forEach(function (line) {
          h.ok(!/^\s*>/.test(line), 'a blockquote was emitted: ' + line);
          h.ok(!/^\s*\|/.test(line) && line.indexOf(' | ') === -1, 'a table row was emitted: ' + line);
          h.ok(!/^\s*\d+\.\s/.test(line), 'an ordered item was emitted: ' + line);
          h.ok(!/^\s*[-*_]{3,}\s*$/.test(line), 'a horizontal rule was emitted: ' + line);
          h.ok(!/^\s+[-*+]\s/.test(line), 'an indented (nested) bullet was emitted: ' + line);
          h.equal(line.indexOf('```'), -1, 'a code fence was emitted: ' + line);
        });
      },
    },

    {
      name: 'the same trip produces the same document',
      run: function () {
        var TP = realm();
        var trip = h.maximalTrip(TP, 'X');
        h.equal(TP.markdown.fromTrip(trip).text, TP.markdown.fromTrip(trip).text, 'the output is not deterministic');
      },
    },

    {
      name: 'an empty trip produces a document, not a crash',
      run: function () {
        var TP = realm();
        var text = TP.markdown.fromTrip(TP.model.newTrip({})).text;
        h.ok(text.length, 'an empty trip produced nothing at all');
        h.equal(text.indexOf('undefined'), -1, 'a literal "undefined" leaked into the document');
        h.equal(text.indexOf('[object Object]'), -1, 'an object leaked into the document');
      },
    },

    {
      // doExport renders the disclosure box whenever `losses` is non-empty, from
      // disclosures(format).text — so a format with losses and no branch would show an empty box.
      name: 'the markdown disclosure is wired to the dialog',
      run: function () {
        var TP = realm();
        var disc = TP.io.export.disclosures('markdown');
        h.deepEqual(disc.items, TP.markdown.losses(), 'the dialog and the format disagree about what is lost');
        h.ok(disc.text.length, 'the disclosure text is empty');
        h.ok(disc.text.indexOf('cannot carry') !== -1, 'the disclosure does not say what it is for');
      },
    },

    {
      // The print view restores heading levels by zipping this list against the rendered headings,
      // so the two must agree in number and order or the hierarchy would be mislabelled.
      name: 'the heading list matches the headings in the text, in order',
      run: function () {
        var TP = realm();
        var out = TP.markdown.fromTrip(h.maximalTrip(TP, 'X'));
        var heads = headingLines(out.text);

        h.equal(heads.length, out.headings.length, 'the heading list does not match the text');
        out.headings.forEach(function (head, i) {
          var prefix = new Array(head.level + 1).join('#') + ' ';
          h.equal(heads[i].slice(0, prefix.length), prefix, 'wrong level at heading ' + i);
          h.equal(heads[i].slice(prefix.length), head.text, 'wrong text at heading ' + i);
        });
      },
    },
  ],
};
