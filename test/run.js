#!/usr/bin/env node
'use strict';

// The test runner (specs/09-testing.md).
//
//   node test/run.js            every test file
//   node test/run.js history    files whose name contains "history"
//
// A flag given to the runner is given to every test process it starts, so
// `node --no-sparkplug test/run.js` covers the whole run and not just this process. See
// `inheritedArgv` for why that had to be arranged rather than assumed.
//
// No framework, no dependency, nothing to install — the same rule as the build (REQ-107). Each test
// file exports `{ name, tests: [{ name, run(t) }], skip? }`; a test that throws fails, and the runner
// reports the failing assertion with its stack.
//
// EVERY FILE RUNS IN ITS OWN PROCESS. That is not a performance choice; it is the difference between
// a suite whose result can be trusted and one whose result cannot. A test that takes the process down
// with it — a native fault, a stack overflow at the wrong moment, an OOM — produces no output at all
// in a single-process runner, and a run with no output is a run whose failures are invisible. Here it
// is one named file reported as crashed, with the signal that killed it, and every other file still
// runs. (`test/canonical.test.js` carries a note about one such fault found while writing this.)
//
// The browser-driven files declare `skip` and their reason until the browser driver is present: a
// suite that reports a pass for tests it did not run is worse than one that reports nothing.

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var HERE = __dirname;
var SELF = __filename;
var MARKER = '@@runner-result@@';

function discover(filter) {
  return fs.readdirSync(HERE)
    .filter(function (f) { return /\.test\.js$/.test(f); })
    .filter(function (f) { return !filter || f.indexOf(filter) !== -1; })
    .sort()
    .map(function (f) { return path.join(HERE, f); });
}

function label(file) {
  return path.basename(file);
}

function paint(ok, text) {
  if (!process.stdout.isTTY) return text;
  return (ok ? '\u001b[32m' : '\u001b[31m') + text + '\u001b[0m';
}

// ---- Child mode: run one file, print every result as JSON ----

async function inChild(file) {
  var mod = require(file);
  var results = {
    file: label(file),
    name: mod.name || label(file),
    skip: mod.skip || null,
    tests: [],
  };

  if (!mod.skip) {
    for (var i = 0; i < (mod.tests || []).length; i++) {
      var test = mod.tests[i];
      var started = Date.now();
      try {
        await test.run();
        results.tests.push({ name: test.name, ok: true, ms: Date.now() - started });
      } catch (e) {
        results.tests.push({
          name: test.name,
          ok: false,
          ms: Date.now() - started,
          message: (e && e.message) || String(e),
          stack: (e && e.stack) || '',
        });
      }
    }
  }

  process.stdout.write(MARKER + JSON.stringify(results) + '\n');
}

// ---- Parent mode ----

function parseChild(stdout) {
  var at = stdout.lastIndexOf(MARKER);
  if (at === -1) return null;
  var line = stdout.slice(at + MARKER.length).split('\n')[0];
  try {
    return JSON.parse(line);
  } catch (e) {
    return null;
  }
}

// Flags given to the runner reach the processes it starts.
//
// Every file runs in its own process, started from `process.execPath` with nothing but the file
// name — so without this, a flag on the command line applies to the parent and to nothing else.
// That is not a neutral default: `node --no-sparkplug test/run.js` reads as though it covers the
// run, and it covers one process out of twenty. A flag that silently does almost nothing is worse
// than one that does nothing, because the person who typed it believes the run is covered.
//
// The flags that own a port or a file are left behind. Each child binding the same inspector
// address would turn one suite run into a wall of "address already in use", and a child writing
// its own heap snapshot over the parent's would be a worse surprise than the flag not applying.
var KEPT_BY_THE_PARENT = /^--(inspect|debug|prof|heapsnapshot|cpu-prof|report-|diagnostic-dir)/;

function inheritedArgv() {
  return process.execArgv.filter(function (arg) { return !KEPT_BY_THE_PARENT.test(arg); });
}

function runFile(file) {
  var outcome = childProcess.spawnSync(process.execPath, inheritedArgv().concat([SELF, '--one', file]), {
    encoding: 'utf8',
    cwd: path.join(HERE, '..'),
    timeout: 300000,
    maxBuffer: 64 * 1024 * 1024,
  });

  var results = parseChild(outcome.stdout || '');
  if (results) return { results: results, noise: (outcome.stdout || '').split(MARKER)[0] };

  // No result block: the file crashed, hung, or could not be loaded. The signal is the useful part —
  // it distinguishes a segfault from a timeout from a syntax error.
  var how = outcome.signal
    ? 'killed by ' + outcome.signal
    : 'exited with status ' + outcome.status;
  return {
    results: {
      file: label(file),
      name: label(file),
      skip: null,
      tests: [{
        name: 'the file runs to completion',
        ok: false,
        ms: 0,
        message: 'the test process produced no result — ' + how +
          (outcome.error ? ' (' + outcome.error.message + ')' : ''),
        stack: (outcome.stderr || '').split('\n').slice(-12).join('\n'),
      }],
    },
    noise: (outcome.stdout || '') + (outcome.stderr || ''),
  };
}

async function main() {
  var args = process.argv.slice(2);
  if (args[0] === '--one') return inChild(args[1]);

  var filter = args[0] || '';
  var files = discover(filter);
  if (!files.length) {
    console.error('No test files match ' + JSON.stringify(filter) + '.');
    process.exit(1);
  }

  var total = 0;
  var failed = 0;
  var skippedFiles = [];

  for (var i = 0; i < files.length; i++) {
    var run = runFile(files[i]);
    var results = run.results;

    if (results.skip) {
      skippedFiles.push(results.file + ' — ' + results.skip);
      continue;
    }

    if (run.noise && run.noise.trim()) {
      // Anything the child wrote outside the result block is a message for a human. It is shown
      // rather than swallowed: a warning printed by the program under test is a finding.
      console.log('\n' + results.file + '  (output from the test process)');
      console.log(run.noise.trim().split('\n').map(function (l) { return '  | ' + l; }).join('\n'));
    }

    var bad = results.tests.filter(function (t) { return !t.ok; }).length;
    total += results.tests.length;
    failed += bad;
    console.log('\n' + results.file + (results.name && results.name !== results.file ? '  (' + results.name + ')' : ''));
    results.tests.forEach(function (t) {
      console.log('  ' + (t.ok ? paint(true, 'ok  ') : paint(false, 'FAIL')) + '  ' + t.name +
        '  ' + paint(true, t.ms + 'ms'));
      if (!t.ok) {
        console.log('        ' + t.message);
        (t.stack || '').split('\n').slice(1, 4).forEach(function (f) {
          console.log('        ' + f.trim());
        });
      }
    });
  }

  console.log('\n' + total + ' tests, ' + failed + ' failed' +
    (skippedFiles.length ? ', ' + skippedFiles.length + ' file(s) skipped' : '') + '.');
  skippedFiles.forEach(function (s) { console.log('  skipped: ' + s); });
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error('The runner itself failed: ' + ((e && e.stack) || e));
  process.exit(1);
});
