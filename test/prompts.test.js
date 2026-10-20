'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/main/prompts');

test('every task builds a request', () => {
  for (const task of P.TASKS) {
    const r = P.buildRequest(task, 'Some text.', {}, {});
    assert.ok(r.system.length > 50, task);
    assert.ok(['low', 'medium', 'high'].includes(r.effort), task);
    assert.doesNotMatch(r.system, /\n\n/, `${task} has blank lines`);
  }
});

test('rejects empty input and unknown tasks', () => {
  assert.throws(() => P.buildRequest('paraphrase', '   '), /enter some text/);
  assert.throws(() => P.buildRequest('nope', 'x'), /Unknown task/);
});

test('options are validated and applied', () => {
  const r = P.buildRequest('paraphrase', 'x', { mode: 'academic', synonyms: 'high', freeze: 'DNA' }, { englishVariant: 'UK' });
  assert.match(r.system, /academic register/);
  assert.match(r.system, /British English/);
  assert.match(r.system, /exactly as written: DNA/);
  const bad = P.buildRequest('paraphrase', 'x', { mode: '<script>' });
  assert.match(bad.system, /balanced way/);
});

test('web search only where needed', () => {
  assert.strictEqual(P.buildRequest('originality', 'x').webSearch, true);
  assert.strictEqual(P.buildRequest('cite', 'x').webSearch, true);
  assert.ok(!P.buildRequest('compose', 'x', { research: false }).webSearch);
  assert.strictEqual(P.buildRequest('compose', 'x', { research: true }).webSearch, true);
  assert.strictEqual(P.buildRequest('proofread', 'x').structured, true);
});
