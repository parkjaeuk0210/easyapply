import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { configurationIssues, redisConfig } from '../src/lib/server/config';

const baseline = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in baseline)) delete process.env[key];
  Object.assign(process.env, baseline);
});

function marketplaceConfig() {
  process.env.VERCEL = '1';
  process.env.EASYAPPLY_SIGNING_SECRET = 'fixture-signing-secret-at-least-32-bytes';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.KV_REST_API_URL = 'https://marketplace.example';
  process.env.KV_REST_API_TOKEN = 'fixture-marketplace-token';
}

test('Vercel Marketplace Redis credentials satisfy production configuration', () => {
  marketplaceConfig();
  assert.deepEqual(redisConfig(), { url: 'https://marketplace.example', token: 'fixture-marketplace-token' });
  assert(!configurationIssues().includes('rate_limit_store'));
});

test('explicit Upstash credentials take precedence as a complete pair', () => {
  marketplaceConfig();
  process.env.UPSTASH_REDIS_REST_URL = 'https://explicit.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fixture-explicit-token';
  assert.deepEqual(redisConfig(), { url: 'https://explicit.example', token: 'fixture-explicit-token' });
});

test('incomplete explicit credentials cannot borrow a token from another Redis', () => {
  marketplaceConfig();
  process.env.UPSTASH_REDIS_REST_URL = 'https://explicit.example';
  assert.equal(redisConfig().token, undefined);
  assert(configurationIssues().includes('rate_limit_store'));
});
