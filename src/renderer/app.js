'use strict';

/* global TextStats, Markdown, Citations */

const api = window.quill;
const $ = (id) => document.getElementById(id);

let settings = null;
let current = 'proofread';
let activeRequest = null;
const results = {}; // tool -> rendered state, so switching tools keeps results
const optionValues = {}; // tool -> { key: value }

const SELECT = 'select';
const TEXT = 'text';
const NUMBER = 'number';
const CHECK = 'checkbox';

function tools() {
  const o = settings.options;
  const styles = o.citationStyles;
  return {
    proofread: {
      title: 'Proofread',
      desc: 'Catch spelling, grammar, punctuation and clarity problems, then accept fixes one by one.',
      button: 'Check my text',
      options: [],
    },
    paraphrase: {
      title: 'Paraphrase',
      desc: 'Say the same thing in different words. Choose a mode and how much the wording should change.',
      button: 'Paraphrase',
      options: [
        { key: 'mode', label: 'Mode', kind: SELECT, values: o.paraphraseModes, def: 'standard' },
        { key: 'synonyms', label: 'Word changes', kind: SELECT, values: ['low', 'medium', 'high'], def: 'medium' },
        { key: 'freeze', label: 'Keep these words unchanged', kind: TEXT, wide: true, placeholder: 'e.g. photosynthesis, Lagos' },
      ],
    },
    rewrite: {
      title: 'Rewrite & tone',
      desc: 'Rework your text for a different tone or audience while keeping what you meant.',
      button: 'Rewrite',
      options: [
        { key: 'tone', label: 'Tone', kind: SELECT, values: o.tones, def: 'professional' },
        { key: 'audience', label: 'Audience', kind: TEXT, placeholder: 'e.g. hiring managers' },
        { key: 'instruction', label: 'Anything else?', kind: TEXT, wide: true, placeholder: 'e.g. make the opening stronger' },
      ],
    },
    humanize: {
      title: 'Natural voice',
      desc: 'Make stiff or robotic writing read like a person wrote it: varied rhythm, concrete words, no filler.',
      button: 'Humanize',
      options: [
        { key: 'voice', label: 'Voice (optional)', kind: TEXT, wide: true, placeholder: 'e.g. warm, first person, a bit witty' },
      ],
    },
    compose: {
      title: 'Draft composer',
      desc: 'Turn an idea, a prompt or rough notes into a full first draft.',
      button: 'Write draft',
      inputLabel: 'Your idea or notes',
      placeholder: 'Describe what you want to write, who it is for, and any points it must include…',
      markdown: true,
      options: [
        { key: 'type', label: 'Format', kind: SELECT, values: o.draftTypes, def: 'essay' },
        { key: 'tone', label: 'Tone', kind: SELECT, values: o.tones, def: 'neutral' },
        { key: 'words', label: 'Length (words)', kind: NUMBER, def: 600 },
        { key: 'outline', label: 'Include outline', kind: CHECK, def: true },
        { key: 'research', label: 'Research & cite sources', kind: CHECK, def: false },
        { key: 'style', label: 'Citation style', kind: SELECT, values: styles, def: settings.citationStyle },
      ],
    },
    originality: {
      title: 'Originality check',
      desc: 'Spot-check your text against the web for matching passages, and get attributed or rewritten fixes.',
      button: 'Check originality',
      markdown: true,
      options: [
        { key: 'style', label: 'Citation style for fixes', kind: SELECT, values: styles, def: settings.citationStyle },
      ],
    },
    cite: {
      title: 'Citations',
      desc: 'Find real sources for your claims and add references, or build a reference by hand.',
      button: 'Find sources',
      markdown: true,
      options: [
        { key: 'style', label: 'Style', kind: SELECT, values: styles, def: settings.citationStyle },
      ],
      manual: true,
    },
  };
}

// ---------- persistence of the draft (per-viewer convenience only) ----------
function loadDraft() {
  try { return localStorage.getItem('quillwise.draft') || ''; } catch { return ''; }
}
function saveDraft(text) {
  try { localStorage.setItem('quillwise.draft', text); } catch { /* storage unavailable */ }
}

