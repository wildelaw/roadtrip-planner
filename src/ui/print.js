// "Print this trip": render the whole trip as a clean page and open the browser's print dialog.
//
// The content is the markdown document (TP.markdown) rendered through the same parser the AI
// transcript uses, so the paper copy and the .md file are one source. The parser renders every
// heading as the same element and discards the level (ui/render.js), so the level is restored here
// from the list the serializer returns alongside the text — the same list the text was written
// from, so the two always agree in length.
//
// Nothing here writes markup: R.mount and R.markdown build nodes, and every trip value is a text
// node. The print stylesheet hides the rest of the app and shows #print-host.

TP.ui.printDocument = (function () {
  'use strict';

  function run() {
    var R = TP.ui.render;
    var host = R.byId('print-host');
    var trip = TP.store.trip();
    if (!host || !trip) return;

    var out = TP.markdown.fromTrip(trip);
    R.mount(host, R.markdown(out.text));

    // Restore the hierarchy the parser flattened. A mismatch — it cannot happen, since both come
    // from one call — leaves the document flat rather than mislabelling a heading.
    var heads = host.querySelectorAll('.md__head');
    if (heads.length === out.headings.length) {
      for (var i = 0; i < heads.length; i++) {
        var level = out.headings[i].level;
        if (level >= 1 && level <= 6) heads[i].classList.add('print-head', 'print-head--' + level);
      }
    }

    var done = function () {
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('printing');
      R.clear(host);
    };
    document.body.classList.add('printing');
    window.addEventListener('afterprint', done);

    if (typeof window.print === 'function') window.print();
    else done();
    // Where print() blocks until the dialog is answered, `afterprint` clears first and this is a
    // no-op. Where it returns early, the listener clears when the dialog closes. If a browser
    // fires neither, the content is display:none and the next print remounts it — no harm done.
  }

  return run;
})();
