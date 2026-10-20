# Quillwise

A Windows desktop writing assistant inspired by QuillBot and Grammarly, powered by Claude.

| Tool | What it does |
|---|---|
| **Proofread** | Finds spelling, grammar, punctuation, word-choice and clarity issues. Accept fixes one at a time or all at once. |
| **Paraphrase** | Rewords text in 8 modes (Standard, Fluency, Formal, Academic, Simple, Creative, Expand, Shorten), with a "word changes" setting and words to keep frozen. Shows how much wording is reused from the original. |
| **Rewrite & tone** | Rewrites for a tone (professional, friendly, confident, academic, persuasive, casual…) and audience. |
| **Natural voice** | Makes stiff, formulaic text read like a person wrote it: varied rhythm, concrete words, no filler phrases. Keeps every claim and citation. |
| **Draft composer** | Turns an idea or rough notes into a full draft (essay, blog post, email, report, cover letter…), optionally with an outline and web-researched, cited sources. |
| **Originality check** | Spot-checks distinctive passages against the web, lists matching sources, and suggests either a quoted-and-cited version or an original rewrite. |
| **Citations** | Finds real sources for your claims and adds in-text citations plus a reference list (APA 7, MLA 9, Chicago, Harvard, IEEE). Also has an offline **reference builder** for sources you already have. |

Every panel shows word count, reading time and a Flesch readability score. Your draft autosaves locally.

## Getting started

Requirements: [Node.js 20+](https://nodejs.org) and an API key from one of these providers:

| Provider | Cost | Tools available |
|---|---|---|
| **Claude** (Anthropic): key from <https://console.anthropic.com> | Pay as you go (Claude Haiku 5.5 is very cheap) | All seven, with Claude's built-in web search |
| **NVIDIA API catalog**: free key from <https://build.nvidia.com> | Free tier for prototyping, rate-limited | All seven, using the free search services below |

To get an NVIDIA key: sign in at build.nvidia.com, open any model page, click **Get API Key**, and copy the key (it starts with `nvapi-`). In Quillwise, open **Settings**, choose **NVIDIA API catalog**, and paste it. The default model is `mistralai/mistral-large-2-instruct`; you can type any other chat model ID from the catalog.

### Free search services (NVIDIA mode)

NVIDIA's models can't search the web, so Quillwise does the searching itself and gives the model only what it found:

| Service | Used for | Key |
|---|---|---|
| **Crossref** | Citations and researched drafts: real journal articles with DOIs | None needed |
| **OpenAlex** | Same, with better relevance and abstracts | None needed (shared free allowance); optional free key from openalex.org for your own daily allowance |
| **Tavily** | Originality check (exact-phrase web search), plus web pages as extra sources | Free key from <https://tavily.com>, required for the originality check |

The reference list is built by Quillwise from the databases' metadata, not written by the model, so every reference points to a real publication. The model only decides which numbered source supports which sentence.

```bash
npm install
npm start          # run the app
npm test           # unit tests
npm run dist:win   # build a Windows installer + portable .exe into dist/
```

On first launch, open **Settings**, pick a provider and paste your key (and, for NVIDIA, your Tavily key). Keys are encrypted with Windows' DPAPI (via Electron `safeStorage`) and stored in `%APPDATA%\Quillwise\settings.json`. If `ANTHROPIC_API_KEY`, `NVIDIA_API_KEY`, `TAVILY_API_KEY` or `OPENALEX_API_KEY` is set in the environment, it is used when no key is saved.

In Settings you can also pick the model (Claude Opus 5.5 by default; Sonnet 5.5 and Haiku 5.5 are faster and cheaper), American or British English, and your default citation style.

Shortcut: **Ctrl+Enter** runs the current tool.

## How it works

```
src/
  main/main.js       Electron window, IPC, file open/save
  main/ai.js         Claude API calls (streaming, web search, pause_turn resume, refusal fallback)
  main/nvidia.js     NVIDIA API catalog calls (OpenAI-compatible streaming, hides <think> reasoning)
  main/pipeline.js   Search-then-write flows for NVIDIA: citations, originality, researched drafts
  main/research.js   Crossref, OpenAlex and Tavily search clients
  main/prompts.js    System prompt and settings for each tool
  main/settings.js   Settings file + encrypted keys (AI providers and search services)
  preload.js         Narrow bridge exposed to the UI (window.quill)
  renderer/          UI (plain HTML/CSS/JS, strict CSP, no Node access)
  shared/            Pure helpers used by the UI and tests:
                       textstats.js  readability + n-gram overlap
                       citations.js  offline APA/MLA/Chicago/Harvard/IEEE formatter
                       markdown.js   HTML-escaping markdown renderer for AI output
```

- Responses stream into the result pane as they are written.
- Proofreading uses structured JSON output so each suggestion maps to an exact passage in your text.
- Originality, Citations and researched drafts use Claude's server-side web search. Only sources actually returned by search are cited, and the list of pages searched is shown under the result.
- Requests opt into server-side refusal fallback, so a request a model declines is retried on a fallback model.

## Honest limits

- In NVIDIA mode, the originality check compares your 6 longest sentences against Tavily's web results. With Claude, the model chooses what to search.
- The originality check is a web spot-check, not a comparison against private databases such as Turnitin's student-paper archive. Treat "Likely original" as a good sign, not a guarantee.
- AI-suggested references come from live web search, but check each one before you submit.
- "Natural voice" improves readability and style. It is meant for polishing your own writing, not for passing off generated text as your own where that isn't allowed; follow your school's or publisher's AI-use rules.
