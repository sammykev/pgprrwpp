'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { runNvidiaTask, stripThinking } = require('../src/main/nvidia');

// Fake fetch that streams the given content pieces as OpenAI-style SSE events,
// split at awkward byte boundaries to exercise the line buffering.
function fakeFetch(pieces, { status = 200, finish = 'stop' } = {}) {
  const calls = [];
  const events = pieces.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
  events.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`, 'data: [DONE]\n\n');
  const bytes = Buffer.from(events.join(''));
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return {
      ok: status === 200,
      status,
      text: async () => 'error body',
      body: (async function* () {
        for (let i = 0; i < bytes.length; i += 7) yield bytes.subarray(i, i + 7);
      })(),
    };
  };
  return { fetchImpl, calls };
}

test('streams paraphrase text through the OpenAI-compatible endpoint', async () => {
  const { fetchImpl, calls } = fakeFetch(['He travels ', 'to school', ' daily.']);
  let streamed = '';
  const r = await runNvidiaTask({ apiKey: 'nvapi-x', model: 'm/x', task: 'paraphrase', input: 'He goes to school.', fetchImpl, onDelta: (t) => { streamed += t; } });
  assert.strictEqual(r.text, 'He travels to school daily.');
  assert.strictEqual(streamed, r.text);
  assert.strictEqual(calls[0].url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer nvapi-x');
  assert.strictEqual(calls[0].body.model, 'm/x');
  assert.strictEqual(calls[0].body.stream, true);
  assert.strictEqual(calls[0].body.messages[0].role, 'system');
});

test('hides <think> reasoning from streamed and final text', async () => {
  const { fetchImpl } = fakeFetch(['<thi', 'nk>let me plan', ' this</th', 'ink>\n\nFinal ', 'answer.']);
  let streamed = '';
  const r = await runNvidiaTask({ apiKey: 'k', task: 'rewrite', input: 'x', fetchImpl, onDelta: (t) => { streamed += t; } });
  assert.strictEqual(r.text, 'Final answer.');
  assert.strictEqual(streamed, 'Final answer.');
  assert.strictEqual(stripThinking('<think>unfinished'), '');
});

test('proofread asks for JSON and tolerates code fences', async () => {
  const data = { corrected_text: 'I am.', issues: [] };
  const { fetchImpl, calls } = fakeFetch(['```json\n', JSON.stringify(data), '\n```']);
  const r = await runNvidiaTask({ apiKey: 'k', task: 'proofread', input: 'I is.', fetchImpl });
  assert.deepStrictEqual(r.data, data);
  assert.match(calls[0].body.messages[0].content, /JSON Schema/);
});

test('web-search tools are refused without calling the API', async () => {
  const { fetchImpl, calls } = fakeFetch([]);
  await assert.rejects(runNvidiaTask({ apiKey: 'k', task: 'originality', input: 'x', fetchImpl }), /web search/);
  await assert.rejects(runNvidiaTask({ apiKey: 'k', task: 'compose', input: 'x', opts: { research: true }, fetchImpl }), /Untick/);
  assert.strictEqual(calls.length, 0);
});

test('HTTP errors become friendly messages', async () => {
  await assert.rejects(runNvidiaTask({ apiKey: 'k', task: 'rewrite', input: 'x', fetchImpl: fakeFetch([], { status: 401 }).fetchImpl }), /key was rejected/);
  await assert.rejects(runNvidiaTask({ apiKey: 'k', task: 'rewrite', input: 'x', fetchImpl: fakeFetch([], { status: 429 }).fetchImpl }), /rate limit/);
  await assert.rejects(runNvidiaTask({ apiKey: '', task: 'rewrite', input: 'x', fetchImpl: fakeFetch([]).fetchImpl }), /Add your NVIDIA API key/);
});

test('length cut-off is reported', async () => {
  const { fetchImpl } = fakeFetch(['partial'], { finish: 'length' });
  const r = await runNvidiaTask({ apiKey: 'k', task: 'compose', input: 'idea', fetchImpl });
  assert.strictEqual(r.stopReason, 'max_tokens');
});
