// Minimal, HTML-safe markdown renderer for AI output (headings, lists,
// bold/italic, inline code, links, blockquotes, paragraphs).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Markdown = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function inline(s) {
    s = escapeHtml(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    return s;
  }

  function render(md) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let para = [];
    let list = null; // 'ul' | 'ol'

    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    };
    const closeList = () => {
      if (list) out.push(`</${list}>`);
      list = null;
    };

    for (const line of lines) {
      let m;
      if (!line.trim()) {
        flushPara();
        closeList();
      } else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        flushPara();
        closeList();
        const level = Math.min(m[1].length + 1, 5);
        out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara();
        const type = /^\s*\d/.test(line) ? 'ol' : 'ul';
        if (list !== type) {
          closeList();
          out.push(`<${type}>`);
          list = type;
        }
        out.push(`<li>${inline(m[1])}</li>`);
      } else if ((m = line.match(/^>\s?(.*)$/))) {
        flushPara();
        closeList();
        out.push(`<blockquote>${inline(m[1])}</blockquote>`);
      } else if (/^-{3,}$/.test(line.trim())) {
        flushPara();
        closeList();
        out.push('<hr>');
      } else {
        closeList();
        para.push(line);
      }
    }
    flushPara();
    closeList();
    return out.join('\n');
  }

  return { render, escapeHtml };
});
