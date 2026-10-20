// Local text analysis: counts, readability and overlap between two texts.
// Runs in both Node (tests) and the renderer (as window.TextStats).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TextStats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function words(text) {
    return (text.toLowerCase().match(/[a-z0-9]+(?:['’][a-z]+)?/g) || []);
  }

  function sentences(text) {
    return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => /[a-z0-9]/i.test(s));
  }

  function syllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!word) return 0;
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    const groups = word.match(/[aeiouy]{1,2}/g);
    return Math.max(1, groups ? groups.length : 1);
  }

  function readingLabel(score) {
    if (score >= 80) return 'Very easy';
    if (score >= 60) return 'Plain English';
    if (score >= 50) return 'Fairly difficult';
    if (score >= 30) return 'Difficult';
    return 'Very difficult';
  }

  function analyze(text) {
    const w = words(text);
    const s = sentences(text);
    const syl = w.reduce((n, x) => n + syllables(x), 0);
    const wc = w.length;
    const sc = Math.max(s.length, wc ? 1 : 0);
    let flesch = null;
    if (wc) {
      flesch = 206.835 - 1.015 * (wc / sc) - 84.6 * (syl / wc);
      flesch = Math.round(Math.max(0, Math.min(100, flesch)));
    }
    return {
      words: wc,
      characters: text.length,
      sentences: s.length,
      paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
      readingMinutes: wc ? Math.max(1, Math.round(wc / 238)) : 0,
      avgSentenceLength: sc ? +(wc / sc).toFixed(1) : 0,
      flesch,
      readability: flesch === null ? '' : readingLabel(flesch),
    };
  }

  function ngrams(list, n) {
    const out = new Set();
    for (let i = 0; i + n <= list.length; i++) out.add(list.slice(i, i + n).join(' '));
    return out;
  }

  // Share (0-100) of the candidate's word n-grams that also appear in the source.
  // High values mean the candidate reuses long runs of the source's wording.
  function overlap(source, candidate, n = 4) {
    const a = ngrams(words(source), n);
    const b = ngrams(words(candidate), n);
    if (!b.size) return 0;
    let shared = 0;
    for (const g of b) if (a.has(g)) shared++;
    return Math.round((shared / b.size) * 100);
  }

  return { analyze, overlap, syllables, words, sentences };
});
