import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { runStructured } from '../src/lib/llm';
import { ANALYSIS_OUTPUT_TOKENS, MATCH_OUTPUT_TOKENS, matchOutputTokens } from '../src/lib/llm-limits';

type Provider = 'api';
type Reply = {
  json?: string;
  stop?: 'complete' | 'output_limit' | 'other_incomplete';
  outputTokens?: number;
  thinkingOnly?: boolean;
  authenticationError?: boolean;
};

const schema = z.object({ result: z.string() });
const options = { system: 'Return the fixture result.', text: 'Synthetic document.', schema };

function anthropicStream(res: ServerResponse, reply: Reply) {
  const send = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const stopReason = reply.stop === 'output_limit' ? 'max_tokens' : reply.stop === 'other_incomplete' ? 'model_context_window_exceeded' : 'tool_use';
  send('message_start', { message: { id: 'msg_length', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0, speed: 'fast' } } });
  send('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
  send('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'Synthetic reasoning.' } });
  send('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'synthetic-signature' } });
  send('content_block_stop', { index: 0 });
  if (!reply.thinkingOnly) {
    send('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'tool_length', name: 'easyapply_result', input: {} } });
    const json = reply.json ?? '{"result":"ok"}';
    const midpoint = Math.floor(json.length / 2);
    send('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: json.slice(0, midpoint) } });
    send('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: json.slice(midpoint) } });
    send('content_block_stop', { index: 1 });
  }
  send('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: reply.outputTokens ?? 3, speed: 'fast', output_tokens_details: { thinking_tokens: reply.thinkingOnly ? reply.outputTokens : 1 } } });
  send('message_stop', {});
}

async function withProvider(provider: Provider, reply: Reply, check: (bodies: Record<string, unknown>[]) => Promise<void>) {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    let input = '';
    for await (const chunk of req) input += chunk;
    bodies.push(JSON.parse(input));
    if (reply.authenticationError) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', code: 'invalid_api_key', message: 'PRIVATE_FIXTURE_CREDENTIAL' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    anthropicStream(res, reply);
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseURL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const overrides: Record<string, string | undefined> = {
    EASYAPPLY_PROVIDER: provider,
    ANTHROPIC_API_KEY: 'test-only', ANTHROPIC_AUTH_TOKEN: undefined, ANTHROPIC_BASE_URL: baseURL, ANTHROPIC_LOG: undefined,
    EASYAPPLY_EFFORT: 'medium', EASYAPPLY_ANTHROPIC_SPEED: 'fast',
    EASYAPPLY_REQUEST_TIMEOUT_MS: '5000',
  };
  const original = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  const assign = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    assign(overrides);
    await check(bodies);
  } finally {
    assign(original);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

for (const provider of ['api'] as const) {
  test(`${provider}: analysis streams with 32000 output tokens and match with 16000`, async () => {
    assert.equal(ANALYSIS_OUTPUT_TOKENS, 32_000);
    assert.equal(MATCH_OUTPUT_TOKENS, 16_000);
    await withProvider(provider, {}, async (bodies) => {
      for (const [maxTokens, expected] of [[undefined, 32_000], [matchOutputTokens(), 16_000]] as const) {
        const requestsBefore = bodies.length;
        const result = await runStructured({ ...options, maxTokens });
        assert.deepEqual(result.data, { result: 'ok' });
        assert.equal(result.provider, provider);
        assert.equal(bodies.length, requestsBefore + 1);
        assert.equal(bodies.at(-1)?.max_tokens, expected);
        assert.equal(bodies.at(-1)?.stream, true);
      }
    });
  });

  test(`${provider}: output budgets can be raised from the environment`, async () => {
    process.env.EASYAPPLY_ANALYZE_OUTPUT_TOKENS = '48000';
    try {
      await withProvider(provider, {}, async (bodies) => {
        await runStructured(options);
        assert.equal(bodies.at(-1)?.max_tokens, 48_000);
      });
    } finally { delete process.env.EASYAPPLY_ANALYZE_OUTPUT_TOKENS; }
  });

  test(`${provider}: a complete result beyond the former 16000 output budget is retained`, async () => {
    const result = '가'.repeat(20_000);
    await withProvider(provider, { json: JSON.stringify({ result }), outputTokens: 24_000 }, async (bodies) => {
      assert.deepEqual((await runStructured(options)).data, { result });
      assert.equal(bodies.length, 1);
    });
  });

  for (const json of ['{"result":"unfinished"', '{"result":"unfinished"}']) {
    test(`${provider}: output exhaustion rejects ${json.endsWith('}') ? 'valid-looking' : 'partial'} JSON without retry`, async (t) => {
      const logs: string[] = [];
      t.mock.method(console, 'info', (value: string) => { logs.push(value); });
      await withProvider(provider, { json, stop: 'output_limit', outputTokens: 128_000 }, async (bodies) => {
        await assert.rejects(runStructured(options), { name: 'AppError', code: 'output_limit', status: 502 });
        assert.equal(bodies.length, 1);
        const usage = logs.map((line) => JSON.parse(line)).find((event) => event.event === 'ai_usage');
        assert.equal(usage?.stop_reason, 'max_tokens');
        assert.equal(usage?.output_tokens, 128_000);
        assert.equal(usage?.max_output_tokens, 32_000);
      });
    });
  }

  test(`${provider}: an incomplete response for another reason is retried once and not mislabeled output exhaustion`, async () => {
    await withProvider(provider, { stop: 'other_incomplete' }, async (bodies) => {
      await assert.rejects(runStructured(options), { name: 'AppError', code: 'bad_output', status: 502 });
      assert.equal(bodies.length, 2);
    });
  });

  test(`${provider}: invalid schema output is retried once, then rejected`, async () => {
    await withProvider(provider, { json: '{"result":42}' }, async (bodies) => {
      await assert.rejects(runStructured(options), { name: 'AppError', code: 'bad_output', status: 502 });
      assert.equal(bodies.length, 2);
    });
  });

  test(`${provider}: authentication failure is not retried or exposed`, async () => {
    await withProvider(provider, { authenticationError: true }, async (bodies) => {
      await assert.rejects(runStructured(options), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { code?: string }).code, 'provider_auth');
        assert.doesNotMatch(error.message, /PRIVATE_FIXTURE/);
        return true;
      });
      assert.equal(bodies.length, 1);
    });
  });
}

test('api: thinking alone can exhaust the output budget and is never accepted as a result', async () => {
  await withProvider('api', { stop: 'output_limit', outputTokens: 128_000, thinkingOnly: true }, async (bodies) => {
    await assert.rejects(runStructured(options), { name: 'AppError', code: 'output_limit', status: 502 });
    assert.equal(bodies.length, 1);
  });
});
