import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { configurationIssues, redisConfig, openAIConfig, usageLimitsEnabled } from '../src/lib/server/config';

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

test('judging defaults to no usage quotas and ignores legacy limit configuration', () => {
  delete process.env.EASYAPPLY_USAGE_LIMITS;
  assert.equal(usageLimitsEnabled(), false);
  process.env.EASYAPPLY_DAILY_AI_LIMIT='invalid-unused-limit';
  assert(!configurationIssues().includes('limits'));
  process.env.EASYAPPLY_USAGE_LIMITS='on';
  assert.equal(usageLimitsEnabled(), true);
  assert(configurationIssues().includes('limits'));
});

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

test('Astra defaults to medium Fast and rejects unsupported none reasoning', () => {
  process.env.EASYAPPLY_PROVIDER = 'openai';
  process.env.OPENAI_API_KEY = 'test-not-real';
  delete process.env.EASYAPPLY_OPENAI_MODEL;
  delete process.env.EASYAPPLY_OPENAI_REASONING_EFFORT;
  delete process.env.EASYAPPLY_OPENAI_SERVICE_TIER;
  assert.deepEqual(openAIConfig(), { model:'gpt-6-astra', reasoning:{effort:'medium'}, service_tier:'fast' });
  process.env.EASYAPPLY_OPENAI_REASONING_EFFORT='none';
  assert(configurationIssues().includes('openai_settings'));
  process.env.EASYAPPLY_OPENAI_REASONING_EFFORT='medium';
  process.env.EASYAPPLY_OPENAI_SERVICE_TIER='invalid';
  assert(configurationIssues().includes('openai_settings'));
});

test('an OpenAI setting typo cannot take down an Anthropic deployment', () => {
  process.env.EASYAPPLY_PROVIDER = 'api';
  process.env.ANTHROPIC_API_KEY = 'test-not-real';
  process.env.OPENAI_API_KEY = 'test-not-real';
  process.env.EASYAPPLY_OPENAI_SERVICE_TIER = 'fsat';
  assert.deepEqual(configurationIssues(), []);
  process.env.EASYAPPLY_ANTHROPIC_SPEED = 'fsat';
  assert(configurationIssues().includes('ai_settings'));
});

test('an unknown provider name is a configuration issue, not a silent fallback', () => {
  process.env.EASYAPPLY_PROVIDER = 'antrhopic';
  process.env.ANTHROPIC_API_KEY = 'test-not-real';
  assert(configurationIssues().includes('provider'));
});

test('check:config fails on a provider typo instead of reporting ready', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'easyapply-check-config-'));
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, TSX_DISABLE_CACHE: process.env.TSX_DISABLE_CACHE, NODE_ENV: 'production' as const,
    EASYAPPLY_PROVIDER: 'antrhopic', ANTHROPIC_API_KEY: 'test-not-real',
    EASYAPPLY_SIGNING_SECRET: 'fixture-signing-secret-at-least-32-bytes',
    KV_REST_API_URL: 'https://marketplace.example', KV_REST_API_TOKEN: 'fixture-token',
  };
  try {
    // A directory without .env.local keeps developer keys out of the check.
    const run = promisify(execFile)(path.resolve('node_modules/.bin/tsx'), [path.resolve('scripts/check-config.ts'), '--production'], { cwd: dir, env });
    const failure = await run.then(() => null, (error: { code: number; stdout: string }) => error);
    assert.equal(failure?.code, 1);
    const report = JSON.parse(failure!.stdout);
    assert.equal(report.ready, false);
    assert.equal(report.provider, 'none');
    assert(report.issues.includes('provider'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
