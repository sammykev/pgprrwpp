'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { buildRequest, PROOFREAD_SCHEMA } = require('./prompts');

const DEFAULT_MODEL = 'claude-opus-5-5';
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
];

// Server-side web search can pause a long turn; resume at most this many times.
const MAX_CONTINUATIONS = 5;

function createClient(apiKey) {
  // With no key the SDK falls back to ANTHROPIC_API_KEY / an `ant auth login` profile.
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic();
}

function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Your API key was rejected. Check it in Settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key does not have access to the selected model.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limit reached. Wait a moment and try again.';
  if (err instanceof Anthropic.BadRequestError) return `Request rejected: ${err.message}`;
  if (err instanceof Anthropic.APIUserAbortError) return 'Cancelled.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check your internet connection.';
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ''}: ${err.message}`;
  return err && err.message ? err.message : String(err);
}

function textOf(content) {
  return content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

function sourcesOf(content) {
  const seen = new Map();
  for (const block of content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (r.type === 'web_search_result' && !seen.has(r.url)) seen.set(r.url, { title: r.title, url: r.url });
      }
    }
  }
  return [...seen.values()];
}

/**
 * Run one writing task. Streams text through onDelta and resolves with
 * { text, data, sources, stopReason, model, usage }.
 */
async function runTask({ client, task, input, opts = {}, settings = {}, onDelta = () => {}, signal }) {
  const req = buildRequest(task, input, opts, settings);
  const model = settings.model || DEFAULT_MODEL;

  const params = {
    model,
    max_tokens: req.structured ? 16000 : 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: req.effort },
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
  };
  if (req.structured) {
    params.output_config.format = { type: 'json_schema', schema: PROOFREAD_SCHEMA };
  }
  if (req.webSearch) {
    params.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 10 }];
  }

  const allContent = [];
  let message;
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const stream = client.beta.messages.stream(params, { signal });
    if (!req.structured) {
      stream.on('text', (delta) => onDelta(delta));
    }
    message = await stream.finalMessage();
    allContent.push(...message.content);
    if (message.stop_reason !== 'pause_turn') break;
    // Re-send the paused assistant turn; the server resumes the search loop.
    params.messages = [...params.messages, { role: 'assistant', content: message.content }];
  }

  if (message.stop_reason === 'refusal') {
    throw new Error('Claude declined this request. Try rephrasing or shortening the text.');
  }

  const text = textOf(allContent);
  let data = null;
  if (req.structured) {
    if (message.stop_reason === 'max_tokens') throw new Error('The text is too long to proofread in one pass. Try a shorter section.');
    data = JSON.parse(text);
  }

  return {
    text,
    data,
    sources: sourcesOf(allContent),
    stopReason: message.stop_reason,
    model: message.model,
    usage: message.usage,
  };
}

module.exports = { runTask, createClient, friendlyError, MODELS, DEFAULT_MODEL };
