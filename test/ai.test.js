'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { runTask } = require('../src/main/ai');

// Fake client: returns queued messages from beta.messages.stream and records params.
function fakeClient(messages) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        stream(params) {
          calls.push(JSON.parse(JSON.stringify(params)));
          const msg = messages.shift();
          const s = new EventEmitter();
          s.finalMessage = async () => {
            for (const b of msg.content) if (b.type === 'text') s.emit('text', b.text);
            return msg;
          };
          return s;
        },
      },
    },
  };
}

test('streams text and sets model, effort and fallbacks', async () => {
  const client = fakeClient([{ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] }]);
  let streamed = '';
  const r = await runTask({ client, task: 'paraphrase', input: 'Hi world', settings: {}, onDelta: (t) => { streamed += t; } });
  assert.strictEqual(r.text, 'Hello world');
  assert.strictEqual(streamed, 'Hello world');
  const p = client.calls[0];
  assert.strictEqual(p.model, 'claude-opus-5-5');
  assert.strictEqual(p.fallbacks, 'default');
  assert.deepStrictEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.strictEqual(p.output_config.effort, 'low');
  assert.strictEqual(p.thinking, undefined);
  assert.strictEqual(p.tools, undefined);
});

test('proofread uses a JSON schema and parses the result', async () => {
  const data = { corrected_text: 'I am here.', issues: [{ original: 'I is', replacement: 'I am', category: 'grammar', explanation: 'Subject-verb agreement.' }] };
  const client = fakeClient([{ model: 'm', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify(data) }] }]);
  const r = await runTask({ client, task: 'proofread', input: 'I is here.', settings: { model: 'claude-haiku-5-5' } });
  assert.deepStrictEqual(r.data, data);
  assert.strictEqual(client.calls[0].output_config.format.type, 'json_schema');
  assert.strictEqual(client.calls[0].model, 'claude-haiku-5-5');
});

test('web search tasks resume after pause_turn and collect sources', async () => {
  const search = { type: 'web_search_tool_result', content: [{ type: 'web_search_result', title: 'WHO', url: 'https://who.int' }] };
  const client = fakeClient([
    { model: 'm', stop_reason: 'pause_turn', usage: {}, content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }, search] },
    { model: 'm', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: '## Summary\nLikely original' }, search] },
  ]);
  const r = await runTask({ client, task: 'originality', input: 'Text to check', settings: {} });
  assert.strictEqual(client.calls.length, 2);
  assert.strictEqual(client.calls[0].tools[0].type, 'web_search_20260209');
  assert.strictEqual(client.calls[1].messages.length, 2);
  assert.strictEqual(client.calls[1].messages[1].role, 'assistant');
  assert.deepStrictEqual(r.sources, [{ title: 'WHO', url: 'https://who.int' }]);
  assert.match(r.text, /Likely original/);
});

test('refusals surface as errors', async () => {
  const client = fakeClient([{ model: 'm', stop_reason: 'refusal', usage: {}, content: [] }]);
  await assert.rejects(runTask({ client, task: 'rewrite', input: 'x', settings: {} }), /declined/);
});
