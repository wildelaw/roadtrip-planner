// The printable plan: the whole trip as one markdown document (specs/07-ui.md, "Print this trip").
//
// This is NOT an interchange format. Nothing imports it, it does not round-trip, and it is not in
// the ledger: it is a rendering of the model for a person to read on paper. So it does not go
// through TP.ledger, and the only loss it declares is machine-only metadata (see losses()).
//
// It emits a SUBSET of markdown on purpose — blank-line separators, #–### headings, flat `- `
// bullets and `**bold**` labels — because the same text is fed to TP.ui.render.markdown for the
// print view, and that parser (ui/render.js) understands exactly this subset. It does not
// understand tables, blockquotes, horizontal rules, ordered lists, nested lists or code fences, so
// none are emitted. Keeping to the subset is what lets one serializer serve both surfaces.
//
// Pure: TP.dates, TP.format and TP.model only — no DOM, so the test harness's h.pure() realm can
// load it.

TP.markdown = (function () {
  'use strict';

  // ---- Values ----

  // The line terminators, built by character code rather than written as escapes: U+2028 and
  // U+2029 are line terminators inside a JavaScript regex literal, so a literal escape for them in
  // this source would end the line and break the file.
  var LINE_BREAKS = new RegExp(
    '[' + String.fromCharCode(0x0d, 0x0a, 0x2028, 0x2029, 0x85, 0x0b, 0x0c) + ']+', 'g');

  // Fold every line terminator and run of whitespace to a single space. This is the whole of the
  // structural defence: the parser splits only on a newline, so a value that cannot contain one
  // cannot open a heading, a bullet or a paragraph. It is not character-stripping — a value's `*`
  // or backtick may still emphasise cosmetically, which is honest, since there is no escape
  // channel to hide behind (the parser honours no backslash escapes).
  function fold(value) {
    if (value == null) return '';
    return String(value)
      .replace(LINE_BREAKS, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function texts(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = fold(list[i]);
      if (s) out.push(s);
    }
    return out;
  }

  // A named item may be a string or an object with a name.
  function nameOf(row) {
    if (row == null) return '';
    if (typeof row === 'string') return fold(row);
    return fold(row.name);
  }

  function duration(minutes) {
    var m = Number(minutes);
    if (!isFinite(m) || m <= 0) return '';
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60);
    var rest = m % 60;
    return rest ? h + ' h ' + rest + ' min' : h + ' h';
  }

  // A cost that is not a number is shown as the person wrote it — the same rule the model and the
  // wire follow (TP.format.parseCost returns undefined for a non-numeric string).
  function cost(value, currency) {
    if (!fold(value)) return '';
    var n = TP.format.parseCost(value);
    if (n == null) return fold(value);
    return TP.format.fmtMoney(n, currency);
  }

  // A link only when it is a URL the scheme allowlist accepts AND one the parser's link regex can
  // read (no space, no closing paren). Anything else is shown as plain text.
  function link(raw) {
    var label = fold(raw);
    if (!label) return '';
    var url = TP.format.linkifyTarget(raw);
    if (!url || /[)\s]/.test(url)) return label;
    if (label.indexOf(']') !== -1) label = url;
    return '[' + label + '](' + url + ')';
  }

  // ---- The document ----

  function Doc() {
    this.lines = [];
    this.headings = [];
  }

  Doc.prototype.blank = function () {
    if (this.lines.length && this.lines[this.lines.length - 1] !== '') this.lines.push('');
  };

  Doc.prototype.heading = function (level, value) {
    var text = fold(value);
    this.blank();
    this.lines.push(new Array(level + 1).join('#') + ' ' + text);
    // The print view gets its hierarchy back from this list: the markdown parser discards the
    // level and renders every heading as one element, so the levels have to travel alongside.
    this.headings.push({ level: level, text: text });
  };

  Doc.prototype.bullet = function (value) {
    var text = fold(value);
    if (text) this.lines.push('- ' + text);
  };

  Doc.prototype.text = function () {
    while (this.lines.length && this.lines[this.lines.length - 1] === '') this.lines.pop();
    return this.lines.length ? this.lines.join('\n') + '\n' : '';
  };

  // ---- Sections ----

  function header(doc, trip) {
    doc.heading(1, TP.model.tripTitle(trip) || 'Trip');

    var when = '';
    if (fold(trip.startDate)) {
      var a = TP.dates.fmtDateLong(trip.startDate);
      var b = trip.endDate && trip.endDate !== trip.startDate ? TP.dates.fmtDateLong(trip.endDate) : '';
      when = b ? a + ' – ' + b : a;
    }
    if (when) doc.bullet('**When:** ' + when);

    var travelers = [];
    var people = Array.isArray(trip.travelers) ? trip.travelers : [];
    for (var i = 0; i < people.length; i++) {
      var who = nameOf(people[i]);
      if (who) travelers.push(who);
    }
    if (travelers.length) doc.bullet('**Travelers:** ' + travelers.join(', '));

    var vehicle = trip.vehicle;
    if (vehicle && fold(vehicle.model)) {
      var v = fold(vehicle.model);
      if (fold(vehicle.batteryKWh)) v += ' · battery ' + fold(vehicle.batteryKWh) + ' kWh';
      if (fold(vehicle.usableRangeMiles)) v += ' · usable range ' + fold(vehicle.usableRangeMiles) + ' mi';
      doc.bullet('**Vehicle:** ' + v);
    }

    var route = [];
    var stops = Array.isArray(trip.destinations) ? trip.destinations : [];
    for (var d = 0; d < stops.length; d++) {
      var place = nameOf(stops[d]);
      if (place) route.push(place);
    }
    if (route.length) doc.bullet('**Route:** ' + route.join(' → '));

    if (fold(trip.currency)) doc.bullet('**Currency:** ' + fold(trip.currency));
  }

  function tips(doc, trip) {
    var list = texts(trip.keyTips);
    if (!list.length) return;
    doc.heading(2, 'Key tips');
    for (var i = 0; i < list.length; i++) doc.bullet(list[i]);
  }

  function alerts(doc, list) {
    if (!list.length) return;
    doc.heading(2, 'Alerts');
    for (var i = 0; i < list.length; i++) {
      var a = list[i] || {};
      var line = (fold(a.severity) ? '**' + fold(a.severity) + '** ' : '') + fold(a.title);
      if (fold(a.text)) line += ' — ' + fold(a.text);
      doc.bullet(line);
    }
  }

  function itemLine(item, trip) {
    var head = [];
    if (item.flags && item.flags.warn) head.push('⚠');
    var time = fold(item.time) || fold(item.timeRaw);
    if (time) head.push('**' + time + '**');
    head.push(fold(item.title) || 'Untitled');
    var type = fold(TP.model.itemType(item));
    if (type) head.push('(' + type + ')');

    var parts = [];
    var dur = duration(item.durationMin);
    if (dur) parts.push(dur);
    var money = cost(item.cost, item.currency || trip.currency);
    if (money) parts.push(money);
    if (fold(item.location)) parts.push('at ' + fold(item.location));
    if (fold(item.confirmation)) parts.push('confirmation ' + fold(item.confirmation));
    var href = link(item.link);
    if (href) parts.push(href);

    var line = head.join(' ');
    if (parts.length) line += ' · ' + parts.join(' · ');
    if (fold(item.notes)) line += ' — ' + fold(item.notes);
    return line;
  }

  function itinerary(doc, days, trip) {
    if (!days.length) return;
    doc.heading(2, 'Itinerary');
    for (var i = 0; i < days.length; i++) {
      var day = days[i] || {};
      var title = 'Day ' + (i + 1) + ' — ' + (fold(day.date) ? TP.dates.fmtDateLong(day.date) : 'no date');
      if (fold(day.title)) title += ' — ' + fold(day.title);
      doc.heading(3, title);

      if (fold(day.stay)) doc.bullet('**Stay:** ' + fold(day.stay));
      if (fold(day.drive)) doc.bullet('**Drive:** ' + fold(day.drive));
      if (fold(day.chargeStops)) doc.bullet('**Charging:** ' + fold(day.chargeStops));
      if (fold(day.nacs)) doc.bullet('**NACS adapter:** ' + fold(day.nacs));
      if (fold(day.summary)) doc.bullet('**Summary:** ' + fold(day.summary));

      var items = Array.isArray(day.items) ? day.items : [];
      for (var k = 0; k < items.length; k++) doc.bullet(itemLine(items[k] || {}, trip));

      var dining = texts(day.dining);
      if (dining.length) doc.bullet('**Dining:** ' + dining.join(' · '));
      var dayTips = texts(day.tips);
      if (dayTips.length) doc.bullet('**Tips:** ' + dayTips.join(' · '));
    }
  }

  function lodging(doc, list) {
    if (!list.length) return;
    doc.heading(2, 'Lodging');
    for (var i = 0; i < list.length; i++) {
      var row = list[i] || {};
      // `location` and `area` are the free-text ADDRESS fields — there is no address property on
      // the model, and this is where a person writes one.
      var line = '**' + (fold(row.location) || 'Stay') + '**';
      var parts = [];
      if (fold(row.area)) parts.push('Area: ' + fold(row.area));
      if (fold(row.checkIn)) parts.push('Check-in: ' + fold(row.checkIn));
      if (fold(row.checkOut)) parts.push('Check-out: ' + fold(row.checkOut));
      if (fold(row.confirmation)) parts.push('Confirmation: ' + fold(row.confirmation));
      if (parts.length) line += ' — ' + parts.join(' · ');
      if (fold(row.notes)) line += ' — ' + fold(row.notes);
      doc.bullet(line);
    }
  }

  function bookings(doc, reservations, noReservation) {
    if (!reservations.length && !noReservation.length) return;
    doc.heading(2, 'Bookings');
    for (var i = 0; i < reservations.length; i++) {
      var row = reservations[i] || {};
      var line = '**' + (fold(row.what) || 'Booking') + '**';
      var parts = [];
      if (fold(row.when)) parts.push('When: ' + fold(row.when));
      if (fold(row.bookBy)) parts.push('Book by: ' + fold(row.bookBy));
      if (fold(row.howToBook)) parts.push('How: ' + link(row.howToBook));
      if (fold(row.priority)) parts.push('Priority: ' + fold(row.priority));
      parts.push(row.done ? 'Done' : 'Not done');
      var money = cost(row.cost, null);
      if (money) parts.push(money);
      line += ' — ' + parts.join(' · ');
      if (fold(row.duration)) line += ' · ' + fold(row.duration);
      doc.bullet(line);
    }
    if (noReservation.length) {
      doc.heading(3, 'No reservation needed');
      for (var k = 0; k < noReservation.length; k++) {
        var nr = noReservation[k] || {};
        var nl = '**' + (fold(nr.what) || 'Item') + '**';
        if (fold(nr.notes)) nl += ' — ' + fold(nr.notes);
        doc.bullet(nl);
      }
    }
  }

  function contacts(doc, list) {
    if (!list.length) return;
    // This is where phone numbers live: `how` is free text, and the panel's own placeholder says
    // "phone or URL".
    doc.heading(2, 'Contacts');
    for (var i = 0; i < list.length; i++) {
      var row = list[i] || {};
      var line = '**' + (fold(row.what) || 'Contact') + ':**';
      var how = fold(row.how);
      if (how) line += ' ' + (TP.format.safeUrl(how) ? link(how) : how);
      doc.bullet(line);
    }
  }

  function preTrip(doc, list) {
    if (!list.length) return;
    doc.heading(2, 'Before you go');
    for (var i = 0; i < list.length; i++) {
      var row = list[i] || {};
      var line = (row.done ? '[x] ' : '[ ] ') + (fold(row.text) || 'Task');
      var parts = [];
      if (fold(row.category)) parts.push(fold(row.category));
      if (fold(row.priority)) parts.push(fold(row.priority));
      if (parts.length) line += ' (' + parts.join(', ') + ')';
      doc.bullet(line);
    }
  }

  function checklists(doc, list) {
    if (!list.length) return;
    doc.heading(2, 'Checklists');
    for (var i = 0; i < list.length; i++) {
      var group = list[i] || {};
      doc.heading(3, group.category || 'General');
      var items = Array.isArray(group.items) ? group.items : [];
      for (var k = 0; k < items.length; k++) {
        var it = items[k] || {};
        doc.bullet((it.done ? '[x] ' : '[ ] ') + (fold(it.text) || 'Item'));
      }
    }
  }

  function charging(doc, trip, networks, thresholds) {
    var hasVehicle = !!(trip.vehicle && fold(trip.vehicle.model));
    if (!hasVehicle && !networks.length && !thresholds.length) return;
    doc.heading(2, 'Charging');
    for (var i = 0; i < networks.length; i++) {
      var row = networks[i] || {};
      var line = '**' + (fold(row.name) || 'Network') + '**';
      var parts = [];
      if (fold(row.network)) parts.push(fold(row.network));
      if (fold(row.location)) parts.push(fold(row.location));
      if (row.nacsAdapter) parts.push('NACS adapter needed');
      if (parts.length) line += ' — ' + parts.join(' · ');
      if (fold(row.notes)) line += ' — ' + fold(row.notes);
      doc.bullet(line);
    }
    if (thresholds.length) {
      doc.heading(3, 'Minimum charge thresholds');
      for (var k = 0; k < thresholds.length; k++) {
        var t = thresholds[k] || {};
        var tl = fold(t.leg) || fold(t.day) || 'Leg';
        if (fold(t.minSoc)) tl += ': min ' + fold(t.minSoc) + '%';
        var tail = [];
        if (fold(t.severity)) tail.push(fold(t.severity));
        if (fold(t.reason)) tail.push(fold(t.reason));
        if (tail.length) tl += ' (' + tail.join(' — ') + ')';
        doc.bullet(tl);
      }
    }
  }

  function budget(doc, trip, estimates, expenses) {
    if (!estimates.length && !expenses.length) return;
    doc.heading(2, 'Budget');
    if (estimates.length) {
      doc.heading(3, 'Estimates');
      for (var i = 0; i < estimates.length; i++) {
        var row = estimates[i] || {};
        var line = (fold(row.category) ? '**' + fold(row.category) + ':** ' : '') + (fold(row.item) || 'Estimate');
        var money = cost(row.cost, trip.currency);
        if (money) line += ' — ' + money;
        if (row.optional) line += ' (optional)';
        doc.bullet(line);
      }
      var rollup = TP.model.rollupBudget(estimates);
      if (rollup.categories.length) {
        doc.heading(3, 'By category');
        for (var c = 0; c < rollup.categories.length; c++) {
          doc.bullet(rollup.categories[c].name + ': ' + TP.format.fmtMoney(rollup.categories[c].amount, trip.currency));
        }
        doc.bullet('**Estimated total:** ' + TP.format.fmtMoney(rollup.total, trip.currency));
      }
    }
    if (expenses.length) {
      doc.heading(3, 'Expenses');
      for (var e = 0; e < expenses.length; e++) {
        var ex = expenses[e] || {};
        var head = [];
        if (fold(ex.date)) head.push(fold(ex.date));
        if (fold(ex.category)) head.push(fold(ex.category));
        var tail = [];
        var amount = cost(ex.amount, trip.currency);
        if (amount) tail.push(amount);
        if (fold(ex.label)) tail.push(fold(ex.label));
        var exLine = head.join(' — ');
        if (tail.length) exLine += (exLine ? ': ' : '') + tail.join(' ');
        doc.bullet(exLine);
      }
      doc.bullet('**Spent:** ' + TP.format.fmtMoney(TP.model.expenseTotal(expenses), trip.currency));
    }
  }

  function bucket(doc, list) {
    if (!list.length) return;
    doc.heading(2, 'Appendix A: Bucket list');
    for (var i = 0; i < list.length; i++) {
      var row = list[i] || {};
      var line = '**' + (nameOf(row) || 'Idea') + '**';
      var when = fold(row.dateLabel) || (fold(row.date) ? TP.dates.fmtDateLong(row.date) : '');
      if (when) line += ' — ' + when;
      doc.bullet(line);
    }
  }

  function library(doc, list) {
    if (!list.length) return;
    doc.heading(2, 'Appendix B: Location library');
    for (var i = 0; i < list.length; i++) {
      var row = list[i] || {};
      var line = '**' + (nameOf(row) || 'Place') + '**';
      if (fold(row.icon)) line += ' ' + fold(row.icon);
      if (fold(row.summary)) line += ' — ' + fold(row.summary);
      var parts = [];
      if (fold(row.lodging)) parts.push('Lodging: ' + fold(row.lodging));
      var charge = texts(row.charging);
      if (charge.length) parts.push('Charging: ' + charge.join(', '));
      var dine = texts(row.dining);
      if (dine.length) parts.push('Dining: ' + dine.join(', '));
      var acts = [];
      var activities = Array.isArray(row.activities) ? row.activities : [];
      for (var a = 0; a < activities.length; a++) {
        var an = nameOf(activities[a]);
        if (an) acts.push(an);
      }
      if (acts.length) parts.push('Activities: ' + acts.join(', '));
      if (parts.length) line += ' · ' + parts.join(' · ');
      doc.bullet(line);
    }
  }

  // ---- Entry point ----

  function fromTrip(trip) {
    var t = trip || {};
    var doc = new Doc();

    header(doc, t);
    tips(doc, t);
    alerts(doc, Array.isArray(t.criticalAlerts) ? t.criticalAlerts : []);
    itinerary(doc, Array.isArray(t.days) ? t.days : [], t);
    lodging(doc, Array.isArray(t.lodging) ? t.lodging : []);
    bookings(doc, Array.isArray(t.reservations) ? t.reservations : [],
      Array.isArray(t.noReservationNeeded) ? t.noReservationNeeded : []);
    contacts(doc, Array.isArray(t.contacts) ? t.contacts : []);
    preTrip(doc, Array.isArray(t.preTripActions) ? t.preTripActions : []);
    checklists(doc, Array.isArray(t.checklists) ? t.checklists : []);
    charging(doc, t,
      Array.isArray(t.chargingNetworks) ? t.chargingNetworks : [],
      Array.isArray(t.minSocThresholds) ? t.minSocThresholds : []);
    budget(doc, t,
      Array.isArray(t.budgetEstimates) ? t.budgetEstimates : [],
      Array.isArray(t.expenses) ? t.expenses : []);
    bucket(doc, Array.isArray(t.bucketList) ? t.bucketList : []);
    library(doc, Array.isArray(t.locations) ? t.locations : []);

    return { text: doc.text(), headings: doc.headings, losses: losses() };
  }

  // What a printed plan does not carry. Not routed through TP.ledger: markdown is not an
  // interchange format and does not round-trip, so it has no ledger column. The dialog's wording
  // is still generated from this list, so the two cannot drift (the REQ-512 habit).
  function losses() {
    return [
      { field: 'the document history', note: 'every commit and revert; the planner document (.html) carries it' },
      { field: 'fields from other formats kept in the passthrough bag', note: 'machine extras, not part of a printed plan' },
      { field: 'the document identity', note: 'the docId that binds the file to its history' },
    ];
  }

  return { fromTrip: fromTrip, losses: losses, fold: fold };
})();
