import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MAX_UPLOAD_BYTES, maxUploadBytes } from '../src/lib/limits';
import { validateUploadSpecs } from '../src/lib/server/uploads';
import { consumeUploads, prepareUploads, uploadManifest } from '../src/lib/server/staged-uploads';
import { privateKey, signUpload } from '../src/lib/server/tokens';
import { AppError } from '../src/lib/server/errors';
import { reserveUploadBudget } from '../src/lib/server/guard';

const sid = 'upload-test-session';
function fixture(data = Buffer.from('%PDF-1.7\nfixture')) {
  const pathname = `easyapply-tmp/${privateKey(sid)}/${Date.now()}-${randomUUID()}`;
  const files = [{ name: 'notice.pdf', mediaType: 'application/pdf', size: data.length, pathname }];
  const deleted: string[] = [];
  type Store = NonNullable<Parameters<typeof consumeUploads>[3]>;
  const store = {
    get: (async () => ({ statusCode: 200, blob: { size: data.length }, stream: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close(); } }) })) as unknown as Store['get'],
    del: (async (paths: string | string[]) => { deleted.push(...(Array.isArray(paths) ? paths : [paths])); }) as Store['del'],
  };
  return { data, files, deleted, store, ticket: signUpload(files, sid) };
}

test('upload metadata enforces 24 MiB total and 5 MiB per photo', () => {
  const pdf = { name: 'notice.pdf', mediaType: 'application/pdf', size: 25_165_824 };
  assert.doesNotThrow(() => validateUploadSpecs([pdf]));
  assert.throws(() => validateUploadSpecs([{ ...pdf, size: 25_165_825 }]), (e: AppError) => e.status === 413);
  const photo = { name: 'photo.jpg', mediaType: 'image/jpeg', size: 5_242_880 };
  assert.doesNotThrow(() => validateUploadSpecs(Array(4).fill(photo)));
  assert.throws(() => validateUploadSpecs(Array(5).fill(photo)), (e: AppError) => e.status === 413);
  assert.throws(() => validateUploadSpecs([{ ...photo, size: photo.size + 1 }]));
});

test('Anthropic uploads stop at 22 MiB so base64 stays under the 32 MB request limit', () => {
  assert.equal(maxUploadBytes('api'), 23_068_672);
  assert.equal(maxUploadBytes('cli'), 25_165_824);
  const pdf = { name: 'notice.pdf', mediaType: 'application/pdf', size: 23_068_673 };
  assert.throws(() => validateUploadSpecs([pdf], maxUploadBytes('api')), (e: AppError) => e.status === 413 && /22MB/.test(e.message));
  // base64 of the largest accepted PDF plus ~1 MB of prompt and schema still fits.
  assert(Math.ceil(23_068_672 / 3) * 4 + 1_000_000 < 32_000_000);
});

test('upload tickets reject another session, tampering and paths outside the session', () => {
  const f = fixture();
  assert.deepEqual(uploadManifest(f.ticket, sid), f.files);
  assert.throws(() => uploadManifest(f.ticket, 'another-session'));
  assert.throws(() => uploadManifest(f.ticket + 'x', sid));
  assert.throws(() => uploadManifest(signUpload([{ ...f.files[0], pathname: 'https://example.com/private.pdf' }], sid), sid));
});

test('valid temporary upload is read and deleted before analysis', async () => {
  const f = fixture();
  const files = await consumeUploads(f.ticket, sid, new AbortController().signal, f.store);
  assert.deepEqual(files[0].data, f.data);
  assert.deepEqual(f.deleted, [f.files[0].pathname]);
});

test('invalid contents and cancelled requests still delete temporary files', async () => {
  const bad = fixture(Buffer.from('not a PDF'));
  await assert.rejects(consumeUploads(bad.ticket, sid, new AbortController().signal, bad.store), (e: AppError) => e.code === 'invalid_file');
  assert.deepEqual(bad.deleted, [bad.files[0].pathname]);
  const aborted = fixture(), controller = new AbortController();
  controller.abort();
  await assert.rejects(consumeUploads(aborted.ticket, sid, controller.signal, aborted.store));
  assert.deepEqual(aborted.deleted, [aborted.files[0].pathname]);
});

test('a stream larger than its declared metadata is stopped and deleted', async () => {
  const f = fixture();
  f.store.get = (async () => ({ statusCode: 200, blob: { size: f.data.length }, stream: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Buffer.alloc(f.data.length + 1)); c.close(); } }) })) as unknown as typeof f.store.get;
  await assert.rejects(consumeUploads(f.ticket, sid, new AbortController().signal, f.store), (e: AppError) => e.status === 413);
  assert.deepEqual(f.deleted, [f.files[0].pathname]);
});

test('upload metadata is checked before charging and exhausted budget rejects before signing or storage calls', async () => {
  const env = { ...process.env }, originalFetch = globalThis.fetch;
  try {
    Object.assign(process.env, { NODE_ENV: 'test' });
    process.env.EASYAPPLY_USAGE_LIMITS='on';
    for (const key of ['VERCEL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete process.env[key];
    process.env.BLOB_STORE_ID = 'test-budget-no-storage'; process.env.CRON_SECRET = 'test-cron';
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('Storage must not be reached'); };
    const req = new Request('http://localhost:3123/api/uploads'), id = 'budget-before-signing';
    await assert.rejects(prepareUploads({ files: [{ name: 'bad.pdf', mediaType: 'application/pdf', size: MAX_UPLOAD_BYTES + 1 }] }, id, req), (e: AppError) => e.code === 'too_large' && e.status === 413);
    // The invalid grant charged nothing: all ten full-size grants still fit.
    for (let i = 0; i < 10; i++) await reserveUploadBudget(req, id, MAX_UPLOAD_BYTES, 1);
    await assert.rejects(prepareUploads({ files: [{ name: 'notice.pdf', mediaType: 'application/pdf', size: 1 }] }, id, req), (e: AppError) => e.code === 'upload_limit' && e.status === 429);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});
