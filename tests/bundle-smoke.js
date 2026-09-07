// Exercise the production worker in a worker-like VM, including the emitted WASM.
// This is an artifact integration check, not a replacement for browser UI testing.
import { readFile, readdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

const dist = new URL('../dist/', import.meta.url);
const assets = await readdir(new URL('assets/', dist));
const workerFile = assets.find(name => name.startsWith('sql.worker-'));
const source = await readFile(new URL(`assets/${workerFile}`, dist), 'utf8');
const problems = JSON.parse(await readFile(new URL('../src/problems.json', import.meta.url)));
const messages = [];
const scope = {
  console, WebAssembly, performance, URL, TextDecoder, TextEncoder,
  setTimeout, clearTimeout, Response,
  location: { href: `https://leetviewer.invalid/assets/${workerFile}` },
  importScripts() {},
  async fetch(url) {
    const pathname = new URL(url, scope.location.href).pathname;
    assert.match(pathname, /^\/assets\/sql-wasm-[\w-]+\.wasm$/);
    return new Response(await readFile(new URL(pathname.slice(1), dist)), {
      headers: { 'Content-Type': 'application/wasm' },
    });
  },
  postMessage(message) { messages.push(JSON.parse(JSON.stringify(message))); },
};
scope.self = scope;
runInNewContext(source.replaceAll('import.meta.url', JSON.stringify(scope.location.href)), scope);
await scope.onmessage({ data: { id: 1, type: 'init', problem: problems[0] } });
assert.equal(messages[0].error, undefined);
assert.equal(messages[0].result.length, 2);
await scope.onmessage({ data: { id: 2, type: 'run', sql: problems[0].query } });
assert.equal(messages[1].error, undefined);
assert.equal(messages[1].result.final.values.length, 5);
assert.equal(messages[1].result.final.values[0][0], null);
await scope.onmessage({ data: { id: 3, type: 'run', sql: 'SELECT missing FROM Employees' } });
assert.match(messages[2].error, /no such column/);
console.log('Production worker + local WASM: initialization, JOIN, NULL and errors verified.');
