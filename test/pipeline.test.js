'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { runNvidiaTask } = require('../src/main/nvidia');
const { applyCitations, pickPassages } = require('../src/main/pipeline');
const { searchCrossref, searchOpenAlex, abstractFromInvertedIndex } = require('../src/main/research');

// One fake fetch that routes by URL: NVIDIA chat replies come from a queue,
// search services return canned JSON.
function router({ chatReplies = [], crossref = [], openalex = [], tavily = [], fail = {} }) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const host = new URL(url).hostname;
    const key = { 'integrate.api.nvidia.com': 'nvidia', 'api.crossref.org': 'crossref', 'api.openalex.org': 'openalex', 'api.tavily.com': 'tavily' }[host];
    if (fail[key]) return { ok: false, status: fail[key], json: async () => ({}), text: async () => '' };
    if (key === 'nvidia') {
      const reply = chatReplies.shift();
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
      return { ok: true, status: 200, body: (async function* () { yield Buffer.from(sse); })() };
    }
    const payload = key === 'crossref' ? { message: { items: crossref } } : key === 'openalex' ? { results: openalex } : { results: tavily };
    return { ok: true, status: 200, json: async () => payload };
  };
  return { fetchImpl, calls };
}

const CROSSREF_ITEM = {
  DOI: '10.1016/J.SLEH.2019.07.006',
  title: ['Identifying drivers for bedtime social media use'],
  author: [{ given: 'Holly', family: 'Scott' }, { given: 'Stephany M.', family: 'Biello' }],
  issued: { 'date-parts': [[2019, 8]] },
  'container-title': ['Sleep Health'], volume: '5', issue: '6', page: '539-545',
  abstract: '<jats:p>Teens stay up late on social media.</jats:p>',
};
const OPENALEX_ITEM = {
  doi: 'https://doi.org/10.3390/children13010051',
  title: 'Social Media Use and Sleep Quality in Adolescents',
  publication_year: 2025,
  authorships: [{ author: { display_name: 'Awele Ndubisi' } }],
  primary_location: { source: { display_name: 'Children' } },
  biblio: { volume: '13', issue: '1', first_page: '51', last_page: null },
  abstract_inverted_index: { Sleep: [0], matters: [1] },
};

test('Crossref and OpenAlex results are normalised to citation metadata', async () => {
  const { fetchImpl } = router({ crossref: [CROSSREF_ITEM], openalex: [OPENALEX_ITEM] });
  const [c] = await searchCrossref('q', { fetchImpl });
  assert.deepStrictEqual([c.title, c.authors, c.year, c.container, c.pages, c.url, c.summary],
    ['Identifying drivers for bedtime social media use', ['Scott, Holly', 'Biello, Stephany M.'], '2019', 'Sleep Health', '539-545', 'https://doi.org/10.1016/J.SLEH.2019.07.006', 'Teens stay up late on social media.']);
  const [o] = await searchOpenAlex('q', { fetchImpl, apiKey: 'oa' });
  assert.deepStrictEqual([o.authors, o.year, o.pages, o.doi, o.summary], [['Awele Ndubisi'], '2025', '51', '10.3390/children13010051', 'Sleep matters']);
  assert.strictEqual(abstractFromInvertedIndex({ b: [1], a: [0] }), 'a b');
});

test('applyCitations swaps markers for in-text citations and builds references', () => {
  const sources = [
    { id: 'S1', type: 'journal', title: 'Paper one', authors: ['Scott, Holly'], year: '2019', container: 'Sleep Health' },
    { id: 'S2', type: 'journal', title: 'Paper two', authors: ['Ade Bello', 'Chi Obi'], year: '2021', container: 'J' },
  ];
  const apa = applyCitations('Teens sleep less [S2]. Phones matter [S1][S2]. Bogus [S9].', sources, 'APA 7');
  assert.strictEqual(apa.text, 'Teens sleep less (Bello & Obi, 2021). Phones matter (Scott, 2019; Bello & Obi, 2021). Bogus.');
  assert.strictEqual(apa.references.length, 2);
  assert.match(apa.references[0], /^Bello, A\., & Obi, C\. \(2021\)/, 'APA references are alphabetical');
  const ieee = applyCitations('A [S2]. B [S1, S2].', sources, 'IEEE');
  assert.strictEqual(ieee.text, 'A [1]. B [2], [1].');
  assert.match(ieee.references[0], /^\[1\] A\. Bello and C\. Obi/);
});

