'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/shared/citations');

const article = {
  type: 'journal',
  authors: ['Okafor, Chidi Emeka', 'Mary Smith'],
  year: '2021',
  title: 'Reading habits of university students',
  container: 'Journal of Literacy',
  volume: '12', issue: '3', pages: '45-60',
  url: 'https://doi.org/10.1234/jl.2021.003',
};

test('APA 7 journal article', () => {
  assert.strictEqual(C.format('APA 7', article),
    'Okafor, C. E., & Smith, M. (2021). Reading habits of university students. *Journal of Literacy*, *12*(3), 45–60. https://doi.org/10.1234/jl.2021.003');
  assert.strictEqual(C.inText('APA 7', article), '(Okafor & Smith, 2021)');
});

test('MLA 9 journal article', () => {
  assert.strictEqual(C.format('MLA 9', article),
    'Okafor, Chidi Emeka, and Mary Smith. “Reading habits of university students.” *Journal of Literacy*, vol. 12, no. 3, 2021, pp. 45–60, doi.org/10.1234/jl.2021.003.');
});

test('IEEE journal and in-text number', () => {
  assert.strictEqual(C.format('IEEE', article),
    'C. E. Okafor and M. Smith, “Reading habits of university students,” *Journal of Literacy*, vol. 12, no. 3, pp. 45–60, 2021.');
  assert.strictEqual(C.inText('IEEE', article, 4), '[4]');
});

test('Harvard book and Chicago web page', () => {
  const book = { type: 'book', authors: ['Achebe, Chinua'], year: '1958', title: 'Things Fall Apart', publisher: 'Heinemann' };
  assert.strictEqual(C.format('Harvard', book), 'Achebe, C. (1958) *Things Fall Apart*. Heinemann.');
  const web = { type: 'web', authors: [], title: 'Malaria fact sheet', container: 'World Health Organization', url: 'https://www.who.int/malaria' };
  assert.strictEqual(C.format('Chicago (author-date)', web),
    '“Malaria fact sheet.” n.d. World Health Organization. https://www.who.int/malaria.');
});

test('every style formats every source type without throwing', () => {
  for (const style of C.STYLES) {
    for (const type of ['web', 'journal', 'book']) {
      const out = C.format(style, { ...article, type });
      assert.ok(out.length > 10 && !out.includes('undefined'), `${style}/${type}: ${out}`);
    }
  }
});
