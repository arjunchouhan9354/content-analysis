# Content Analysis — Design

Date: 2026-11-18 · Status: awaiting approval

## Intent
A simple single-page app: upload a document, get an automatic analysis of it, then ask
questions about it and get answers grounded in that document. Uploaded documents are kept
in this folder (`content-analysis/uploads/`). Keep it simple on both frontend and backend.

## Goals
- Upload one PDF, DOCX or TXT file at a time.
- After upload, show: a short summary, key topics, and main people/characters mentioned.
- A question box under the analysis; answers appear as a chat list for the current document.
- Use the same Claude setup as the comics backend: `@anthropic-ai/sdk`, model `claude-sonnet-5-5`, key from `ANTHROPIC_API_KEY`.

## Non-goals
- No login/auth, no database, no deployment setup.
- No multi-document library or switching between past documents (files stay on disk, but the UI works on the latest upload only).
- No OCR — scanned/image-only PDFs are not supported.
- No vector search / chunking.

## Anti-goals (failure even if it "works")
- Answers that invent facts not in the document. Claude must say when the answer isn't in the document.
- The API key ever reaching the browser.
- Growing into a framework-heavy app (no Redux, no router, no UI kit needed).

## Constraints
- Lives entirely in `content-analysis/`.
- Never read any `.env`; ship `server/.env.example`, the user creates `.env` with their key.
- No git commits by Claude.

## Approaches considered
- **A. Extract text on the server, send text to Claude** — one code path, cheap with prompt caching; ignores images. **Chosen.**
- B. Send PDFs natively to Claude, extract only DOCX/TXT — sees images, but two code paths and higher cost.
- C. Chunk + embeddings search — handles huge docs, but needs a vector store; too complex for this.

## Design

### Layout
```
content-analysis/
  client/          React + Vite SPA (dev server :5173, proxies /api -> :5050)
  server/          Express, single server.js (+ small helper modules if needed)
    .env.example   ANTHROPIC_API_KEY=, CLAUDE_MODEL=claude-sonnet-5-5, PORT=5050
  uploads/         saved originals + extracted .txt (created at runtime)
```

### Backend (Express)
- `POST /api/upload` (multipart, field `file`, max 10 MB, only .pdf/.docx/.txt)
  1. Save original to `uploads/<timestamp>-<safe-name>`.
  2. Extract text: `pdf-parse` (PDF), `mammoth` (DOCX), read as UTF-8 (TXT). Save as `<same>.txt`.
  3. Reject with a clear message if text is empty (likely scanned) or over ~600k characters (~150k tokens).
  4. One Claude call asking for JSON `{ summary, topics: [], people: [] }`.
  5. Respond `{ docId, fileName, analysis }`. `docId` = saved base filename.
- `POST /api/ask` — body `{ docId, question, history: [{role, content}] }`
  - Loads `uploads/<docId>.txt`; system prompt = instructions + document text marked with
    `cache_control` so repeated questions reuse the cached document.
  - Instructions: answer only from the document; say plainly if it isn't covered.
  - Responds `{ answer }`.
- Errors return `{ error: "<human message>" }` with a proper status; missing API key gives a
  clear startup warning and a readable error on calls.
- `docId` is validated (no path traversal) before reading from disk.

### Frontend (React, single page, plain CSS)
```
┌───────────────────────────────────────────────┐
│ Content Analysis                              │
│ [ Choose file (PDF/DOCX/TXT) ]  [ Upload ]    │
├───────────────────────────────────────────────┤
│ report.pdf                                    │
│ Summary:  ...                                 │
│ Key topics: • ... • ...                       │
│ People:     • ... • ...                       │
├───────────────────────────────────────────────┤
│ Q: who signed the contract?                   │
│ A: ...                                        │
│ [ Ask a question about this document… ][Ask]  │
└───────────────────────────────────────────────┘
```
- States: idle → uploading/analysing (spinner) → ready (analysis + question box) → error message.
- Question box disabled until a document is ready; uploading a new file clears the chat.
- Chat history kept in React state only.

### Run
- `cd server && npm install && npm run dev` · `cd client && npm install && npm run dev`.
- README with these steps and the `.env` setup.

## Left to the builder
- Exact prompts and JSON parsing details (with a fallback if Claude's JSON is malformed).
- `max_tokens` values, small styling choices.
- Light tests for text extraction and `docId` validation (node's built-in test runner).
