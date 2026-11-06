/** Safari versions without ReadableStream async iteration still support readers. */
export function ensureStreamAsyncIterator() {
  if (typeof ReadableStream === "undefined" || Symbol.asyncIterator in ReadableStream.prototype) return;
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    configurable: true, writable: true,
    value: async function* (this: ReadableStream<unknown>, options?: { preventCancel?: boolean }) {
      const reader = this.getReader();
      let done = false;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) { done = true; return; }
          yield next.value;
        }
      } finally {
        if (!done && !options?.preventCancel) await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    },
  });
}
