// iCalendar (RFC 5545) — the genuine external interchange format (specs/06-interchange.md).
//
// The itinerary leaves as a calendar. What a calendar cannot carry is extensive, and every
// one of those fields is a disclosure obligation rather than a silent omission: the export
// dialog is generated from the ledger (§3.4) so the two cannot drift.
//
// Synthesis versus blocking (03-data-model.md §7):
//   UID       synthesized, deterministically, from {trip.id}/{item.id} — so re-importing an
//             exported file MATCHES rather than duplicating. A file that arrived carrying its own
//             UID keeps it: the property is in the bag, and a bag is written back verbatim
//   DTSTAMP   synthesized: the export time. Informational, and correct as such
//   DTSTART   synthesized from the day's date as an all-day DATE when the item has no time
//   no day    BLOCKED, and disclosed. There is no date to invent. The rest proceeds

TP.ical = (function () {
  'use strict';

  var ID = 'iCalendar';
  var FORMAT = 'iCal';
  var UID_HOST = 'trip-planner.invalid';
  var PRODID = '-//trip-planner//Portable Versioned Document//EN';

  var LIMITS = {
    maxLines: 400000,
    maxLineLength: 100000,
    maxProperties: 400000,
  };

  // ---- RFC 5545 text ----

  function escapeText(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  function unescapeText(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '\\' && i + 1 < s.length) {
        var n = s[++i];
        if (n === 'n' || n === 'N') out += '\n';
        else if (n === '\\') out += '\\';
        else if (n === ';') out += ';';
        else if (n === ',') out += ',';
        else out += n;
      } else {
        out += c;
      }
    }
    return out;
  }

  // ---- RFC 6868 parameter values ----
  //
  // A parameter value is not TEXT: `escapeText`'s backslashes are meaningless between `;` and `:`,
  // and an unquoted value cannot hold a `;`, a `:` or a `,` at all. RFC 6868 is the extension that
  // makes a parameter value carry a double quote, a caret or a line break, and CN is the one
  // parameter this app writes from a value a person typed — a traveller's name.
  //
  // Without this, the name `"quoted"` came back as `quoted` (parseLine strips a value's surrounding
  // double quotes, which is exactly what an unescaped quote at each end looks like) and a name with
  // a `;` came back truncated. `trip.travelers[]` is F in the ledger, which is a promise the fold is
  // exact within documented limits — a quote in a name is not one of those limits, it is a name.
  function paramEncode(s) {
    return String(s == null ? '' : s)
      .replace(/\^/g, '^^')
      .replace(/"/g, "^'")
      .replace(/\r\n|\r|\n/g, '^n');
  }

  // A caret followed by anything else is left exactly as it stands, which is what RFC 6868 says and
  // what keeps a foreign value like `CN=50%^off` from being mangled on the way in.
  function paramDecode(s) {
    return String(s == null ? '' : s).replace(/\^([\^n'])/g, function (_, c) {
      if (c === '^') return '^';
      if (c === "'") return '"';
      return '\n';
    });
  }

  // Fold at 75 characters. RFC 5545 counts octets; for a trip plan the difference only shows
  // up in non-Latin titles, where folding slightly late is harmless (unfolding is exact).
  function fold(line) {
    if (line.length <= 75) return line;
    var out = line.slice(0, 75);
    var rest = line.slice(75);
    while (rest.length) {
      out += '\r\n ' + rest.slice(0, 74);
      rest = rest.slice(74);
    }
    return out;
  }

  // Unfolding is a loop fed by hostile input, so it is bounded (REQ-517).
  function unfold(text) {
    var src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    var rawLines = src.split(/\r\n|\r|\n/);
    if (rawLines.length > LIMITS.maxLines) {
      throw new Error('This calendar has ' + rawLines.length + ' lines, beyond the ' +
        LIMITS.maxLines + ' this app will read.');
    }
    var lines = [];
    for (var i = 0; i < rawLines.length; i++) {
      var l = rawLines[i];
      if (l.length > LIMITS.maxLineLength) {
        throw new Error('A line in this calendar is ' + l.length + ' characters, beyond the ' +
          LIMITS.maxLineLength + ' this app will read.');
      }
      if (l.charAt(0) === ' ' || l.charAt(0) === '\t') {
        if (!lines.length) continue;
        lines[lines.length - 1] += l.slice(1);
      } else {
        lines.push(l);
      }
    }
    return lines;
  }

  // NAME;PARAM=VAL;PARAM2="quoted":VALUE
  function parseLine(line) {
    var colon = findValueColon(line);
    if (colon === -1) return null;
    var head = line.slice(0, colon);
    var value = line.slice(colon + 1);
    var parts = splitParams(head);
    var name = parts.shift().toUpperCase();
    var params = {};
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq === -1) continue;
      var k = parts[i].slice(0, eq).toUpperCase();
      var v = parts[i].slice(eq + 1);
      if (v.length >= 2 && v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') v = v.slice(1, -1);
      params[k] = v;
    }
    return { name: name, params: params, value: value };
  }

  // The colon that separates the value is the first one NOT inside a quoted parameter value.
  function findValueColon(line) {
    var inQuote = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') inQuote = !inQuote;
      else if (c === ':' && !inQuote) return i;
    }
    return -1;
  }

  function splitParams(head) {
    var out = [];
    var cur = '';
    var inQuote = false;
    for (var i = 0; i < head.length; i++) {
      var c = head[i];
      if (c === '"') { inQuote = !inQuote; cur += c; continue; }
      if (c === ';' && !inQuote) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }

  // ---- Detection ----

  function detect(text) {
    var s = String(text == null ? '' : text).replace(/^\uFEFF/, '').replace(/^\s+/, '');
    return s.slice(0, 15).toUpperCase() === 'BEGIN:VCALENDAR';
  }

  // ---- Export ----

  function uidFor(tripId, itemId) {
    return tripId + '/' + itemId + '@' + UID_HOST;
  }

  // Recovering the item id from a UID this app produced. Anything else is left alone: an
  // outside calendar's UID is a fact about that file, not an id we are entitled to rewrite.
  //
  // Read through the same escaping it was written with. A `UID` is an RFC 5545 TEXT value, so the
  // export escapes what it writes — and an id is only a model id if it was escaped on the way out.
  // Without this the ids a UID carries come back mangled for any id containing a comma, a semicolon
  // or a backslash, which `trip-data.json` allows and this format does not: `day,one` returned as
  // `day\,one` and every such day looked like a day from somewhere else.
  function parseUid(uid) {
    var m = /^([^/\s]+)\/([^/@\s]+)@trip-planner\.invalid$/.exec(unescapeText(String(uid || '')));
    if (!m) return null;
    return { tripId: m[1], itemId: m[2] };
  }

  function dtStamp(now) {
    var d = now ? new Date(now) : new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + 'T' +
      p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
  }

  function dateCompact(iso) {
    return String(iso || '').replace(/-/g, '');
  }

  function nextDate(iso) {
    var d = TP.dates.parseISO(iso);
    if (!d) return iso;
    return TP.dates.toISO(TP.dates.addDays(d, 1));
  }

  // ---- Writing a bag back onto an event ----
  //
  // A bag member is written back exactly as it came in (REQ-207), which means honouring the three
  // shapes `carryBag` stores: a property with parameters in its serialized form (`RRULE;X=1:FREQ=…`),
  // a bare property as its plain value, and a property that occurred more than once as its
  // serializations joined by newlines. Writing `name + ':' + value` unconditionally — which is what
  // this did — produces `VALARM:VALARM;X=1:…` for the first shape and mangles the third.

  var CALENDAR_PROPERTIES = [
    'VERSION', 'PRODID', 'CALSCALE', 'METHOD', 'X-WR-CALNAME', 'X-WR-CALDESC', 'X-TP-TRAVELERS',
  ];
  // ATTENDEE is in DAY_PROPERTIES as well as ITEM_PROPERTIES because the travellers are written on
  // every event (see `fromTrip`): a property the mapper writes for itself must be in the list that
  // stops the bag from writing it a second time, or a day would come back from its own export
  // carrying a bagged ATTENDEE beside the one the model folded.
  var DAY_PROPERTIES = ['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY', 'DESCRIPTION', 'ATTENDEE'];
  // URL is in this list because `item.link` is a field of the model: a property the mapper writes for
  // itself must be in the list that stops the bag from writing it a second time, or an item would come
  // back from its own export carrying a bagged URL beside the one the model holds.
  var ITEM_PROPERTIES = DAY_PROPERTIES.concat(['LOCATION', 'DURATION', 'URL', 'X-TP-KIND']);

  function emitBagLines(lines, name, raw) {
    var parts = String(raw == null ? '' : raw).split('\n');
    // A nested COMPONENT — a VALARM is the one that occurs in practice — is stored as its own lines,
    // `BEGIN` and `END` included, and written back verbatim. Prefixing it with its name, which is
    // what the branch below does for a plain property, would produce `VALARM:BEGIN:VALARM`.
    var verbatim = parts.length > 1 && /^BEGIN:/i.test(parts[0]);
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part === '') continue;
      if (verbatim) { lines.push(fold(part)); continue; }
      var upper = part.toUpperCase();
      if (upper.indexOf(name.toUpperCase() + ':') === 0 || upper.indexOf(name.toUpperCase() + ';') === 0) {
        lines.push(fold(part));
      } else {
        lines.push(fold(name + ':' + part));
      }
    }
  }

  // Every bag member of an entity, except the properties the mapper writes for itself — those were
  // written from the model, and writing them twice would put two SUMMARY lines on one event.
  function emitBag(lines, entity, own) {
    var bag = TP.model.bag(entity, FORMAT);
    if (!bag) return;
    for (var k in bag) {
      if (!Object.prototype.hasOwnProperty.call(bag, k)) continue;
      if (own.indexOf(k) !== -1) continue;
      emitBagLines(lines, k, bag[k]);
    }
  }

  function pushAll(target, source) {
    for (var i = 0; i < source.length; i++) target.push(source[i]);
    return target;
  }

  function fromTrip(trip, options) {
    var opts = options || {};
    var n = TP.model.normalize(TP.model.clone(trip));
    var stamp = dtStamp(opts.now);
    var lines = [];
    var blocked = [];
    var synthetic = [];

    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:' + PRODID);
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    // The trip's title as the model holds it, escaped and nothing else. NOT `TP.model.tripTitle`,
    // which is the DISPLAY helper: it trims and substitutes "Untitled trip", so an export that used
    // it would write a title the document does not have — and `trip.title` is `folded` in the
    // ledger (REQ-511), which is a promise that a title survives the fold unchanged.
    lines.push(fold('X-WR-CALNAME:' + escapeText(n.title)));
    if ((n.keyTips || []).length) {
      lines.push(fold('X-WR-CALDESC:' + escapeText(n.keyTips.join('\n'))));
      synthetic.push('X-WR-CALDESC carries the trip’s key tips.');
    }
    // Unmodelled VCALENDAR properties ride back out exactly as they came in (REQ-207, REQ-515).
    emitBag(lines, n, CALENDAR_PROPERTIES);
    var attendees = (n.travelers || []).filter(function (t) { return t && t.name; });
    // The travellers, written on EVERY event — one ATTENDEE per addressed traveller, the same on
    // each. They belong to the trip, and the trip is the whole calendar. (Writing them on the item
    // events alone — which is what this did — loses every addressed traveller of a trip whose days
    // hold no items, and those days are common: a plan can be a day with a drive and nothing booked.)
    //
    // The name goes in a QUOTED, caret-encoded parameter value (`paramEncode`), not through
    // `escapeText`: a parameter is not TEXT, and an unquoted value cannot carry a `;` or a `:`.
    //
    // A traveller that arrived carrying a richer ATTENDEE than this app writes — one that named a
    // PARTSTAT, a ROLE, an RSVP — has the whole line in its bag, because the model has no field for
    // any of those and REQ-504/REQ-515 make preserving them mandatory. That line goes back out
    // verbatim (REQ-207: a bag is never interpreted). Synthesizing `CN` + `mailto:` in its place —
    // which is what this did — silently dropped everything else the calendar had said about the
    // person, so the ledger's **P** for ATTENDEE was a promise the export did not keep.
    var attendeeLines = (function () {
      var out = [];
      for (var a = 0; a < attendees.length; a++) {
        var bag = TP.model.bag(attendees[a], FORMAT);
        if (bag && bag.ATTENDEE) { out.push(fold(String(bag.ATTENDEE))); continue; }
        var mail = travelerEmail(attendees[a]);
        if (!mail) continue;
        out.push(fold('ATTENDEE;CN="' + paramEncode(attendees[a].name) + '":mailto:' + mail));
      }
      return out;
    })();
    // A traveller with no email has no ATTENDEE to fold into, and §3.1 promises the name survives
    // anyway ("a traveller with no email survives only as a name"). So the names go in a property of
    // this app's own — and ALL of them, not only the ones without an address, because this list is
    // also what restores the ORDER: `ATTENDEE` lines cannot, since a traveller with no address has
    // none. It cannot go in X-WR-CALDESC without breaking the exact fold the key tips rely on, and
    // X- properties are exactly where a format's own conventions belong.
    if (attendees.length) {
      var names = [];
      for (var t = 0; t < attendees.length; t++) names.push(attendees[t].name);
      lines.push(fold('X-TP-TRAVELERS:' + escapeText(names.join('\n'))));
    }

    (n.days || []).forEach(function (day) {
      if (!day.date) return;
      var dayBag = TP.model.bag(day, FORMAT);
      lines.push('BEGIN:VEVENT');
      if (dayBag && dayBag.UID) emitBagLines(lines, 'UID', dayBag.UID);
      else lines.push('UID:' + escapeText(uidFor(n.id, day.id)));
      lines.push('DTSTAMP:' + stamp);
      lines.push('DTSTART;VALUE=DATE:' + dateCompact(day.date));
      lines.push('DTEND;VALUE=DATE:' + dateCompact(nextDate(day.date)));
      // Never synthesized (03-data-model.md §7): a day title is written as the day has it, even an
      // empty one. The `'Day ' + (i + 1)` fallback this used to write was not disclosed, and worse,
      // it came back IN as the day's title — an export that silently rewrites the document it
      // exported. RFC 5545 makes SUMMARY optional and its value may be empty; a blank event is the
      // honest rendering of a day nobody titled.
      lines.push(fold('SUMMARY:' + escapeText(day.title)));
      var desc = dayDescription(day);
      if (desc) lines.push(fold('DESCRIPTION:' + escapeText(desc)));
      emitBag(lines, day, DAY_PROPERTIES);
      pushAll(lines, attendeeLines);
      lines.push('END:VEVENT');
    });

    (n.days || []).forEach(function (day) {
      (day.items || []).forEach(function (item) {
        if (!day.date) {
          blocked.push({
            kind: 'item',
            id: item.id,
            title: item.title,
            reason: 'this item has no date, so any DTSTART would be invented',
          });
          return;
        }
        var itemBag = TP.model.bag(item, FORMAT);
        lines.push('BEGIN:VEVENT');
        if (itemBag && itemBag.UID) emitBagLines(lines, 'UID', itemBag.UID);
        else lines.push('UID:' + escapeText(uidFor(n.id, item.id)));
        lines.push('DTSTAMP:' + stamp);
        if (item.time) {
          var hhmm = clockTime(item.time);
          if (hhmm) {
            lines.push('DTSTART:' + dateCompact(day.date) + 'T' + hhmm.replace(':', '') + '00');
          } else {
            // A time the model holds but a calendar cannot express — the itinerary editor takes any
            // text — would otherwise be stamped into DTSTART as it stands (`20260901T9am00`), making
            // a calendar this app's own validator refuses to re-import. The day's date is written
            // instead, and the substitution is disclosed rather than silent.
            lines.push('DTSTART;VALUE=DATE:' + dateCompact(day.date));
            synthetic.push('The time “' + item.time + '” is not a clock time, so only the date could be written to the calendar.');
          }
        } else {
          lines.push('DTSTART;VALUE=DATE:' + dateCompact(day.date));
          // The disclosure belongs to the all-day form the sentence describes. It used to be pushed
          // in the TIMED branch, so it claimed a synthesis that had not happened and said nothing in
          // the one case that needed it.
          synthetic.push('An all-day DTSTART was synthesized from the day’s date for items with no time.');
        }
        if (item.durationMin != null) {
          lines.push('DURATION:PT' + Math.round(item.durationMin) + 'M');
        }
        lines.push(fold('SUMMARY:' + escapeText(item.title || 'Untitled')));
        if (item.location) lines.push(fold('LOCATION:' + escapeText(item.location)));
        // `item.link` is the one field the itinerary item editor writes that a calendar has a
        // standard property for, so it is written as URL rather than folded into the DESCRIPTION —
        // but only when it really is one (see `calendarUrl`).
        //
        // A URL that arrived from a calendar before this generation named the field is in the iCal
        // bag, where `carryBag` put it and where it has round-tripped verbatim ever since. Dropping
        // it would lose a value the previous generation kept, so it is written back while the item
        // has no link of its own. (A person who clears such a link sees it return: the model holds no
        // trace of a link that was deleted, so this mapper cannot tell "never had one" from "had one
        // and cleared it". The wart is confined to URLs an older build imported, and the alternative —
        // losing them — is the failure this whole change is about.)
        var url = calendarUrl(item.link);
        if (url) {
          lines.push(fold('URL:' + escapeText(url)));
        } else {
          var urlBag = TP.model.bag(item, FORMAT);
          if (urlBag && calendarUrl(urlBag.URL)) emitBagLines(lines, 'URL', urlBag.URL);
        }
        var idesc = itemDescription(item);
        if (idesc) lines.push(fold('DESCRIPTION:' + escapeText(idesc)));
        // An item with no time has the same DTSTART shape as the day it sits in, so this app
        // writes its own marker to tell the two apart on the way back in. Without it a timeless
        // item returns as a day heading and the item itself is gone. It is a property of OUR
        // files — a calendar from anywhere else simply has no such line, and its date-only
        // events are read as days, which is the only honest reading of a foreign file.
        lines.push('X-TP-KIND:ITEM');
        emitBag(lines, item, ITEM_PROPERTIES);
        pushAll(lines, attendeeLines);
        lines.push('END:VEVENT');
      });
    });

    lines.push('END:VCALENDAR');
    return {
      text: lines.join('\r\n') + '\r\n',
      blocked: blocked,
      synthesized: dedupe(synthetic),
      losses: losses(),
    };
  }

  function dedupe(list) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (seen[list[i]]) continue;
      seen[list[i]] = true;
      out.push(list[i]);
    }
    return out;
  }

  // The address a calendar knows about lives in the traveller's bag: the model's Traveller is
  // `id`, `name`, `type` (03-data-model.md §2.1) and has no `email` field to read.
  function travelerEmail(t) {
    var bag = TP.model.bag(t, FORMAT);
    return bag && bag.EMAIL ? String(bag.EMAIL) : '';
  }

  function dayDescription(day) {
    var parts = [];
    if (day.stay) parts.push('Stay: ' + day.stay);
    if (day.drive) parts.push('Drive: ' + day.drive);
    if (day.chargeStops) parts.push('Charge stops: ' + day.chargeStops);
    if (day.nacs) parts.push('NACS: ' + day.nacs);
    if (day.summary) parts.push('Summary: ' + day.summary);
    if ((day.dining || []).length) parts.push('Dining: ' + day.dining.join('; '));
    if ((day.tips || []).length) parts.push('Tips: ' + day.tips.join('; '));
    return parts.join('\n');
  }

  function itemDescription(item) {
    var parts = [];
    // The confirmation goes FIRST so that un-folding can take it off a known end of the line. It is
    // still a text convention rather than a structured field, which is why `item.confirmation` is
    // F in the ledger and not M: a note whose first line reads `Confirmation: …` is read as a
    // confirmation on the way back in.
    if (item.confirmation) parts.push('Confirmation: ' + String(item.confirmation).replace(/[\r\n]+/g, ' '));
    if (item.notes) parts.push(item.notes);
    return parts.join('\n');
  }

  // The inverse of the fold above. Anywhere else in the description, `Confirmation: ` is just text
  // and stays part of the note.
  function unfoldItemDescription(desc) {
    var s = String(desc == null ? '' : desc);
    var nl = s.indexOf('\n');
    var first = nl === -1 ? s : s.slice(0, nl);
    if (first.slice(0, 14).toLowerCase() !== 'confirmation: ') return { notes: s, confirmation: undefined };
    return {
      confirmation: first.slice(14),
      notes: nl === -1 ? '' : s.slice(nl + 1),
    };
  }

  // ---- Import ----

  // The parameter is `source`, not `text`: `text()` is the RFC 5545 text helper used throughout
  // this function, and a parameter of the same name shadows it — every unescaping call would then
  // throw "text is not a function" on a calendar that is otherwise perfectly readable.
  function toTrip(source, options) {
    var opts = options || {};
    var lines = unfold(source);
    var events = [];
    var cur = null;
    var props = 0;
    var calendarProps = {};

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) continue;
      if (++props > LIMITS.maxProperties) {
        throw new Error('This calendar has more than ' + LIMITS.maxProperties + ' properties; it will not be read.');
      }
      var upper = line.toUpperCase();
      if (upper === 'BEGIN:VEVENT') { cur = { props: {} }; continue; }
      if (upper === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
      if (upper === 'BEGIN:VCALENDAR' || upper === 'END:VCALENDAR') continue;

      // A nested COMPONENT is kept whole, under its own name, from its `BEGIN` to its `END`.
      //
      // Flattening its properties into the surrounding event — which is what this did — scatters
      // it: `BEGIN:VALARM` and `END:VALARM` become properties called `BEGIN` and `END`, and a
      // VALARM's own `DESCRIPTION` collides with the event's, at which point one of the two is
      // dropped as a property the mapper already has. REQ-515 names `VALARM` as a thing that is
      // preserved, and a reminder that comes back without its description has not been preserved.
      var nested = /^BEGIN:([A-Z0-9-]+)$/.exec(upper);
      if (nested) {
        var component = nested[1];
        var terminator = 'END:' + component;
        var body = [];
        while (i + 1 < lines.length) {
          i++;
          if (String(lines[i]).toUpperCase() === terminator) break;
          body.push(lines[i]);
        }
        var holder = cur ? cur.props : calendarProps;
        if (!holder[component]) holder[component] = [];
        holder[component].push({
          name: component,
          value: 'BEGIN:' + component + '\n' + body.join('\n') + '\n' + terminator,
          params: {},
          block: true,
        });
        continue;
      }
      if (/^END:[A-Z0-9-]+$/.test(upper)) continue;   // an `END` with no `BEGIN` before it

      var p = parseLine(line);
      if (!p) continue;
      if (cur) {
        if (!cur.props[p.name]) cur.props[p.name] = [];
        cur.props[p.name].push(p);
      } else {
        if (!calendarProps[p.name]) calendarProps[p.name] = [];
        calendarProps[p.name].push(p);
      }
    }

    var calName = firstValue(calendarProps, 'X-WR-CALNAME');
    var calDesc = firstValue(calendarProps, 'X-WR-CALDESC');

    var trip = {
      id: TP.uid(),
      docId: opts.docId || '',
      // Unescaped, and NOT defaulted: X-WR-CALNAME is RFC 5545 TEXT, so a title with a comma in it
      // arrives escaped and has to be read back through the same escape. And a calendar that names
      // itself nothing leaves the trip untitled — which is what the model says, and what the UI
      // renders as "Untitled trip". Naming it `Imported calendar` here was an invented title.
      title: calName === undefined ? '' : unescapeText(String(calName)),
      subtitle: '',
      currency: 'USD',
      startDate: null,
      endDate: null,
      // A calendar names no destinations, and this placeholder is dropped again by the
      // `trip-data.json` export; a DERIVED id (the model's convention) keeps it from changing on
      // the leg between the two formats.
      destinations: [{ id: TP.model.derivedId('dest', 0, ''), name: '' }],
      travelers: [],
      days: [],
    };
    // `trip.id` is P in the ledger: a calendar has no trip-level property, but every UID this app
    // writes embeds the trip id, so an import reads it back rather than minting a new one. This is
    // also what makes the items' ids recoverable below — and so what makes re-importing an exported
    // file MATCH its events instead of duplicating the whole trip beside them.
    for (var u = 0; u < events.length; u++) {
      var uidValue = events[u].props.UID ? events[u].props.UID[0].value : null;
      var parsedUid = parseUid(uidValue);
      if (parsedUid) { trip.id = parsedUid.tripId; break; }
    }
    // Unmodelled VCALENDAR properties ride on the trip (REQ-515), the way unmodelled VEVENT
    // properties ride on the day or item they were on.
    carryBag(trip, calendarProps, CALENDAR_PROPERTIES);
    // The tips are joined with a newline into one property and split back on the way in, and that
    // pair has to be an exact inverse or `keyTips[]` is not honestly `folded` (REQ-511): a tip is
    // whatever the person typed, leading and trailing spaces included. Trimming here — which this
    // used to do — is what made a tip like `'  padded  '` come back as `'padded'`.
    trip.keyTips = calDesc
      ? unescapeText(String(calDesc)).split('\n').filter(function (s) { return s !== ''; })
      : [];
    for (var c = 0; c < TP.model.COLLECTIONS.length; c++) trip[TP.model.COLLECTIONS[c]] = [];
    trip.checklists = [];

    var dayByDate = {};
    var dates = [];

    // Pass 1: all-day events with no time are days; everything else is an item.
    for (var e = 0; e < events.length; e++) {
      var ev = events[e];
      var summary = text(firstValue(ev.props, 'SUMMARY'));
      var start = firstValue(ev.props, 'DTSTART');
      var hasTime = start ? /T\d{6}/.test(start) && !/^VALUE=DATE/i.test(ev.props.DTSTART[0].params.VALUE || '') : false;
      var date = start ? isoFrom(start) : null;
      if (date) dates.push(date);

      // A date-only VEVENT is a day — unless this app wrote it for an item that has no time, which
      // it says so about with a marker of its own (see the export). Without the marker a timeless
      // item comes back as a day heading and the item itself is gone.
      var isItemEvent = text(firstValue(ev.props, 'X-TP-KIND')).toUpperCase() === 'ITEM';
      if (!isItemEvent && !hasTime && date) {
        var day = ensureDay(trip, dayByDate, date);
        if (summary) day.title = summary;
        var desc = text(firstValue(ev.props, 'DESCRIPTION'));
        if (desc) applyDayDescription(day, desc);
        // Unmodelled properties on a day event ride along on the day.
        carryBag(day, ev.props, DAY_PROPERTIES);
        if (ev.props.UID) {
          var dayUid = String(ev.props.UID[0].value);
          adoptDayId(trip, day, dayUid);
          if (!isOwnUid(dayUid, trip.id, day.id)) TP.model.bagSet(day, FORMAT, 'UID', dayUid);
        }
        continue;
      }
      if (!date) {
        // No DTSTART at all: there is no honest place to put it. Report, do not guess.
        continue;
      }
      var dayI = ensureDay(trip, dayByDate, date);
      var unfolded = unfoldItemDescription(text(firstValue(ev.props, 'DESCRIPTION')));
      var item = {
        id: itemIdFrom(ev, trip.id),
        title: summary || 'Untitled',
        time: hasTime ? timeFrom(start) : undefined,
        // No `timeRaw`. That field is "the original unparsed string" of a `trip-data.json` `time`,
        // and a DTSTART is not one; storing it would hand the JSON export a value it cannot parse
        // and cost the item its time on the next export. What the calendar stated is kept where it
        // belongs — in `time`, and in the bag's DTSTART if this mapper did not write it.
        location: text(firstValue(ev.props, 'LOCATION')) || undefined,
        link: text(firstValue(ev.props, 'URL')) || undefined,
        notes: unfolded.notes,
        confirmation: unfolded.confirmation,
        durationMin: durationFrom(ev),
        type: 'activity',
      };
      carryBag(item, ev.props, ITEM_PROPERTIES);
      if (ev.props.UID) {
        var itemUid = String(ev.props.UID[0].value);
        if (!isOwnUid(itemUid, trip.id, item.id)) TP.model.bagSet(item, FORMAT, 'UID', itemUid);
      }
      dayI.items.push(item);
    }

    // Pass 2: the travellers — folded, best-effort, and disclosed as such.
    //
    // An `ATTENDEE` carries a name (its `CN`) and, in the value, an address. `X-TP-TRAVELERS`
    // carries the names in order, and the two together rebuild `trip.travelers[]`: the list restores
    // the ORDER, which the ATTENDEE lines alone cannot do because a traveller with no address has no
    // ATTENDEE to sit in, and the ATTENDEE's `mailto:` supplies the address. A calendar from anywhere
    // else has no list, and then the ATTENDEEs, in the order they occur, are all there is to go on.
    //
    // A traveller's id is DERIVED from its position and name, not minted: the id is a value no
    // calendar carries and no export can put back, so a random one would make every import of the
    // same file differ from the last — which is how a round trip comes to look exact while losing
    // something. Two travellers with the SAME name are the fold's documented limit: the first
    // ATTENDEE bearing that name is the one the first of them takes.
    var pool = [];
    var poolSeen = Object.create(null);
    for (var e2 = 0; e2 < events.length; e2++) {
      var att = events[e2].props.ATTENDEE || [];
      for (var a = 0; a < att.length; a++) {
        var cn = paramDecode(att[a].params.CN || '');
        var mail = String(att[a].value || '').replace(/^mailto:/i, '');
        if (!cn && !mail) continue;
        var name = cn || mail;
        // One entry per traveller, however many events carry its ATTENDEE: the export writes the
        // travellers on every event, so a list that grew with the event count would come back from
        // its own file with each traveller repeated once per event.
        var poolKey = (name + '\u0000' + mail).toLowerCase();
        if (poolSeen[poolKey]) continue;
        poolSeen[poolKey] = true;
        pool.push({
          name: name,
          // A value that is not a `mailto:` URI is not an address the model's `EMAIL` means, so it is
          // not stored as one — it is still preserved, whole, by `ATTENDEE` below when the line is
          // not this app's own shape.
          email: /^mailto:/i.test(String(att[a].value || '')) ? mail : '',
          // A line this app did not write — anything with a parameter other than `CN`, or a value
          // that is not a `mailto:` — holds something the model has no field for, so it is kept
          // verbatim on the traveller and written back out as it arrived (REQ-504, REQ-515).
          raw: isOwnAttendeeShape(att[a]) ? null : serializeProperty(att[a]),
          used: false,
        });
      }
    }
    function claim(name) {
      for (var i2 = 0; i2 < pool.length; i2++) {
        if (pool[i2].used) continue;
        if (pool[i2].name.toLowerCase() === String(name).toLowerCase()) {
          pool[i2].used = true;
          return pool[i2];
        }
      }
      return null;
    }
    var listed = firstValue(calendarProps, 'X-TP-TRAVELERS');
    if (listed !== undefined) {
      unescapeText(String(listed)).split('\n').forEach(function (name) {
        if (!name) return;
        var hit = claim(name);
        addTraveler(trip, name, hit ? hit.email : '', hit ? hit.raw : null);
      });
    }
    for (var p = 0; p < pool.length; p++) {
      if (pool[p].used) continue;
      pool[p].used = true;
      addTraveler(trip, pool[p].name, pool[p].email, pool[p].raw);
    }
    // The traveller the model requires, when the calendar names none at all. A derived id for the
    // same reason as the destination placeholder above: nothing on the wire carries it.
    if (!trip.travelers.length) trip.travelers = [{ id: TP.model.derivedId('person', 0, ''), name: '', type: 'adult' }];

    dates.sort();
    if (dates.length) {
      trip.startDate = dates[0];
      trip.endDate = dates[dates.length - 1];
    }
    // Days carry dates but the trip's range is derived from the events, never stored from the
    // file as if it were a fact the calendar stated.

    trip = TP.model.normalize(trip, opts.docId);
    return trip;
  }

  function firstValue(props, name) {
    var list = props[name];
    if (!list || !list.length) return undefined;
    return list[0].value;
  }

  // One traveller, in the order the calendar listed it. The id is derived from that order and the
  // name (see pass 2), and the address — which the model has no field for — goes in the traveller's
  // bag, where the export reads it back from. A line richer than this app would write goes in the
  // same bag under `ATTENDEE`, whole, and comes back out verbatim.
  function addTraveler(trip, name, email, rawAttendee) {
    var t = {
      id: TP.model.derivedId('person', trip.travelers.length, name),
      name: name,
      type: 'adult',
    };
    trip.travelers.push(t);
    if (email) TP.model.bagSet(t, FORMAT, 'EMAIL', email);
    if (rawAttendee) TP.model.bagSet(t, FORMAT, 'ATTENDEE', rawAttendee);
  }

  function text(v) {
    return v === undefined ? '' : unescapeText(String(v));
  }

  function isoFrom(v) {
    var m = /^(\d{4})(\d{2})(\d{2})/.exec(String(v || ''));
    if (!m) return null;
    return m[1] + '-' + m[2] + '-' + m[3];
  }

  function timeFrom(v) {
    var m = /T(\d{2})(\d{2})/.exec(String(v || ''));
    if (!m) return undefined;
    return m[1] + ':' + m[2];
  }

  // The `HH:MM` an item's time has to be to become a DTSTART time. The model tolerates any string a
  // person typed in the itinerary editor, and the calendar has one slot with one syntax; anything
  // else is written as an all-day DTSTART and disclosed.
  function clockTime(v) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(v == null ? '' : v).trim());
    if (!m) return null;
    var h = Number(m[1]);
    if (h > 23 || Number(m[2]) > 59) return null;
    return (h < 10 ? '0' + h : String(h)) + ':' + m[2];
  }

  // The link this app carries on an itinerary item, as the calendar's `URL` property, or `null` when
  // the calendar cannot honestly carry it.
  //
  // `item.link` is FREE TEXT: the item editor takes any string, and `safeLink` deliberately renders a
  // value it will not linkify as plain text rather than dropping it. A `URL` property, though, is a
  // URI — RFC 5545's value type, the vendored validator's `URI` check, and the app's own
  // `format.linkifyTarget` all agree on "has a scheme" — so writing a value like `rain` into a URL
  // line produces a calendar this app's own validator refuses, which is the disagreement
  // `06-interchange.md` §2 forbids.
  //
  // A value is carried when it is ALREADY an absolute URL this app would use verbatim. That is the
  // same rule `costRaw` and `timeRaw` follow, and for the same reason: `www.example.com` linkifies to
  // `https://www.example.com`, so writing the linkified form would make the export a different value
  // from the one that went in, and the calendar would stop being a fixed point. Anything else stays
  // on the item, where `trip-data.json` keeps it and the bag keeps it; the `item.link` row of the
  // ledger states the condition.
  function calendarUrl(link) {
    var s = link == null ? '' : String(link).trim();
    if (!s) return null;
    return TP.format.linkifyTarget(s) === s ? s : null;
  }

  function durationFrom(ev) {
    var d = firstValue(ev.props, 'DURATION');
    if (d) {
      var m = /^-?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(String(d));
      if (m) {
        var mins = 0;
        if (m[1]) mins += Number(m[1]) * 1440;
        if (m[2]) mins += Number(m[2]) * 60;
        if (m[3]) mins += Number(m[3]);
        if (mins) return mins;
      }
    }
    return undefined;
  }

  function itemIdFrom(ev, tripId) {
    var uid = ev.props.UID ? ev.props.UID[0].value : null;
    var parsed = parseUid(uid);
    if (parsed && parsed.tripId === tripId) return parsed.itemId;
    return TP.uid();
  }

  // Is this UID the one THIS app derives for that entity? If so it is not a fact the file carries
  // that the model lacks — it is a function of `trip.id` and the entity's id, both of which the
  // model has — and keeping it in the bag would be keeping two copies of one truth: a day copied to
  // a new id would go on carrying the original's UID, and every `.ics` import would grow a bag the
  // payload did not have. A UID from anywhere else is a genuine fact and is preserved (REQ-515).
  function isOwnUid(uid, tripId, localId) {
    var parsed = parseUid(uid);
    return !!(parsed && parsed.tripId === tripId && parsed.itemId === localId);
  }

  function ensureDay(trip, index, date) {
    if (index[date]) return index[date];
    var day = {
      id: 'day-' + trip.days.length + '-' + date,
      date: date,
      title: '', stay: '', drive: '', chargeStops: '', nacs: '', summary: '',
      dining: [], tips: [], items: [],
    };
    trip.days.push(day);
    index[date] = day;
    return day;
  }

  // A day's id comes back from the UID this app wrote for it — the UID is
  // `{trip.id}/{day.id}@…`, exactly as an item's is, and reading it back is what keeps a day's
  // identity from being a fresh value after every import. Where the file came from somewhere else
  // the UID says nothing and the id derived from the DTSTART stands.
  //
  // The guard is for a file that names the same id twice, which a hand-edited calendar can do: an
  // id already on another day is never taken, so an import cannot produce two days with one id.
  function adoptDayId(trip, day, uid) {
    var parsed = parseUid(uid);
    if (!parsed || parsed.tripId !== trip.id) return;
    for (var i = 0; i < trip.days.length; i++) {
      if (trip.days[i] !== day && trip.days[i].id === parsed.itemId) return;
    }
    day.id = parsed.itemId;
  }

  function applyDayDescription(day, desc) {
    var lines = String(desc).split('\n');
    var dining = [];
    var tips = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (/^Stay: /.test(l)) day.stay = l.slice(6);
      else if (/^Drive: /.test(l)) day.drive = l.slice(7);
      else if (/^Charge stops: /.test(l)) day.chargeStops = l.slice(14);
      else if (/^NACS: /.test(l)) day.nacs = l.slice(6);
      else if (/^Summary: /.test(l)) day.summary = l.slice(9);
      else if (/^Dining: /.test(l)) dining = l.slice(8).split(';').map(trim).filter(Boolean);
      else if (/^Tips: /.test(l)) tips = l.slice(6).split(';').map(trim).filter(Boolean);
      else if (l) day.summary = day.summary ? day.summary + '\n' + l : l;
    }
    if (dining.length) day.dining = dining;
    if (tips.length) day.tips = tips;
  }

  function trim(s) { return String(s).trim(); }

  // Everything the canonical model does not name is preserved verbatim on the entity it came
  // from, so an unmodelled VALARM / RRULE / SEQUENCE survives a round trip (REQ-515).
  //
  // It takes a PROPERTY MAP, not an event: VCALENDAR properties have no VEVENT, and the trip is
  // where an unmodelled calendar-level property belongs.
  function carryBag(entity, props, known) {
    for (var name in props) {
      if (!Object.prototype.hasOwnProperty.call(props, name)) continue;
      if (known.indexOf(name) !== -1) continue;
      var list = props[name];
      if (list.length === 1) {
        var p = list[0];
        // A nested component is already its own lines (see the parser).
        if (p.block) { TP.model.bagSet(entity, FORMAT, name, p.value); continue; }
        var hasParams = Object.keys(p.params).length > 0;
        TP.model.bagSet(entity, FORMAT, name, hasParams ? serializeProperty(p) : p.value);
      } else {
        var joined = [];
        for (var i = 0; i < list.length; i++) joined.push(serializeProperty(list[i]));
        TP.model.bagSet(entity, FORMAT, name, joined.join('\n'));
      }
    }
  }

  // The ATTENDEE line this app writes for a traveller, and nothing else: a `CN` parameter and a
  // `mailto:` value. A line in this shape needs no bag — the traveller already holds the name and
  // the address, and re-synthesizing the line is exact. Anything else carries something the model
  // cannot hold, and is kept verbatim on the traveller.
  function isOwnAttendeeShape(p) {
    var names = Object.keys(p.params);
    if (names.length > 1) return false;
    if (names.length === 1 && names[0] !== 'CN') return false;
    return /^mailto:/i.test(String(p.value || ''));
  }

  function serializeProperty(p) {
    if (p.block) return p.value;
    var head = p.name;
    for (var k in p.params) {
      if (!Object.prototype.hasOwnProperty.call(p.params, k)) continue;
      // A parameter value has to be quoted when it holds a `:`, a `;` or a `,` — an unquoted colon
      // is read as the end of the parameter list, so writing one bare turns the line into a
      // different line on the way back in. The parser strips the quotes it reads, so a value that
      // needs them has to get them back here. (A space does not: RFC 5545 §3.1's SAFE-CHAR includes
      // WSP, which is why `CN=Ann Other` is written unquoted and re-read correctly.)
      var v = String(p.params[k]);
      if (!/^".*"$/.test(v) && /[:;,]/.test(v)) v = '"' + v.replace(/"/g, '') + '"';
      head += ';' + k + '=' + v;
    }
    return head + ':' + p.value;
  }

  function losses() {
    return TP.ledger.disclosures('ical');
  }

  return {
    ID: ID,
    FORMAT: FORMAT,
    UID_HOST: UID_HOST,
    LIMITS: LIMITS,
    detect: detect,
    escapeText: escapeText,
    unescapeText: unescapeText,
    paramEncode: paramEncode,
    paramDecode: paramDecode,
    fold: fold,
    unfold: unfold,
    parseLine: parseLine,
    uidFor: uidFor,
    parseUid: parseUid,
    toTrip: toTrip,
    fromTrip: fromTrip,
    losses: losses,
    dtStamp: dtStamp,
  };
})();
