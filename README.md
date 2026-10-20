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

Requirements: [Node.js 20+](https://nodejs.org) and a Claude API key from <https://console.anthropic.com>.

```bash
npm install
npm start          # run the app
npm test           # unit tests
npm run dist:win   # build a Windows installer + portable .exe into dist/
```

On first launch, open **Settings** and paste your API key. It is encrypted with Windows' DPAPI (via Electron `safeStorage`) and stored in `%APPDATA%\Quillwise\settings.json`. If `ANTHROPIC_API_KEY` is set in the environment, that is used when no key is saved.

In Settings you can also pick the model (Claude Opus 5.5 by default; Sonnet 5.5 and Haiku 5.5 are faster and cheaper), American or British English, and your default citation style.

Shortcut: **Ctrl+Enter** runs the current tool.

## How it works

```
src/
  main/main.js       Electron window, IPC, file open/save
  main/ai.js         Claude API calls (streaming, web search, pause_turn resume, refusal fallback)
  main/prompts.js    System prompt and settings for each tool
  main/settings.js   Settings file + encrypted API key
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

- The originality check is a web spot-check, not a comparison against private databases such as Turnitin's student-paper archive. Treat "Likely original" as a good sign, not a guarantee.
- AI-suggested references come from live web search, but check each one before you submit.
- "Natural voice" improves readability and style. It is meant for polishing your own writing, not for passing off generated text as your own where that isn't allowed; follow your school's or publisher's AI-use rules.