test('pickPassages chooses the longest sentences in document order', () => {
  const text = 'Short one. ' + 'This sentence has exactly ten words in it for the test. '.repeat(1) + 'Tiny. Another fairly long sentence that should also be picked for checking online.';
  const p = pickPassages(text);
  assert.strictEqual(p.length, 2);
  assert.match(p[0], /^This sentence/);
});

test('NVIDIA citations: finds claims, searches, cites only real sources', async () => {
  const { fetchImpl, calls } = router({
    chatReplies: [
      '{"claims":[{"claim":"teens lose sleep to social media","query":"adolescent social media sleep"}]}',
      '## Cited text\nTeens lose sleep to social media [S1][S2].\n## Notes\n- None.',
    ],
    crossref: [CROSSREF_ITEM],
    openalex: [OPENALEX_ITEM],
  });
  const statuses = [];
  const r = await runNvidiaTask({ apiKey: 'k', task: 'cite', input: 'Teens lose sleep to social media.', opts: { style: 'APA 7' }, fetchImpl, onStatus: (s) => statuses.push(s) });
  assert.match(r.text, /Teens lose sleep to social media \(Ndubisi, 2025; Scott & Biello, 2019\)\./);
  assert.match(r.text, /## References\n\nNdubisi, A\. \(2025\)\. Social Media Use and Sleep Quality in Adolescents\. \*Children\*/);
  assert.ok(r.text.indexOf('## References') < r.text.indexOf('## Notes'));
  assert.strictEqual(r.sources.length, 2);
  assert.ok(!calls.some((c) => c.url.includes('tavily')), 'no web search without a Tavily key');
  assert.match(statuses.join('|'), /Crossref and OpenAlex/);
});

test('NVIDIA citations still work when OpenAlex is out of budget', async () => {
  const { fetchImpl } = router({
    chatReplies: ['{"claims":[{"claim":"c","query":"q"}]}', '## Cited text\nClaim [S1].\n## Notes\n- None.'],
    crossref: [CROSSREF_ITEM],
    fail: { openalex: 429 },
  });
  const r = await runNvidiaTask({ apiKey: 'k', task: 'cite', input: 'Claim.', opts: { style: 'APA 7' }, fetchImpl });
  assert.match(r.text, /Claim \(Scott & Biello, 2019\)\./);
});

test('NVIDIA originality: searches exact passages on Tavily and reports overlap evidence', async () => {
  const passage = 'The mitochondria is the powerhouse of the cell and produces energy for the body.';
  const { fetchImpl, calls } = router({
    chatReplies: ['## Summary\nSome matches.'],
    tavily: [{ title: 'Biology 101', url: 'https://bio.example/cells', content: 'As everyone learns, the mitochondria is the powerhouse of the cell and produces energy for the body.' }],
  });
  const r = await runNvidiaTask({ apiKey: 'k', task: 'originality', input: passage, fetchImpl, searchKeys: { tavily: 'tvly-x' } });
  const search = calls.find((c) => c.url.includes('tavily'));
  assert.strictEqual(search.body.query, `"${passage}"`);
  assert.strictEqual(search.headers.Authorization, 'Bearer tvly-x');
  const chat = calls.filter((c) => c.url.includes('nvidia')).pop();
  assert.match(chat.body.messages[1].content, /100% overlap · Biology 101 · https:\/\/bio.example\/cells/);
  assert.match(r.text, /Some matches/);
  assert.deepStrictEqual(r.sources, [{ title: 'Biology 101', url: 'https://bio.example/cells' }]);
});

test('NVIDIA researched draft appends a reference list built from metadata', async () => {
  const { fetchImpl } = router({
    chatReplies: ['{"queries":["teen sleep"]}', '## Draft\nSleep matters for teens [S1]. Unsupported claim [citation needed].'],
    openalex: [OPENALEX_ITEM],
    tavily: [{ title: 'CDC sleep facts', url: 'https://www.cdc.gov/sleep', content: 'Teens need 8-10 hours.' }],
  });
  const r = await runNvidiaTask({ apiKey: 'k', task: 'compose', input: 'Essay on teen sleep', opts: { research: true, style: 'MLA 9' }, fetchImpl, searchKeys: { tavily: 't' } });
  assert.match(r.text, /Sleep matters for teens \(Ndubisi\)\./);
  assert.match(r.text, /## References\n\nNdubisi, Awele\. “Social Media Use and Sleep Quality in Adolescents\.”/);
  assert.strictEqual(r.sources.length, 2, 'scholarly and web sources were both offered');
});
