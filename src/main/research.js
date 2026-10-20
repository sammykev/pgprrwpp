'use strict';

// Free search back-ends used when the AI provider has no built-in web search:
//   Crossref  - scholarly metadata, no key needed
//   OpenAlex  - scholarly metadata, free (optional free key for a private budget)
//   Tavily    - general web search, free key from tavily.com
const USER_AGENT = 'Quillwise/0.3 (desktop writing assistant)';

class SearchError extends Error {}

function stripTags(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function clip(s, n) {
  s = s || '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function abstractFromInvertedIndex(index) {
  if (!index) return '';
  const words = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word;
  return words.filter(Boolean).join(' ');
}

async function getJson(fetchImpl, url, init = {}) {
  const res = await fetchImpl(url, { ...init, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(init.headers || {}) } });
  if (!res.ok) {
    const err = new SearchError(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function searchCrossref(query, { limit = 4, fetchImpl = fetch, signal } = {}) {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}`
    + '&filter=type:journal-article'
    + '&select=DOI,title,author,issued,container-title,volume,issue,page,URL,abstract';
  const data = await getJson(fetchImpl, url, { signal });
  return (data.message && data.message.items || []).filter((w) => w.title && w.title[0]).map((w) => ({
    type: 'journal',
    title: stripTags(w.title[0]),
    authors: (w.author || []).filter((a) => a.family).map((a) => (a.given ? `${a.family}, ${a.given}` : a.family)),
    year: w.issued && w.issued['date-parts'] && w.issued['date-parts'][0][0] ? String(w.issued['date-parts'][0][0]) : '',
    container: stripTags((w['container-title'] || [])[0] || ''),
    volume: w.volume || '',
    issue: w.issue || '',
    pages: w.page || '',
    doi: (w.DOI || '').toLowerCase(),
    url: w.DOI ? `https://doi.org/${w.DOI}` : w.URL || '',
    summary: clip(stripTags(w.abstract), 600),
    via: 'Crossref',
  }));
}

async function searchOpenAlex(query, { limit = 4, apiKey, fetchImpl = fetch, signal } = {}) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${limit}`
    + '&filter=type:article'
    + '&select=doi,title,publication_year,authorships,primary_location,biblio,abstract_inverted_index'
    + (apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : '');
  const data = await getJson(fetchImpl, url, { signal });
  return (data.results || []).filter((w) => w.title).map((w) => {
    const b = w.biblio || {};
    const doi = (w.doi || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
    return {
      type: 'journal',
      title: w.title,
      authors: (w.authorships || []).map((a) => a.author && a.author.display_name).filter(Boolean),
      year: w.publication_year ? String(w.publication_year) : '',
      container: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || '',
      volume: b.volume || '',
      issue: b.issue || '',
      pages: b.first_page ? (b.last_page && b.last_page !== b.first_page ? `${b.first_page}-${b.last_page}` : b.first_page) : '',
      doi,
      url: doi ? `https://doi.org/${doi}` : '',
      summary: clip(abstractFromInvertedIndex(w.abstract_inverted_index), 600),
      via: 'OpenAlex',
    };
  });
}

async function searchWeb(query, { apiKey, limit = 4, fetchImpl = fetch, signal } = {}) {
  if (!apiKey) throw new SearchError('Web search needs a Tavily key.');
  let data;
  try {
    data = await getJson(fetchImpl, 'https://api.tavily.com/search', {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, max_results: limit, search_depth: 'basic' }),
    });
  } catch (err) {
    if (err.status === 401 || err.status === 403) throw new SearchError('Your Tavily key was rejected. Check it in Settings.');
    if (err.status === 429 || err.status === 432 || err.status === 433) throw new SearchError('Tavily search limit reached. Try again later.');
    throw err;
  }
  return (data.results || []).map((r) => ({
    type: 'web',
    title: r.title || r.url,
    authors: [],
    year: (r.published_date || '').slice(0, 4),
    container: hostOf(r.url),
    url: r.url,
    accessed: new Date().toISOString().slice(0, 10),
    summary: clip(r.content || '', 600),
    via: 'Web',
  }));
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Scholarly search: OpenAlex (better relevance) and Crossref (always keyless).
// A failing back-end is skipped so one outage or exhausted budget doesn't stop the task.
async function searchScholarly(query, { limit = 3, openalexKey, fetchImpl = fetch, signal } = {}) {
  const settled = await Promise.allSettled([
    searchOpenAlex(query, { limit, apiKey: openalexKey, fetchImpl, signal }),
    searchCrossref(query, { limit, fetchImpl, signal }),
  ]);
  if (signal && signal.aborted) throw Object.assign(new Error('Cancelled.'), { name: 'AbortError' });
  const found = settled.filter((s) => s.status === 'fulfilled').flatMap((s) => s.value);
  if (!found.length && settled.every((s) => s.status === 'rejected')) {
    throw new SearchError('Could not reach Crossref or OpenAlex. Check your internet connection.');
  }
  return found;
}

// Merge sources, dropping duplicates by DOI, URL or title, and number them S1..Sn.
function numberSources(lists, max = 15) {
  const out = [];
  const seen = new Set();
  for (const s of lists.flat()) {
    const keys = [s.doi, s.url, s.title.toLowerCase().replace(/\W+/g, ' ').trim()].filter(Boolean);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push({ ...s, id: `S${out.length + 1}` });
    if (out.length >= max) break;
  }
  return out;
}

function describeSources(sources) {
  return sources.map((s) => [
    `[${s.id}] ${s.title}`,
    `    ${[s.authors.slice(0, 3).join('; ') + (s.authors.length > 3 ? ' et al.' : ''), s.year, s.container].filter(Boolean).join(' · ')} (${s.via})`,
    s.summary ? `    Summary: ${s.summary}` : '',
  ].filter(Boolean).join('\n')).join('\n');
}

module.exports = { searchCrossref, searchOpenAlex, searchScholarly, searchWeb, numberSources, describeSources, SearchError, abstractFromInvertedIndex };
