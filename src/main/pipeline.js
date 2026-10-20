'use strict';

// Search-then-write pipelines for providers without built-in web search.
// The app does the searching (Crossref/OpenAlex/Tavily) and the model only
// writes from the evidence it is given. Citations are numbered markers like
// [S3] that are swapped for formatted in-text citations here, and the
// reference list is built from real metadata, never written by the model.
const Citations = require('../shared/citations');
const TextStats = require('../shared/textstats');
const { buildRequest, CITATION_STYLES } = require('./prompts');
const { searchScholarly, searchWeb, numberSources, describeSources, SearchError } = require('./research');

const MAX_CLAIMS = 6;
const MAX_PASSAGES = 6;
const MATCH_THRESHOLD = 30; // % of a passage's 4-word sequences found in a result

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function styleOf(opts, settings) {
  return CITATION_STYLES.includes(opts.style) ? opts.style : settings.citationStyle || 'APA 7';
}

// Replace [S#] markers with in-text citations and build the reference list
// from the sources actually cited. Unknown markers are dropped.
function applyCitations(text, sources, style) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const order = []; // ids in order of first citation
  // Merge adjacent markers: "[S1] [S2]" -> "[S1, S2]".
  let out = text.replace(/\]\s?\[(?=S\d+)/g, ', ');
  out = out.replace(/\s?\[(S\d+(?:\s*[,;]\s*S\d+)*)\]/g, (_m, group) => {
    const ids = [...new Set(group.split(/\s*[,;]\s*/))].filter((id) => byId.has(id));
    if (!ids.length) return '';
    for (const id of ids) if (!order.includes(id)) order.push(id);
    const cites = ids.map((id) => Citations.inText(style, byId.get(id), order.indexOf(id) + 1));
    if (style === 'IEEE') return ` ${cites.join(', ')}`;
    return ` (${cites.map((c) => c.replace(/^\(|\)$/g, '')).join('; ')})`;
  });

  let references = order.map((id, i) => ({ n: i + 1, text: Citations.format(style, byId.get(id)) }));
  if (style === 'IEEE') {
    references = references.map((r) => `[${r.n}] ${r.text}`);
  } else {
    const key = (s) => s.replace(/[*“”‘’"]/g, '').toLowerCase();
    references = references.map((r) => r.text).sort((a, b) => key(a).localeCompare(key(b)));
  }
  return { text: out, references, cited: order.map((id) => byId.get(id)) };
}

function referencesSection(references) {
  return references.length ? `## References\n\n${references.join('\n\n')}` : '## References\n\nNo sources were cited.';
}

function asSourceLinks(sources) {
  return sources.filter((s) => s.url).map((s) => ({ title: s.title, url: s.url }));
}

async function gather(queries, { searchKeys, fetchImpl, signal, scholarlyLimit = 3, webLimit = 2 }) {
  const jobs = [];
  for (const q of queries) {
    jobs.push(searchScholarly(q, { limit: scholarlyLimit, openalexKey: searchKeys.openalex, fetchImpl, signal }));
    if (searchKeys.tavily) jobs.push(searchWeb(q, { apiKey: searchKeys.tavily, limit: webLimit, fetchImpl, signal }));
  }
  const settled = await Promise.allSettled(jobs);
  if (signal && signal.aborted) throw Object.assign(new Error('Cancelled.'), { name: 'AbortError' });
  const failures = settled.filter((s) => s.status === 'rejected').map((s) => s.reason);
  // Interleave results so every query contributes to the numbered list.
  const lists = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  const interleaved = [];
  for (let i = 0; lists.some((l) => l[i]); i++) for (const l of lists) if (l[i]) interleaved.push(l[i]);
  return { sources: numberSources(interleaved), failures };
}

async function citeTask({ input, opts, settings, chat, searchKeys, onDelta, onStatus, signal, fetchImpl }) {
  const style = styleOf(opts, settings);

  onStatus('Finding the claims that need sources…');
  const found = await chat({
    system: `You find factual claims in a text that should be backed by a source.
Return only JSON, no commentary: {"claims":[{"claim":"<short paraphrase>","query":"<4-8 keyword search query for academic databases>"}]}
At most ${MAX_CLAIMS} claims, most important first. Skip opinions and common knowledge.`,
    user: input,
    temperature: 0.1,
  });
  const claims = ((extractJson(found.text) || {}).claims || []).filter((c) => c && c.query).slice(0, MAX_CLAIMS);
  if (!claims.length) {
    return { text: '## Notes\n\nNo factual claims that need a source were found in this text.', sources: [], stopReason: 'end_turn' };
  }

  onStatus(`Searching ${searchKeys.tavily ? 'Crossref, OpenAlex and the web' : 'Crossref and OpenAlex'} for ${claims.length} claim${claims.length === 1 ? '' : 's'}…`);
  const { sources, failures } = await gather(claims.map((c) => c.query), { searchKeys, fetchImpl, signal });
  if (!sources.length) {
    if (failures.length) throw failures[0];
    return { text: `## Notes\n\nNo sources were found for these claims:\n\n${claims.map((c) => `- ${c.claim}`).join('\n')}`, sources: [], stopReason: 'end_turn' };
  }

  onStatus('Adding citations…');
  const res = await chat({
    system: `You add citations to the author's text using only the numbered sources provided.
- Put a marker such as [S2] right after the sentence or clause a source supports. For several sources write [S1][S4].
- Cite a source only when its title or summary clearly supports that claim. Leaving a claim uncited is better than a weak citation.
- Do not change the author's wording, and do not write a reference list.
Output exactly two markdown sections:
## Cited text
(the full text with markers)
## Notes
(bullets: claims left without a suitable source, and any source that contradicts the text)`,
    user: `Sources:\n${describeSources(sources)}\n\nText:\n${input}`,
    temperature: 0.2,
    onDelta,
  });

  const { text, references } = applyCitations(res.text, sources, style);
  const notesAt = text.search(/^##\s*Notes/m);
  const final = notesAt === -1
    ? `${text.trim()}\n\n${referencesSection(references)}`
    : `${text.slice(0, notesAt).trim()}\n\n${referencesSection(references)}\n\n${text.slice(notesAt).trim()}`;
  return { text: final, sources: asSourceLinks(sources), stopReason: res.finishReason === 'length' ? 'max_tokens' : 'end_turn' };
}

function pickPassages(text) {
  const sentences = TextStats.sentences(text)
    .map((s, i) => ({ s, i, words: TextStats.words(s).length }))
    .filter((x) => x.words >= 8);
  return sentences.sort((a, b) => b.words - a.words).slice(0, MAX_PASSAGES).sort((a, b) => a.i - b.i).map((x) => x.s);
}

async function originalityTask({ input, opts, settings, chat, searchKeys, onDelta, onStatus, signal, fetchImpl }) {
  if (!searchKeys.tavily) {
    throw new SearchError('The originality check searches the web, which needs a free Tavily key. Get one at tavily.com and add it in Settings.');
  }
  const style = styleOf(opts, settings);
  const passages = pickPassages(input);
  if (!passages.length) throw new SearchError('The text is too short to check. Use at least one full sentence of 8 or more words.');

  onStatus(`Searching the web for ${passages.length} passage${passages.length === 1 ? '' : 's'}…`);
  const settled = await Promise.allSettled(passages.map((p) => {
    const query = `"${TextStats.words(p).length > 25 ? p.split(/\s+/).slice(0, 25).join(' ') : p}"`;
    return searchWeb(query, { apiKey: searchKeys.tavily, limit: 3, fetchImpl, signal });
  }));
  if (signal && signal.aborted) throw Object.assign(new Error('Cancelled.'), { name: 'AbortError' });
  if (settled.every((s) => s.status === 'rejected')) throw settled[0].reason;

  const evidence = passages.map((p, i) => {
    const results = settled[i].status === 'fulfilled' ? settled[i].value : [];
    return {
      passage: p,
      results: results.map((r) => ({ ...r, overlap: TextStats.overlap(r.summary, p) })).sort((a, b) => b.overlap - a.overlap),
    };
  });
  const best = Math.max(0, ...evidence.flatMap((e) => e.results.map((r) => r.overlap)));
  const matched = evidence.filter((e) => e.results.some((r) => r.overlap >= MATCH_THRESHOLD)).length;

  onStatus('Writing the report…');
  const block = evidence.map((e, i) => [
    `Passage ${i + 1}: "${e.passage}"`,
    ...(e.results.length
      ? e.results.map((r) => `  - ${r.overlap}% overlap · ${r.title} · ${r.url}\n    Snippet: ${r.summary}`)
      : ['  - no search results']),
  ].join('\n')).join('\n\n');

  const res = await chat({
    system: `You write an originality report from evidence the app collected. For each passage, the app searched the web for its exact wording and measured "overlap": the share of the passage's 4-word sequences that also appear in the result's snippet. Snippets are excerpts, so overlap can understate a match.
Write markdown with these sections:
## Summary
A verdict (Likely original / Some matches / Significant matches) and a short explanation. Say this is a web spot-check of ${passages.length} passages, not a comparison against private databases.
## Matches
For each passage with ${MATCH_THRESHOLD}% overlap or more, or whose snippet clearly contains the same wording: quote the passage, give the source title and URL, and say whether it is verbatim, a close paraphrase or a common phrase. If none, say no close matches were found.
## How to fix
For each match: a version in quotation marks with an in-text citation in ${style} style, or an original rewrite, plus a reference entry using only the title, site and URL given.
Use only the evidence below. Never claim a match the evidence does not show.`,
    user: `Evidence (${matched} of ${passages.length} passages at or above ${MATCH_THRESHOLD}% overlap; highest overlap ${best}%):\n\n${block}`,
    temperature: 0.2,
    onDelta,
  });

  const sources = evidence.flatMap((e) => e.results).filter((r, i, all) => all.findIndex((x) => x.url === r.url) === i);
  return { text: res.text, sources: asSourceLinks(sources), stopReason: res.finishReason === 'length' ? 'max_tokens' : 'end_turn' };
}

async function composeTask({ input, opts, settings, chat, searchKeys, onDelta, onStatus, signal, fetchImpl }) {
  const style = styleOf(opts, settings);

  onStatus('Planning the research…');
  const planned = await chat({
    system: 'Return only JSON, no commentary: {"queries":["..."]} with 3 or 4 short search queries (4-8 keywords each) for researching the factual points in this writing task.',
    user: input,
    temperature: 0.1,
  });
  let queries = ((extractJson(planned.text) || {}).queries || []).filter((q) => typeof q === 'string' && q.trim()).slice(0, 4);
  if (!queries.length) queries = [input.slice(0, 120)];

  onStatus(`Searching ${searchKeys.tavily ? 'Crossref, OpenAlex and the web' : 'Crossref and OpenAlex'}…`);
  const { sources, failures } = await gather(queries, { searchKeys, fetchImpl, signal });
  if (!sources.length && failures.length) throw failures[0];

  onStatus('Writing the draft…');
  const base = buildRequest('compose', input, { ...opts, research: false }, settings);
  const res = await chat({
    system: `${base.system}
Ground factual claims in the numbered sources below and cite them with markers such as [S3] right after the claim (several: [S1][S2]). Use only these sources and only where they clearly support the claim; otherwise write [citation needed]. Do not write a reference list; it is added automatically.`,
    user: `Sources:\n${sources.length ? describeSources(sources) : '(none found)'}\n\n${base.user}`,
    onDelta,
  });

  const { text, references } = applyCitations(res.text, sources, style);
  return {
    text: `${text.trim()}\n\n${referencesSection(references)}`,
    sources: asSourceLinks(sources),
    stopReason: res.finishReason === 'length' ? 'max_tokens' : 'end_turn',
  };
}

const TASKS = { cite: citeTask, originality: originalityTask, compose: composeTask };

async function runResearchTask(args) {
  const run = TASKS[args.task];
  if (!run) throw new Error(`No research pipeline for ${args.task}`);
  return run({ opts: {}, settings: {}, searchKeys: {}, onDelta: () => {}, onStatus: () => {}, ...args });
}

module.exports = { runResearchTask, applyCitations, pickPassages, extractJson };
