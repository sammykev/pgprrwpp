'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { render } = require('../src/shared/markdown');

test('renders headings, lists, emphasis and links', () => {
  const html = render('## Title\n\n- one **bold**\n- two *it*\n\n1. first\n\nSee [docs](https://example.com).');
  assert.match(html, /<h3>Title<\/h3>/);
  assert.match(html, /<ul>\n<li>one <strong>bold<\/strong><\/li>\n<li>two <em>it<\/em><\/li>\n<\/ul>/);
  assert.match(html, /<ol>\n<li>first<\/li>\n<\/ol>/);
  assert.match(html, /<a href="https:\/\/example.com" target="_blank" rel="noopener">docs<\/a>/);
});

test('escapes HTML so model output cannot inject markup', () => {
  const html = render('<img src=x onerror=alert(1)> [x](javascript:alert(1))');
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /href="javascript/);
});

test('autolinks bare URLs', () => {
  assert.match(render('Source: https://who.int/news.'), /<a href="https:\/\/who.int\/news"/);
});