// ---------- UI helpers ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

function showBanner(msg, kind = 'warn') {
  const b = $('banner');
  if (!msg) { b.hidden = true; return; }
  b.textContent = msg;
  b.className = `banner ${kind === 'error' ? 'error' : ''}`;
  b.hidden = false;
}

function statsLine(text, extra = []) {
  const s = TextStats.analyze(text);
  const items = [
    ['Words', s.words], ['Characters', s.characters], ['Sentences', s.sentences],
    ['Reading time', s.words ? `${s.readingMinutes} min` : '—'],
  ];
  if (s.flesch !== null) items.push(['Readability', `${s.flesch} · ${s.readability}`]);
  return [...items, ...extra].map(([k, v]) => el('span', {}, `${k}: `, el('b', {}, v)));
}

function updateInputStats() {
  $('inputStats').replaceChildren(...statsLine($('input').value));
}

function setOutput(nodesOrText, { markdown = false, plain = '' } = {}) {
  const out = $('output');
  out.classList.toggle('md', markdown);
  if (typeof nodesOrText === 'string') {
    if (markdown) out.innerHTML = Markdown.render(nodesOrText); // renderer escapes all HTML
    else out.textContent = nodesOrText;
  } else {
    out.replaceChildren(...[].concat(nodesOrText));
  }
  results[current] = { html: out.innerHTML, md: markdown, plain: plain || (typeof nodesOrText === 'string' ? nodesOrText : out.innerText), extraStats: results[current]?.extraStats || [] };
}

function setOutputStats(extra = []) {
  const plain = results[current]?.plain || '';
  if (results[current]) results[current].extraStats = extra;
  $('outputStats').replaceChildren(...(plain ? statsLine(plain, extra) : []));
}

function placeholder() {
  const t = tools()[current];
  setOutputEmpty(`Results from ${t.title} will appear here.`);
}

function setOutputEmpty(msg) {
  const out = $('output');
  out.classList.remove('md');
  out.replaceChildren(el('p', { class: 'placeholder' }, msg));
  $('outputStats').replaceChildren();
}

// ---------- tool rendering ----------
function renderNav() {
  const nav = $('tools');
  nav.replaceChildren();
  for (const [key, t] of Object.entries(tools())) {
    nav.append(el('button', {
      class: `nav-item ${key === current ? 'active' : ''}`,
      type: 'button',
      'aria-current': key === current ? 'page' : false,
      onclick: () => selectTool(key),
    }, t.title));
  }
}

function optionValue(tool, opt) {
  const vals = (optionValues[tool] ||= {});
  if (!(opt.key in vals)) vals[opt.key] = opt.def ?? '';
  return vals[opt.key];
}

function renderOptions() {
  const t = tools()[current];
  const box = $('options');
  box.replaceChildren();
  const vals = (optionValues[current] ||= {});

  if (t.manual) {
    const mode = vals.__mode || 'ai';
    const seg = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Citation mode' },
      el('button', { type: 'button', class: mode === 'ai' ? 'on' : '', onclick: () => { vals.__mode = 'ai'; selectTool(current); } }, 'Find sources with AI'),
      el('button', { type: 'button', class: mode === 'manual' ? 'on' : '', onclick: () => { vals.__mode = 'manual'; selectTool(current); } }, 'Build a reference'));
    box.append(seg);
    if (mode === 'manual') {
      renderManualCitationForm(box, vals);
      return;
    }
  }

  for (const opt of t.options) {
    const value = optionValue(current, opt);
    const set = (v) => { vals[opt.key] = v; };
    let control;
    if (opt.kind === SELECT) {
      control = el('select', { onchange: (e) => set(e.target.value) },
        opt.values.map((v) => el('option', { value: v, selected: v === value }, v[0].toUpperCase() + v.slice(1))));
    } else if (opt.kind === CHECK) {
      control = el('input', { type: 'checkbox', checked: !!value, onchange: (e) => set(e.target.checked) });
      box.append(el('label', { class: 'opt check' }, control, opt.label));
      continue;
    } else {
      control = el('input', {
        type: opt.kind === NUMBER ? 'number' : 'text', value, placeholder: opt.placeholder || '',
        class: opt.wide ? 'wide' : '', min: opt.kind === NUMBER ? 100 : false, max: opt.kind === NUMBER ? 5000 : false, step: opt.kind === NUMBER ? 50 : false,
        oninput: (e) => set(e.target.value),
      });
    }
    box.append(el('label', { class: 'opt' }, opt.label, control));
  }
}

