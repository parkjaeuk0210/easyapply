import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureStreamAsyncIterator } from '../src/lib/browser-stream';

test('PDF stream compatibility preserves native support and handles old Safari readers', async () => {
  const proto = ReadableStream.prototype;
  const native = Object.getOwnPropertyDescriptor(proto, Symbol.asyncIterator)!;
  ensureStreamAsyncIterator();
  assert.equal(Object.getOwnPropertyDescriptor(proto, Symbol.asyncIterator)?.value, native.value);
  try {
    Reflect.deleteProperty(proto, Symbol.asyncIterator);
    ensureStreamAsyncIterator();
    const stream = new ReadableStream<number>({ start(c) { c.enqueue(1); c.enqueue(2); c.close(); } });
    const values = [];
    for await (const value of stream as unknown as AsyncIterable<number>) values.push(value);
    assert.deepEqual(values, [1, 2]);
    assert.equal(stream.locked, false);
    let cancelled = false;
    const early = new ReadableStream<number>({ start(c) { c.enqueue(1); }, cancel() { cancelled = true; } });
    for await (const value of early as unknown as AsyncIterable<number>) { assert.equal(value, 1); break; }
    assert.equal(cancelled, true);
    assert.equal(early.locked, false);
  } finally { Object.defineProperty(proto, Symbol.asyncIterator, native); }
});
