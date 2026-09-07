// Exercise the production worker in a worker-like VM, including the emitted WASM.
// This is an artifact integration check, not a replacement for browser UI testing.
import { readFile, readdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import problems from '../src/catalog.js';

const dist = new URL('../dist/', import.meta.url);
const assets = await readdir(new URL('assets/', dist));
const workerFile = assets.find((name) => name.startsWith('sql.worker-'));
const source = await readFile(new URL(`assets/${workerFile}`, dist), 'utf8');
const messages = [];
const scope = {
  console,
  WebAssembly,
  // WebAssembly is injected from the host realm, so its native exceptions must
  // share that realm too. sql.js catches TypeError when wrapping JS callbacks.
  TypeError,
  performance,
  URL,
  TextDecoder,
  TextEncoder,
  structuredClone,
  setTimeout,
  clearTimeout,
  Response,
  location: { href: `https://leetviewer.invalid/assets/${workerFile}` },
  importScripts() {},
  async fetch(url) {
    const pathname = new URL(url, scope.location.href).pathname;
    assert.match(pathname, /^\/assets\/sql-wasm-[\w-]+\.wasm$/);
    return new Response(await readFile(new URL(pathname.slice(1), dist)), {
      headers: { 'Content-Type': 'application/wasm' },
    });
  },
  postMessage(message) {
    messages.push(JSON.parse(JSON.stringify(message)));
  },
};
scope.self = scope;
runInNewContext(
  source.replaceAll('import.meta.url', JSON.stringify(scope.location.href)),
  scope,
);
await scope.onmessage({ data: { id: 1, type: 'init', problem: problems[0] } });
assert.equal(messages[0].error, undefined);
assert.equal(messages[0].result.length, 2);
await scope.onmessage({ data: { id: 2, type: 'run', sql: problems[0].query } });
assert.equal(messages[1].error, undefined);
assert.equal(messages[1].result.final.values.length, 5);
assert.equal(messages[1].result.final.values[0][0], null);
await scope.onmessage({
  data: { id: 3, type: 'run', sql: 'SELECT missing FROM Employees' },
});
assert.match(messages[2].error, /no such column/);
console.log(
  'Production worker + local WASM: initialization, JOIN, NULL and errors verified.',
);
const manager = problems.find((problem) => problem.id === 570);
await scope.onmessage({ data: { id: 4, type: 'init', problem: manager } });
await scope.onmessage({ data: { id: 5, type: 'run', sql: manager.query } });
assert.equal(messages.at(-1).error, undefined);
const trace = messages.at(-1).result.animation;
assert.equal(trace.supported, true);
assert.equal(
  trace.stages.find((s) => s.op === 'join').tables[0].rows.length,
  7,
);
assert.deepEqual(
  trace.stages
    .find((s) => s.op === 'group')
    .tables[0].groups.map((g) => g.count),
  [5, 2],
);
assert.equal(
  trace.stages.find((s) => s.op === 'having').tables[0].rows.length,
  1,
);
assert.deepEqual(
  trace.stages.at(-1).tables[0].rows.map((r) => r.cells.map((c) => c.value)),
  [['John']],
);
for (const problem of problems) {
  await scope.onmessage({ data: { id: 6, type: 'init', problem } });
  await scope.onmessage({ data: { id: 7, type: 'run', sql: problem.query } });
  assert.equal(messages.at(-1).error, undefined);
  assert.equal(
    messages.at(-1).result.animation?.supported,
    true,
    problem.title,
  );
  const result = messages.at(-1).result;
  assert.deepEqual(
    result.final.values.map(row => JSON.stringify(row)).sort(),
    problem.expected.map(row => JSON.stringify(row)).sort(),
    problem.title,
  );
}
await scope.onmessage({
  data: { id: 8, type: 'run', sql: 'SELECT (SELECT 1)' },
});
assert.equal(messages.at(-1).result.animation, null);
assert.match(messages.at(-1).result.animationReason, /subconsultas/i);
assert.deepEqual(messages.at(-1).result.final.values, [[1]]);
console.log(
  'Production SQL 50: all 50 reference results and animations verified, including isolated DELETE and REGEXP.',
);