const MANUAL_FIELDS = [
  ['authors', 'Authors (one per line or ;)', 'Okafor, Chidi; Mary Smith'],
  ['year', 'Year', '2024'],
  ['title', 'Title', ''],
  ['container', 'Journal / website', ''],
  ['volume', 'Volume', ''],
  ['issue', 'Issue', ''],
  ['pages', 'Pages', '12-30'],
  ['publisher', 'Publisher', ''],
  ['url', 'URL / DOI', 'https://'],
  ['accessed', 'Date accessed', ''],
];

function renderManualCitationForm(box, vals) {
  const m = (vals.manual ||= { type: 'journal' });
  box.append(el('label', { class: 'opt' }, 'Source type',
    el('select', { onchange: (e) => { m.type = e.target.value; } },
      ['journal', 'book', 'web'].map((v) => el('option', { value: v, selected: m.type === v }, v[0].toUpperCase() + v.slice(1))))));
  for (const [key, label, ph] of MANUAL_FIELDS) {
    box.append(el('label', { class: 'opt' }, label,
      el('input', { type: 'text', value: m[key] || '', placeholder: ph, class: key === 'title' || key === 'authors' ? 'wide' : '', oninput: (e) => { m[key] = e.target.value; } })));
  }
}

function selectTool(key) {
  if (activeRequest) return;
  current = key;
  const t = tools()[key];
  const manual = t.manual && optionValues[key]?.__mode === 'manual';
  $('toolTitle').textContent = t.title;
  $('toolDesc').textContent = t.desc;
  $('runBtn').textContent = manual ? 'Format reference' : t.button;
  $('inputLabel').textContent = t.inputLabel || 'Your text';
  $('input').placeholder = t.placeholder || 'Type or paste your writing here…';
  showBanner(settings.hasApiKey || manual ? '' : 'Add your Claude API key in Settings to start.');
  renderNav();
  renderOptions();
  $('output').onclick = null;
  const r = results[key];
  if (r) {
    const out = $('output');
    out.classList.toggle('md', r.md);
    out.innerHTML = r.html; // previously rendered by this app from escaped content
    setOutputStats(r.extraStats);
    if (key === 'proofread') rebindProofread();
  } else {
    placeholder();
  }
}

// ---------- running tasks ----------
function setBusy(busy) {
  $('runBtn').disabled = busy;
  $('cancelBtn').hidden = !busy;
  for (const b of document.querySelectorAll('.nav-item')) b.disabled = busy;
}

function collectOpts() {
  const t = tools()[current];
  const opts = {};
  for (const o of t.options) opts[o.key] = optionValue(current, o);
  return opts;
}

async function run() {
  const t = tools()[current];
  if (t.manual && optionValues[current]?.__mode === 'manual') return formatManualCitation();

  const input = $('input').value;
  if (!input.trim()) { showBanner('Type or paste some text first.'); return; }
  if (!settings.hasApiKey) { openSettings(); return; }
  showBanner('');

  const task = current;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  activeRequest = { id, task, buffer: '', frame: 0 };
  setBusy(true);

  const out = $('output');
  out.classList.toggle('md', !!t.markdown);
  out.replaceChildren(el('p', { class: 'placeholder' }, el('span', { class: 'spinner' }),
    task === 'originality' || task === 'cite' || (task === 'compose' && optionValue(task, { key: 'research' }))
      ? 'Searching the web and thinking…' : 'Thinking…'));
  $('outputStats').replaceChildren();

  let res;
  try {
    res = await api.run({ id, task, input, opts: collectOpts() });
  } finally {
    activeRequest = null;
    setBusy(false);
  }

  if (!res.ok) {
    showBanner(res.error, 'error');
    placeholder();
    return;
  }

  if (task === 'proofread') return renderProofread(res.data);

  setOutput(res.text, { markdown: !!t.markdown, plain: res.text });
  if (res.sources?.length && (task === 'originality' || task === 'cite' || task === 'compose')) {
    appendSources(res.sources);
  }
  const extra = [];
  if (task === 'paraphrase' || task === 'rewrite' || task === 'humanize') {
    const ov = TextStats.overlap(input, res.text);
    extra.push(['Wording reused from original', `${ov}%`]);
  }
  setOutputStats(extra);
  if (res.stopReason === 'max_tokens') showBanner('The result was cut off because it hit the length limit.');
}

