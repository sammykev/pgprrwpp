// Offline reference formatter for the manual citation builder.
// A source is { type: 'web'|'journal'|'book', authors: ['Last, First M.'], year,
// title, container, volume, issue, pages, publisher, url, accessed }.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Citations = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STYLES = ['APA 7', 'MLA 9', 'Chicago (author-date)', 'Harvard', 'IEEE'];

  function parseName(raw) {
    raw = raw.trim();
    if (raw.includes(',')) {
      const [last, first] = raw.split(',').map((s) => s.trim());
      return { last, first: first || '' };
    }
    const parts = raw.split(/\s+/);
    if (parts.length === 1) return { last: parts[0], first: '' };
    return { last: parts.pop(), first: parts.join(' ') };
  }

  function initials(first, withSpaces = true) {
    return first.split(/[\s-]+/).filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join(withSpaces ? ' ' : '');
  }

  function joinList(items, conj, serialComma = true) {
    if (items.length <= 1) return items.join('');
    if (items.length === 2) return `${items[0]} ${conj} ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}${serialComma ? ',' : ''} ${conj} ${items[items.length - 1]}`;
  }

  function end(s) {
    return /[.?!]$/.test(s) ? s : `${s}.`;
  }

  function authorsFor(style, names) {
    const n = names.map(parseName);
    if (!n.length) return '';
    switch (style) {
      case 'APA 7': {
        const f = n.map((a) => (a.first ? `${a.last}, ${initials(a.first)}` : a.last));
        if (f.length > 20) return `${f.slice(0, 19).join(', ')}, . . . ${f[f.length - 1]}`;
        return f.length === 1 ? f[0] : `${f.slice(0, -1).join(', ')}, & ${f[f.length - 1]}`;
      }
      case 'MLA 9': {
        const first = n[0].first ? `${n[0].last}, ${n[0].first}` : n[0].last;
        if (n.length === 1) return first;
        if (n.length === 2) return `${first}, and ${[n[1].first, n[1].last].filter(Boolean).join(' ')}`;
        return `${first}, et al`;
      }
      case 'Chicago (author-date)': {
        const rest = n.slice(1).map((a) => [a.first, a.last].filter(Boolean).join(' '));
        const first = n[0].first ? `${n[0].last}, ${n[0].first}` : n[0].last;
        return joinList([first, ...rest], 'and');
      }
      case 'Harvard': {
        const f = n.map((a) => (a.first ? `${a.last}, ${initials(a.first, false)}` : a.last));
        return joinList(f, 'and', false);
      }
      case 'IEEE': {
        const f = n.map((a) => [a.first ? initials(a.first) : '', a.last].filter(Boolean).join(' '));
        return f.length > 6 ? `${f[0]} et al.` : joinList(f, 'and');
      }
      default:
        return names.join(', ');
    }
  }

  // Formatting uses lightweight markup: *italic*.
  function format(style, src) {
    const s = { type: 'web', authors: [], ...src };
    const authors = authorsFor(style, s.authors || []);
    const year = s.year || 'n.d.';
    const title = (s.title || '').trim();
    const cont = (s.container || '').trim();
    const vol = s.volume ? String(s.volume) : '';
    const iss = s.issue ? String(s.issue) : '';
    const pages = (s.pages || '').replace(/-/g, '–');
    const url = (s.url || '').trim();
    const accessed = (s.accessed || '').trim();
    const pub = (s.publisher || '').trim();
    const isBook = s.type === 'book';
    const isJournal = s.type === 'journal';
    const parts = [];

    switch (style) {
      case 'APA 7': {
        const lead = authors ? `${end(authors)} (${year}).` : `${title ? (isBook ? `*${title}*` : title) : ''} (${year}).`;
        parts.push(lead);
        if (authors) parts.push(isBook || (!isJournal && !cont) ? `*${end(title)}*` : end(title));
        if (isJournal) parts.push(`*${cont}*${vol ? `, *${vol}*` : ''}${iss ? `(${iss})` : ''}${pages ? `, ${pages}` : ''}.`);
        else if (isBook && pub) parts.push(end(pub));
        else if (cont) parts.push(end(cont));
        if (url) parts.push(url);
        break;
      }
      case 'MLA 9': {
        if (authors) parts.push(end(authors));
        parts.push(isBook ? `*${end(title)}*` : `“${end(title)}”`);
        const tail = [];
        if (isJournal) {
          tail.push(`*${cont}*`);
          if (vol) tail.push(`vol. ${vol}`);
          if (iss) tail.push(`no. ${iss}`);
          tail.push(year);
          if (pages) tail.push(`pp. ${pages}`);
        } else {
          if (cont) tail.push(`*${cont}*`);
          if (pub) tail.push(pub);
          if (s.year) tail.push(year);
        }
        if (url) tail.push(url.replace(/^https?:\/\//, ''));
        if (tail.length) parts.push(end(tail.join(', ')));
        if (accessed && !isBook) parts.push(`Accessed ${end(accessed)}`);
        break;
      }
      case 'Chicago (author-date)': {
        const t = isBook ? `*${end(title)}*` : `“${end(title)}”`;
        if (authors) parts.push(`${end(authors)} ${end(year)}`, t);
        else parts.push(t, end(year));
        if (isJournal) parts.push(`*${cont}*${vol ? ` ${vol}` : ''}${iss ? ` (${iss})` : ''}${pages ? `: ${pages}` : ''}.`);
        else if (isBook && pub) parts.push(end(pub));
        else if (cont) parts.push(end(cont));
        if (url) parts.push(end(url));
        break;
      }
      case 'Harvard': {
        parts.push(authors ? `${authors} (${year})` : `(${year})`);
        parts.push(isBook ? `*${title}*.` : `‘${title}’,`);
        if (isJournal) parts.push(`*${cont}*${vol ? `, ${vol}` : ''}${iss ? `(${iss})` : ''}${pages ? `, pp. ${pages}` : ''}.`);
        else if (isBook && pub) parts.push(end(pub));
        else if (cont) parts.push(`*${cont}*.`);
        if (url) parts.push(`Available at: ${url}${accessed ? ` (Accessed: ${accessed})` : ''}.`);
        break;
      }
      case 'IEEE': {
        const a = authors ? `${authors}, ` : '';
        if (isBook) {
          parts.push(`${a}*${title}*.`);
          if (pub) parts.push(`${pub}, ${year}.`);
          else parts.push(`${year}.`);
        } else if (isJournal) {
          const bits = [`*${cont}*`];
          if (vol) bits.push(`vol. ${vol}`);
          if (iss) bits.push(`no. ${iss}`);
          if (pages) bits.push(`pp. ${pages}`);
          bits.push(year);
          parts.push(`${a}“${title},” ${bits.join(', ')}.`);
        } else {
          parts.push(`${a}“${title}.”${cont ? ` ${cont}.` : ''}`);
          if (url) parts.push(`[Online]. Available: ${url}${accessed ? ` (accessed ${accessed})` : ''}.`);
        }
        break;
      }
      default:
        throw new Error(`Unknown style: ${style}`);
    }
    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  // In-text citation, e.g. (Smith & Lee, 2020) or [1].
  function inText(style, src, index = 1) {
    const names = (src.authors || []).map(parseName).map((a) => a.last);
    const year = src.year || 'n.d.';
    const who = names.length === 0 ? `“${src.title || ''}”`
      : names.length === 1 ? names[0]
        : names.length === 2 ? `${names[0]} ${style === 'APA 7' ? '&' : 'and'} ${names[1]}`
          : `${names[0]} et al.`;
    switch (style) {
      case 'APA 7': return `(${who}, ${year})`;
      case 'MLA 9': return `(${who}${src.pages ? ` ${String(src.pages).split('-')[0]}` : ''})`;
      case 'Chicago (author-date)':
      case 'Harvard': return `(${who} ${year})`;
      case 'IEEE': return `[${index}]`;
      default: throw new Error(`Unknown style: ${style}`);
    }
  }

  return { STYLES, format, inText, parseName };
});
