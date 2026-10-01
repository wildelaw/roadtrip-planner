// Lodging: where you sleep each night (specs/03 §2.4).
//
// Nights and the days a stay covers are DERIVED from check-in and check-out, never stored
// (03-data-model.md §2.3): a stored `nights` beside a pair of dates is two truths, and the
// first merge would have to guess which one to believe.

TP.ui.lodging = (function () {
  'use strict';

  var R = null;
  function r() { R = R || TP.ui.render; return R; }

  function nightsOf(stay) {
    if (!stay.checkIn || !stay.checkOut) return null;
    var n = TP.dates.daysBetween(stay.checkIn, stay.checkOut);
    return n > 0 ? n : 0;
  }

  function render(root) {
    var trip = TP.store.trip();
    var stays = (trip.lodging || []).slice().sort(function (a, b) {
      return String(a.checkIn || '').localeCompare(String(b.checkIn || ''));
    });

    var nights = stays.reduce(function (sum, s) { var n = nightsOf(s); return sum + (n == null ? 0 : n); }, 0);
    var uncounted = stays.filter(function (s) { return nightsOf(s) == null; }).length;
    var gaps = uncoveredNights(trip, stays);

    var intro = r().el('div', {}, [
      r().el('p', { class: 'subtle', text: nights
        ? nights + (nights === 1 ? ' night' : ' nights') + ' covered by ' + TP.format.plural(stays.length, 'stay') + '.'
        : 'Where you are sleeping each night. Check-in and check-out are what the app counts from.' }),
      uncounted
        ? r().el('div', { class: 'info info--warn', text: uncounted +
          (uncounted === 1 ? ' stay has no check-in or check-out yet, so it counts for no nights.' : ' stays have no check-in or check-out yet, so they count for no nights.') })
        : null,
      gaps.length
        ? r().el('div', { class: 'info', text: 'No stay is recorded for: ' + gaps.map(TP.dates.fmtDate).join(', ') + '.' })
        : null,
    ]);

    var card = TP.ui.tripEditor.collectionCard({
      trip: trip,
      key: 'lodging',
      title: 'Lodging',
      editLabel: 'Change lodging',
      empty: 'No stays yet. Add the first place you sleep.',
      blank: function () {
        return { id: TP.uid(), location: '', checkIn: trip.startDate || null, checkOut: null, area: '', notes: '', confirmation: '' };
      },
      columns: [
        { key: 'location', label: 'Place', placeholder: 'Hotel, campsite, a friend\'s couch' },
        { key: 'checkIn', label: 'Check in', type: 'date' },
        { key: 'checkOut', label: 'Check out', type: 'date' },
        { label: 'Nights', derive: function (row) { var n = nightsOf(row); return n == null ? '' : String(n); } },
        { key: 'area', label: 'Area' },
        { key: 'confirmation', label: 'Confirmation' },
        { key: 'notes', label: 'Notes' },
      ],
    });

    r().append(root, r().el('div', { class: 'card' }, [intro]));
    r().append(root, card.card);
  }

  // Which trip days have no bed attached. Not an error — a question worth asking out loud.
  function uncoveredNights(trip, stays) {
    var days = (trip.days || []).map(function (d) { return d.date; }).filter(Boolean);
    if (!days.length) return [];
    var covered = Object.create(null);
    stays.forEach(function (s) {
      if (!s.checkIn || !s.checkOut) return;
      days.forEach(function (date) {
        if (date >= s.checkIn && date < s.checkOut) covered[date] = true;
      });
    });
    // The last day is a travelling-out day, not a night, so it is not required to have a bed.
    return days.slice(0, -1).filter(function (d) { return !covered[d]; });
  }

  return {
    render: render,
    nightsOf: nightsOf,
    uncoveredNights: uncoveredNights,
  };
})();