function appendSources(sources) {
  const box = el('div', { class: 'sources' }, el('strong', {}, 'Pages searched'),
    el('ul', {}, sources.slice(0, 15).map((s) => el('li', {}, el('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title || s.url)))));
  $('output').append(box);
  results[current].html = $('output').innerHTML;
}

api.onDelta(({ id, text }) => {
  const r = activeRequest;
  if (!r || r.id !== id) return;
  r.buffer += text;
  if (r.frame) return;
  r.frame = requestAnimationFrame(() => {
    r.frame = 0;
    if (activeRequest !== r || current !== r.task) return;
    const out = $('output');
    if (tools()[r.task].markdown) out.innerHTML = Markdown.render(r.buffer);
    else out.textContent = r.buffer;
    out.scrollTop = out.scrollHeight;
  });
});

// ---------- proofread ----------
let proofIssues = [];

function renderProofread(data) {
  const input = $('input').value;
  proofIssues = (data.issues || []).filter((i) => i.original && i.original !== i.replacement && input.includes(i.original));
  const nodes = [];
  const count = proofIssues.length;
  const chipClass = count === 0 ? 'chip' : count < 5 ? 'chip warn' : 'chip bad';
  nodes.push(el('div', { class: 'summary-line' },
    el('span', { class: chipClass }, count === 0 ? 'Looks good' : `${count} suggestion${count === 1 ? '' : 's'}`), ' ',
    count ? el('button', { class: 'btn small', type: 'button', 'data-act': 'all' }, 'Accept all') : ''));
  proofIssues.forEach((issue, i) => {
    nodes.push(el('div', { class: 'issue', 'data-i': i },
      el('div', { class: 'cat' }, issue.category),
      el('div', { class: 'change' }, el('del', {}, issue.original), ' → ', el('ins', {}, issue.replacement || '(remove)')),
      el('div', { class: 'why' }, issue.explanation),
      el('div', { class: 'row' },
        el('button', { class: 'btn small primary', type: 'button', 'data-act': 'accept' }, 'Accept'),
        el('button', { class: 'btn small ghost', type: 'button', 'data-act': 'dismiss' }, 'Dismiss'))));
  });
  if (!count) nodes.push(el('p', { class: 'placeholder' }, 'No problems found.'));
  setOutput(nodes, { plain: data.corrected_text || '' });
  results.proofread.issues = proofIssues;
  setOutputStats([]);
  rebindProofread();
}

function rebindProofread() {
  proofIssues = results.proofread?.issues || [];
  $('output').onclick = (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const input = $('input');
    if (act === 'all') {
      let text = input.value;
      document.querySelectorAll('.issue:not(.done)').forEach((card) => {
        const issue = proofIssues[card.dataset.i];
        if (text.includes(issue.original)) text = text.replace(issue.original, issue.replacement);
        card.classList.add('done');
      });
      input.value = text;
    } else {
      const card = btn.closest('.issue');
      const issue = proofIssues[card.dataset.i];
      if (act === 'accept') {
        if (input.value.includes(issue.original)) input.value = input.value.replace(issue.original, issue.replacement);
        else showBanner('That passage has changed since the check, so the fix was not applied.');
      }
      card.classList.add('done');
      card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    }
    saveDraft(input.value);
    updateInputStats();
    results.proofread.html = $('output').innerHTML;
  };
}

// ---------- manual citations ----------
function formatManualCitation() {
  const vals = optionValues.cite || {};
  const m = vals.manual || {};
  const style = vals.style || settings.citationStyle;
  if (!m.title) { showBanner('Enter at least a title.'); return; }
  showBanner('');
  const src = { ...m, authors: (m.authors || '').split(/\n|;/).map((s) => s.trim()).filter(Boolean) };
  const ref = Citations.format(style, src);
  const intext = Citations.inText(style, src);
  setOutput([
    el('div', { class: 'ref' }, el('div', { class: 'cat muted' }, `${style} reference`),
      el('div', {}, ...italicNodes(ref))),
    el('div', { class: 'ref' }, el('div', { class: 'cat muted' }, 'In-text citation'), intext),
  ], { plain: `${ref.replace(/\*/g, '')}\n\nIn-text: ${intext}` });
  setOutputStats([]);
}

// Turn *italic* markers into <em> nodes without using innerHTML.
function italicNodes(s) {
  return s.split(/(\*[^*]+\*)/).filter(Boolean).map((part) =>
    part.startsWith('*') && part.endsWith('*') ? el('em', {}, part.slice(1, -1)) : document.createTextNode(part));
}

// ---------- settings ----------
function openSettings() {
  const o = settings.options;
  $('model').replaceChildren(...o.models.map((m) => el('option', { value: m.id, selected: m.id === settings.model }, m.label)));
  $('citationStyle').replaceChildren(...o.citationStyles.map((s) => el('option', { value: s, selected: s === settings.citationStyle }, s)));
  $('englishVariant').value = settings.englishVariant;
  $('apiKey').value = '';
  $('keyHint').textContent = settings.hasApiKey
    ? 'A key is saved. Leave blank to keep it.'
    : 'Get a key at console.anthropic.com. It is stored encrypted on this computer.';
  $('settingsDialog').showModal();
}

async function saveSettingsFromDialog() {
  const patch = {
    model: $('model').value,
    englishVariant: $('englishVariant').value,
    citationStyle: $('citationStyle').value,
  };
  const key = $('apiKey').value.trim();
  if (key) patch.apiKey = key;
  const view = await api.setSettings(patch);
  settings = { ...settings, ...view };
  selectTool(current);
}

// ---------- wiring ----------
async function init() {
  settings = await api.getSettings();

  const input = $('input');
  input.value = loadDraft();
  input.addEventListener('input', () => { saveDraft(input.value); updateInputStats(); });
  updateInputStats();

  $('runBtn').addEventListener('click', run);
  $('cancelBtn').addEventListener('click', () => activeRequest && api.cancel(activeRequest.id));
  $('settingsBtn').addEventListener('click', openSettings);
  $('settingsDialog').addEventListener('close', () => {
    if ($('settingsDialog').returnValue === 'save') saveSettingsFromDialog();
  });

  $('openBtn').addEventListener('click', async () => {
    const f = await api.openFile();
    if (f) { input.value = f.text; saveDraft(f.text); updateInputStats(); }
  });
  $('clearBtn').addEventListener('click', () => { input.value = ''; saveDraft(''); updateInputStats(); input.focus(); });
  $('copyBtn').addEventListener('click', async () => {
    const text = results[current]?.plain;
    if (text) { await navigator.clipboard.writeText(text); flash($('copyBtn'), 'Copied'); }
  });
  $('useBtn').addEventListener('click', () => {
    const text = results[current]?.plain;
    if (text) { input.value = text; saveDraft(text); updateInputStats(); flash($('useBtn'), 'Done'); }
  });
  $('saveBtn').addEventListener('click', () => {
    const text = results[current]?.plain;
    if (text) api.saveFile(text, `${current}.${tools()[current].markdown ? 'md' : 'txt'}`);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (!activeRequest) run(); }
  });

  selectTool(current);
  if (!settings.hasApiKey) openSettings();
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1200);
}

init();
