// Charging (specs/03 §2.4).
//
// This tab exists only for a trip with a vehicle, which is also what makes it EV mode: the tab
// list is a filter over `TP.model.isEv(trip)`, not a separate setting to keep in step
// (REQ-603's existing mechanism, specs/07-ui.md §5).

TP.ui.charging = (function () {
  'use strict';

  var R = null;
  function r() { R = R || TP.ui.render; return R; }

  var SEVERITY = ['danger', 'warn', 'info'];

  function render(root) {
    var trip = TP.store.trip();

    if (!TP.model.isEv(trip)) {
      r().append(root, r().el('div', { class: 'empty' }, [
        r().el('h2', { text: 'This is not an electric-vehicle trip' }),
        r().el('p', { text: 'Give the trip a vehicle in the itinerary header and this tab fills up.' }),
        r().button('Open the itinerary', function () { TP.ui.shell.setTab('itinerary'); }, { class: 'btn' }),
      ]));
      return;
    }

    r().append(root, vehicleCard(trip));
    r().append(root, networksCard(trip));
    r().append(root, thresholdsCard(trip));
    r().append(root, dayPlanCard(trip));
  }

  function vehicleCard(trip) {
    var v = trip.vehicle || {};
    var rows = [
      ['Model', v.model],
      ['Convention', v.chargingConvention],
      ['Battery', v.batteryKWh == null ? null : v.batteryKWh + ' kWh'],
      ['Full range', v.fullRangeMiles == null ? null : v.fullRangeMiles + ' mi'],
      ['Usable range', v.usableRangeMiles == null ? null : v.usableRangeMiles + ' mi'],
      ['Efficiency', v.efficiencyMilesPerKWh == null ? null : v.efficiencyMilesPerKWh + ' mi/kWh'],
    ].filter(function (row) { return row[1] != null && row[1] !== ''; });

    var inputs = {};
    ['batteryKWh', 'fullRangeMiles', 'usableRangeMiles', 'efficiencyMilesPerKWh', 'chargingConvention'].forEach(function (key) {
      inputs[key] = r().el('input', {
        class: 'input',
        type: key === 'chargingConvention' ? 'text' : 'number',
        value: v[key] == null ? '' : v[key],
        attrs: { step: 'any' },
      });
      inputs[key].addEventListener('change', function () {
        var raw = inputs[key].value;
        TP.store.edit('Change the vehicle', function (t) {
          if (!t.vehicle) t.vehicle = { model: '' };
          if (raw === '') delete t.vehicle[key];
          else t.vehicle[key] = key === 'chargingConvention' ? raw : Number(raw);
        });
        TP.ui.shell.renderActive();
      });
    });

    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: '🔋 ' + (v.model || 'Vehicle') }),
        r().el('span', { class: 'subtle', text: 'These numbers drive the range notes below' }),
      ]),
    ]);

    if (rows.length) {
      r().append(card, r().el('dl', { class: 'kv' }, rows.reduce(function (acc, row) {
        acc.push(r().el('dt', { text: row[0] }), r().el('dd', { text: String(row[1]) }));
        return acc;
      }, [])));
    }

    r().append(card, r().el('div', { class: 'row mt' }, [
      r().el('div', { class: 'field' }, [r().el('label', { text: 'Battery (kWh)' }), inputs.batteryKWh]),
      r().el('div', { class: 'field' }, [r().el('label', { text: 'Full range (mi)' }), inputs.fullRangeMiles]),
    ]));
    r().append(card, r().el('div', { class: 'row' }, [
      r().el('div', { class: 'field' }, [r().el('label', { text: 'Usable range (mi)' }), inputs.usableRangeMiles]),
      r().el('div', { class: 'field' }, [r().el('label', { text: 'Efficiency (mi/kWh)' }), inputs.efficiencyMilesPerKWh]),
    ]));
    r().append(card, r().el('div', { class: 'field' }, [
      r().el('label', { text: 'Plug convention' }),
      inputs.chargingConvention,
      r().el('div', { class: 'subtle', text: 'NACS, CCS, or whatever the car takes. This is a note to yourself.' }),
    ]));

    return card;
  }

  function networksCard(trip) {
    return TP.ui.tripEditor.collectionCard({
      trip: trip,
      key: 'chargingNetworks',
      title: 'Charging networks',
      editLabel: 'Change charging networks',
      empty: 'Networks you expect to use, and where. Note which ones need an adapter.',
      blank: function () { return { id: TP.uid(), name: '', location: '', network: '', adapter: '' }; },
      columns: [
        { key: 'name', label: 'Name', placeholder: 'Supercharger — Barstow' },
        { key: 'location', label: 'Where' },
        { key: 'network', label: 'Network', placeholder: 'Tesla, Electrify America' },
        { key: 'adapter', label: 'Adapter needed', type: 'checkbox' },
        { key: 'notes', label: 'Notes' },
      ],
    }).card;
  }

  function thresholdsCard(trip) {
    var days = trip.days || [];
    return TP.ui.tripEditor.collectionCard({
      trip: trip,
      key: 'minSocThresholds',
      title: 'Minimum charge to keep',
      editLabel: 'Change charge thresholds',
      empty: 'Legs where you do not want to go below a certain charge — long climbs, gaps between chargers.',
      blank: function () { return { id: TP.uid(), day: days[0] ? days[0].date : '', leg: '', minSoc: 20, reason: '', severity: 'warn' }; },
      columns: [
        {
          key: 'day', label: 'Day', type: 'select',
          options: days.map(function (d, i) { return { value: d.date, label: 'Day ' + (i + 1) + ' — ' + TP.dates.fmtDate(d.date) }; }),
        },
        { key: 'leg', label: 'Leg', placeholder: 'Barstow → Needles' },
        { key: 'minSoc', label: 'Min %', type: 'number' },
        { key: 'reason', label: 'Why' },
        { key: 'severity', label: 'Seriousness', type: 'select', options: SEVERITY },
      ],
    }).card;
  }

  // The plan, day by day: the charge stops and the thresholds that apply to that date.
  function dayPlanCard(trip) {
    var days = (trip.days || []).filter(function (d) {
      var hasCharge = (d.items || []).some(function (i) { return i.flags && i.flags.charge; });
      var hasThreshold = (trip.minSocThresholds || []).some(function (t) { return t.day === d.date; });
      return hasCharge || hasThreshold;
    });

    var card = r().el('div', { class: 'card' }, [
      r().el('div', { class: 'card__head' }, [
        r().el('h2', { text: 'Day by day' }),
        r().el('span', { class: 'subtle', text: days.length ? TP.format.plural(days.length, 'day') + ' with charging' : 'Nothing to plan' }),
      ]),
    ]);

    if (!days.length) {
      r().append(card, r().el('p', { class: 'subtle mb0', text:
        'No day has a charge stop or a minimum-charge rule yet. Mark an itinerary item as a charge ' +
        'stop, or add a threshold above, and it appears here.' }));
      return card;
    }

    days.forEach(function (day) {
      // The day's number is its position in the TRIP, not in this filtered list: the threshold
      // editor above numbers days that way, and a trip whose only charge stop is on day 4 was
      // labelled "Day 1" here beside its own date.
      var dayNumber = (trip.days || []).indexOf(day) + 1;
      var stops = (day.items || []).filter(function (i) { return i.flags && i.flags.charge; });
      var thresholds = (trip.minSocThresholds || []).filter(function (t) { return t.day === day.date; });
      r().append(card, r().el('div', { class: 'sect-sep' }, [
        r().el('div', { class: 'flex flex--between' }, [
          r().el('strong', { text: 'Day ' + (dayNumber || '?') + ' — ' + TP.dates.fmtDate(day.date) }),
          day.drive ? r().el('span', { class: 'subtle', text: day.drive }) : null,
        ]),
        stops.length
          ? r().el('div', { class: 'item__meta', text: '⚡ ' + stops.map(function (s) {
            return (s.title || 'Charge stop') + (s.flags && s.flags.minSoc ? ' (min ' + s.flags.minSoc + '%)' : '');
          }).join(' · ') })
          : null,
        thresholds.map(function (t) {
          var cls = t.severity === 'danger' ? 'high' : t.severity === 'warn' ? 'med' : 'low';
          return r().el('div', { class: 'item__meta' }, [
            r().el('span', { class: 'badge badge--' + cls, text: String(t.minSoc == null ? '?' : t.minSoc) + '%' }),
            ' ' + (t.leg || '') + (t.reason ? ' — ' + t.reason : ''),
          ]);
        }),
      ]));
    });

    return card;
  }

  return {
    render: render,
    SEVERITY: SEVERITY,
  };
})();
