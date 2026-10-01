// The mock transport (settings → Mock).
//
// No network, no key, no spend. It returns a scripted sequence rather than a plausible answer, so
// the entire loop — dispatch, write-back into the trip, the working payload, the commit, the
// re-render — is exercised end to end without a model. That is what makes it worth keeping: it is
// a test of the app, not a demo of the AI.
//
//   call 1 → web_search
//   call 2 → web_fetch
//   call 3 → set_day_plan (which writes into the trip)
//   call 4 → final text, no tool calls

TP.ai.mock = (function () {
  'use strict';

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function envelope(content, toolCalls) {
    return {
      choices: [{
        index: 0,
        message: { role: 'assistant', content: content == null ? null : content, tool_calls: toolCalls },
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  function call(n, name, args) {
    return { id: 'call_' + n, type: 'function', function: { name: name, arguments: JSON.stringify(args) } };
  }

  function chat(options, cfg) {
    return delay(250).then(function () {
      var toolTurns = (options.messages || []).filter(function (m) { return m.role === 'tool'; }).length;

      if (toolTurns === 0) {
        return { ok: true, data: envelope('I will research the options for this trip first.', [
          call(1, 'web_search', { query: 'best things to do in the destination, top attractions' }),
        ]) };
      }
      if (toolTurns === 1) {
        return { ok: true, data: envelope('Let me read one of those results.', [
          call(2, 'web_fetch', { url: 'https://example.com/top-attractions' }),
        ]) };
      }
      if (toolTurns === 2) {
        return { ok: true, data: envelope('Now I will write the first day into your itinerary.', [
          call(3, 'set_day_plan', {
            dayIndex: 0,
            items: [
              { type: 'lodging', title: 'Check in to the hotel', time: '14:00', location: 'City centre', notes: 'Mock item' },
              { type: 'activity', title: 'Walking tour of the old town', time: '16:00', durationMin: 120, location: 'Old town', cost: 25 },
              { type: 'activity', title: 'Dinner at a local bistro', time: '19:30', location: 'Main square', cost: 40 },
            ],
          }),
        ]) };
      }

      return { ok: true, data: envelope(
        'I have planned your first day: check-in, an afternoon walking tour, and dinner at a local bistro.\n\n' +
        'This came from the **mock transport** (Settings → Mock transport), so no real service was contacted ' +
        'and no key was used. Turn the mock off to use the configured AI.\n\n' +
        'Sources: https://example.com/top-attractions', null) };
    });
  }

  function webSearch(options) {
    return delay(200).then(function () {
      return { ok: true, data: { results: [
        { title: 'Top attractions in the destination', url: 'https://example.com/top-attractions',
          content: 'A mock search result for: ' + options.query + '. Lists museums, food markets and viewpoints.' },
        { title: 'Travel guide', url: 'https://example.com/guide',
          content: 'A mock guide with transport tips and seasonal advice.' },
      ] } };
    });
  }

  function webFetch() {
    return delay(200).then(function () {
      return { ok: true, data: {
        title: 'Top attractions in the destination',
        content: 'Mock page content: the old-town walking route takes about two hours. Bistros open at 18:00. ' +
          'An average dinner costs 35-45 in local currency.',
        links: ['https://example.com/old-town'],
      } };
    });
  }

  function testConnection(cfg) {
    return delay(200).then(function () {
      return { ok: true, model: 'mock', replied: 'ok', note: 'The mock transport answers without a network. ' + (cfg ? TP.ai.transport.modeLabel(cfg) : '') };
    });
  }

  return {
    chat: chat,
    webSearch: webSearch,
    webFetch: webFetch,
    testConnection: testConnection,
  };
})();
