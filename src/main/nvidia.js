'use strict';

// NVIDIA API catalog (build.nvidia.com): free-tier hosted open models behind an
// OpenAI-compatible chat completions endpoint. It has no web search, so tasks
// that need sources go through pipeline.js (Crossref/OpenAlex/Tavily).
const { buildRequest, PROOFREAD_SCHEMA } = require('./prompts');
const { runResearchTask } = require('./pipeline');

const BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_NVIDIA_MODEL = 'mistralai/mistral-large-2-instruct';
const NVIDIA_MODELS = [
  'mistralai/mistral-large-2-instruct',
  'moonshotai/kimi-k2.6',
  'deepseek-ai/deepseek-v4.1-flash',
  'nvidia/nemotron-3-super-120b-a12b',
  'writer/palmyra-creative-122b',
  'z-ai/glm-5.3-flash',
  'google/gemma-4-31b-it',
];

const PROOFREAD_JSON_RULES = `Respond with only a JSON object (no markdown fences, no commentary) matching this JSON Schema:
${JSON.stringify(PROOFREAD_SCHEMA)}`;

class NvidiaError extends Error {}

function httpError(status, body) {
  if (status === 401 || status === 403) return new NvidiaError('Your NVIDIA API key was rejected. Check it in Settings.');
  if (status === 404) return new NvidiaError('That NVIDIA model was not found. Pick another model in Settings.');
  if (status === 429) return new NvidiaError('NVIDIA rate limit or free credits reached. Wait a moment and try again.');
  return new NvidiaError(`NVIDIA API error ${status}: ${String(body).slice(0, 300)}`);
}

// Reasoning models may put their chain of thought inline in <think> tags.
function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');
}

function holdPartialTag(text) {
  for (let n = Math.min(6, text.length); n > 0; n--) {
    if ('<think>'.startsWith(text.slice(-n))) return text.slice(0, -n);
  }
  return text;
}

function parseJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new NvidiaError('The model did not return a proofreading result. Try again or pick another model.');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new NvidiaError('The model returned malformed proofreading data. Try again or pick another model.');
  }
}

// One streamed chat completion. Returns { text, finishReason } with any
// <think> reasoning removed; onDelta receives only the visible text.
async function nvidiaChat({ apiKey, model, system, user, temperature = 0.6, maxTokens = 8192, onDelta, signal, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        model: model || DEFAULT_NVIDIA_MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new NvidiaError('Could not reach the NVIDIA API. Check your internet connection.');
  }
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));

  // Parse the server-sent event stream.
  const decoder = new TextDecoder();
  let raw = '';
  let pending = '';
  let shown = 0;
  let finishReason = null;
  for await (const chunk of res.body) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      const data = line.replace(/^data:\s*/, '').trim();
      if (!line.startsWith('data:') || !data || data === '[DONE]') continue;
      let evt;
      try { evt = JSON.parse(data); } catch { continue; }
      const choice = evt.choices && evt.choices[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta && choice.delta.content;
      if (!delta) continue;
      raw += delta;
      if (onDelta) {
        // Forward only text outside <think> blocks, holding back a possible
        // half-received "<think>" tag at the end.
        const visible = holdPartialTag(stripThinking(raw));
        if (visible.length > shown) {
          onDelta(visible.slice(shown));
          shown = visible.length;
        }
      }
    }
  }
  return { text: stripThinking(raw), finishReason };
}

async function runNvidiaTask({ apiKey, model, task, input, opts = {}, settings = {}, searchKeys = {}, onDelta = () => {}, onStatus = () => {}, signal, fetchImpl = fetch }) {
  if (!apiKey) throw new NvidiaError('Add your NVIDIA API key in Settings.');
  const req = buildRequest(task, input, opts, settings);
  const chat = (args) => nvidiaChat({ apiKey, model, signal, fetchImpl, ...args });

  if (req.webSearch) {
    // No built-in search: run the search-then-write pipeline instead.
    const result = await runResearchTask({ task, input, opts, settings, chat, searchKeys, onDelta, onStatus, signal, fetchImpl });
    return { ...result, model: model || DEFAULT_NVIDIA_MODEL };
  }

  const system = req.structured ? `${req.system}\n${PROOFREAD_JSON_RULES}` : req.system;
  const { text, finishReason } = await chat({
    system,
    user: req.user,
    temperature: req.structured ? 0.1 : 0.6,
    onDelta: req.structured ? null : onDelta,
  });
  return {
    text,
    data: req.structured ? parseJsonObject(text) : null,
    sources: [],
    stopReason: finishReason === 'length' ? 'max_tokens' : 'end_turn',
    model: model || DEFAULT_NVIDIA_MODEL,
  };
}

module.exports = { runNvidiaTask, nvidiaChat, NvidiaError, NVIDIA_MODELS, DEFAULT_NVIDIA_MODEL, stripThinking, parseJsonObject };
