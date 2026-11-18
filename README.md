# Content Analysis

Upload a PDF, DOCX or TXT file and get an AI analysis (summary, key topics, people), then ask questions that are answered **only from that document**. Built with React, Node.js/Express and Claude (`claude-sonnet-5-5`).

## How it works

```
Upload file → extract text (PDF / DOCX / TXT) → save in uploads/
           → Claude: summary + topics + people (structured JSON)
Ask question → Claude answers from the document text only
             ("not in the document" if the answer isn't there)
```

- **Frontend:** one page with React and Vite: upload form, analysis panel, Q&A chat.
- **Backend:** Express with two endpoints: `POST /api/upload` and `POST /api/ask`.
- Text extraction uses `pdf-parse` (PDF) and `mammoth` (DOCX).

## Setup

Requirements: Node.js 20+ and an Anthropic API key.

1. Create `server/.env` from the example and add your key:
   ```bash
   cp server/.env.example server/.env
   # then edit server/.env and set ANTHROPIC_API_KEY=...
   ```
2. Install:
   ```bash
   cd server && npm install
   cd ../client && npm install
   ```

## Run

In two terminals:

```bash
cd server && npm run dev     # http://localhost:5050
cd client && npm run dev     # http://localhost:5173  ← open this
```

## Test

```bash
cd server && npm test
```

32 tests (Node.js test runner + Supertest) with Claude **mocked**, so they're free and deterministic. They cover:
- text extraction from real PDF/DOCX files
- validation errors and safe file ids
- caching and duplicate-request handling
- Claude refusals and cut-off answers

## Key decisions

1. **Whole document in the prompt, with prompt caching, instead of RAG.** One uploaded document fits in Claude's context window, so sending the full text is simpler and never misses a relevant part, unlike retrieving chunks. The document is marked for **prompt caching**, so follow-up questions reuse it at a much lower input cost.
2. **Structured output for the analysis.** Claude must return JSON matching a schema (`summary`, `topics`, `people`), so the UI never has to parse free text.
3. **Grounded answers.** The system prompt tells Claude to answer only from the document and to say so plainly when the answer isn't there.
4. **No duplicate paid calls:**
   - Claude is called only when you click Upload or Ask.
   - The same file (by content hash) is analysed once, and the same question on the same document is answered once. Repeats come from `uploads/.cache/`.
   - Identical requests in flight share one call.
   - SDK auto-retries are off.
   - The UI blocks double clicks.
5. **Failures are never cached:**
   - A refusal, a cut-off answer (`max_tokens`) or an unreadable analysis returns an error instead of being saved.
   - A failed cache write still returns the result that was already paid for.
6. **Safe file handling:**
   - Files are limited to 10 MB.
   - Stored names are sanitised.
   - The document id is checked against a strict pattern, so a request can't read other files on the server.

## Limitations / next steps

- **Scanned (image-only) PDFs** aren't supported. They would need OCR.
- **Very large documents** (over ~600,000 characters) are rejected. Next step: RAG, meaning chunks, embeddings and vector search, then sending only the relevant parts to Claude.
- **No login or rate limiting.** It's built as a local tool. Before deploying publicly, add authentication and per-user limits to control API cost.
- **Prompt injection.** A document can contain text aimed at the AI. The system prompt keeps answers grounded, but this can't be fully prevented.
- Uploads and cached answers are stored on local disk. A deployed version would use cloud storage and a database.

## How I built it

I used Claude Code with a **spec → plan → tests-first** workflow. The design spec and implementation plan are in [`docs/superpowers/`](docs/superpowers/). Each step was built test-first and reviewed, and a final AI code review led to four extra fixes, each with a regression test.

## Notes

- Uploaded files and their extracted text are saved in `uploads/` (git-ignored). Delete `uploads/.cache/` to force fresh answers.
- Each Claude call is logged in the server terminal as `[claude] call analyze|ask`, with token usage.
- Optional `server/.env` settings: `CLAUDE_MODEL`, `PORT`, and `ANTHROPIC_WORKSPACE_ID` (only needed if your API key isn't scoped to a workspace).
