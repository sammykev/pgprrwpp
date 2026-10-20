'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/shared/textstats');

test('analyze counts words, sentences and readability', () => {
  const s = T.analyze('The cat sat on the mat. It was happy!\n\nA new paragraph.');
  assert.strictEqual(s.words, 12);
  assert.strictEqual(s.sentences, 3);
  assert.strictEqual(s.paragraphs, 2);
  assert.ok(s.flesch > 80, `simple text should be easy, got ${s.flesch}`);
});

test('analyze handles empty text', () => {
  const s = T.analyze('');
  assert.strictEqual(s.words, 0);
  assert.strictEqual(s.flesch, null);
  assert.strictEqual(s.readingMinutes, 0);
});

test('syllables heuristic', () => {
  assert.strictEqual(T.syllables('cat'), 1);
  assert.strictEqual(T.syllables('happy'), 2);
  assert.strictEqual(T.syllables('banana'), 3);
});

test('overlap is 100 for identical text and low for reworded text', () => {
  const a = 'Climate change is causing sea levels to rise across the world every year.';
  assert.strictEqual(T.overlap(a, a), 100);
  const b = 'Each year, oceans everywhere creep higher as the planet warms.';
  assert.strictEqual(T.overlap(a, b), 0);
  assert.strictEqual(T.overlap(a, ''), 0);
});
