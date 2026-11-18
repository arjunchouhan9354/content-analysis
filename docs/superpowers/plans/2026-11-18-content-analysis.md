# Content Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-page React app where the user uploads a PDF/DOCX/TXT, sees a Claude-generated summary/topics/people, then asks questions answered only from that document.

**Architecture:** Express server (`server/`) saves uploads to `content-analysis/uploads/`, extracts plain text, and calls Claude with the full document text in a cached system block. React + Vite client (`client/`) talks to it via a `/api` proxy. No database; the document on disk is the only state.

**Tech Stack:** Node 18+ (CommonJS), Express 5, multer, pdf-parse 1.1.1, mammoth, dotenv, `@anthropic-ai/sdk`; tests with `node --test` + supertest. Client: React 19 + Vite, plain CSS.

**Spec:** `content-analysis/docs/superpowers/specs/2026-11-18-content-analysis-design.md`

## Global Constraints

- All code lives under `content-analysis/`. Server port `5050`, Vite dev port `5173`, Vite proxies `/api` → `http://localhost:5050`.
- Never read any `.env`. Ship `server/.env.example` with `ANTHROPIC_API_KEY=`, `CLAUDE_MODEL=claude-sonnet-5-5`, `PORT=5050`. The user creates `server/.env`.
- Model from `process.env.CLAUDE_MODEL`, default `claude-sonnet-5-5`.
- Upload limits: max 10 MB; extensions `.pdf`, `.docx`, `.txt` (case-insensitive); extracted text max `600000` characters.
- Uploads dir: `content-analysis/uploads/` (override with `UPLOAD_DIR` env, used by tests).
- All error responses are JSON `{ error: "<human message>" }`.
- No git commits by the agent — "Commit" steps are replaced by "Checkpoint": tell the user the one-line message to use.
- No Redux, router or UI kit in the client.
- **No automatic or duplicate paid Claude calls:**
  - Claude is called only from an explicit Upload or Ask click, never on page load or in a `useEffect`.
  - Anthropic client is created with `maxRetries: 0`; no `fallbacks`/server-side fallback beta.
  - Same file content (SHA-256) is analysed once; repeats return the cached analysis.
  - Same question on the same document with the same history is answered once; repeats return the cached answer.
  - Identical requests in flight at the same time share one Claude call.
  - A failed call is never retried automatically; the user clicks again.

## Review Focus

- Filenames with spaces, Hindi/Unicode characters or uppercase extensions (`My Report.PDF`) → accepted, stored under a safe ASCII name. Test in Task 1 (`safeName`) and Task 4 (upload `.TXT`).
- Hindi/Unicode text content and UTF-8 BOM in TXT files → text preserved, BOM stripped. Test in Task 2.
- Tampered `docId` like `../server/.env` or `..%2F` sent to `/api/ask` → 400, never reads outside uploads. Test in Task 1 and Task 4.
- Claude returns analysis with a missing or non-array `topics`/`people` → UI still renders (normalized to `[]`). Test in Task 3.
- Double-clicking Upload / Ask, or two tabs sending the same request → exactly one Claude call. Server side tested in Task 4 (concurrent identical requests); client guard in Task 5; confirmed in Task 6 by counting `[claude] call` log lines.

---

### Task 1: Server scaffold + document store

**Files:**
- Create: `server/package.json`, `server/.env.example`, `.gitignore` (at `content-analysis/`: `node_modules/`, `server/.env`, `uploads/`, `client/dist/`)
- Create: `server/docStore.js`
- Test: `server/test/docStore.test.js`

**Interfaces:**
- Produces (`server/docStore.js`):
  - `getUploadDir(): string` — `process.env.UPLOAD_DIR` or `path.join(__dirname, "..", "uploads")`; creates it if missing.
  - `safeName(originalName: string): string` — lowercase; extension kept; every run of chars outside `[a-z0-9.-]` → `-`; trims leading/trailing `-`; empty stem → `document`.
  - `makeDocId(originalName: string): string` — `` `${Date.now()}-${safeName(originalName)}` ``.
  - `isValidDocId(id: unknown): boolean` — string matching `/^\d+-[a-z0-9.-]+\.(pdf|docx|txt)$/` and not containing `..`.
  - `saveUpload(buffer: Buffer, originalName: string): Promise<{ docId: string, filePath: string }>`
  - `saveText(docId: string, text: string): Promise<void>` — writes `<docId>.txt` UTF-8.
  - `loadText(docId: string): Promise<string|null>` — `null` if invalid id or file missing.
  - `hashBuffer(buffer: Buffer): string` — SHA-256 hex.
  - `cacheKey(...parts: unknown[]): string` — SHA-256 hex of `JSON.stringify(parts)`.
  - `readCache(key: string): Promise<object|null>` / `writeCache(key: string, value: object): Promise<void>` — JSON files in `<uploadDir>/.cache/<key>.json`; `key` must match `/^[a-f0-9]{64}$/` or `readCache` returns `null` and `writeCache` throws.

- [ ] **Step 1: Create `server/package.json`** — `"type": "commonjs"`; scripts `"dev": "node --watch server.js"`, `"start": "node server.js"`, `"test": "node --test test/"`. Install: `npm i express multer pdf-parse@1.1.1 mammoth dotenv @anthropic-ai/sdk` and `npm i -D supertest`. Create `.env.example` and `.gitignore` per Global Constraints.

- [ ] **Step 2: Write failing tests** in `server/test/docStore.test.js` (set `process.env.UPLOAD_DIR` to a fresh `fs.mkdtempSync(os.tmpdir())` before requiring the module):

```js
test("safeName handles spaces, unicode, uppercase ext", () => {
  assert.equal(safeName("My Report.PDF"), "my-report.pdf");
  assert.equal(safeName("कहानी भाग 1.txt"), "1.txt");
  assert.equal(safeName("मेरी.docx"), "document.docx");
});
test("isValidDocId accepts generated ids and rejects traversal", () => {
  assert.ok(isValidDocId(makeDocId("a b.pdf")));
  for (const bad of ["../server/.env", "123-..pdf", "123-a.exe", "", null, "123-a/b.txt"])
    assert.equal(isValidDocId(bad), false);
});
test("saveUpload + saveText + loadText round-trip", async () => {
  const { docId } = await saveUpload(Buffer.from("x"), "notes.txt");
  await saveText(docId, "नमस्ते hello");
  assert.equal(await loadText(docId), "नमस्ते hello");
  assert.equal(await loadText("../x.txt"), null);
  assert.equal(await loadText("1-missing.txt"), null);
});
test("cache round-trip and key guard", async () => {
  const k = cacheKey("doc", "q");
  assert.equal(k, cacheKey("doc", "q"));
  assert.notEqual(k, cacheKey("doc", "q2"));
  assert.equal(await readCache(k), null);
  await writeCache(k, { answer: "A" });
  assert.deepEqual(await readCache(k), { answer: "A" });
  assert.equal(await readCache("../x"), null);
  assert.equal(hashBuffer(Buffer.from("a")), hashBuffer(Buffer.from("a")));
});
```

- [ ] **Step 3: Run** `cd server && npm test` — Expected: FAIL (`Cannot find module '../docStore'`).
- [ ] **Step 4: Implement `server/docStore.js`** per Interfaces (use `fs/promises`).
- [ ] **Step 5: Run** `npm test` — Expected: PASS (4 tests).
- [ ] **Step 6: Checkpoint** — message: `feat(content-analysis): server scaffold and document store`

---

### Task 2: Text extraction

**Files:**
- Create: `server/extract.js`
- Test: `server/test/extract.test.js`

**Interfaces:**
- Produces: `extractText(buffer: Buffer, originalName: string): Promise<string>`
  - `.txt` → UTF-8 decode, strip leading BOM `﻿`.
  - `.pdf` → `require("pdf-parse/lib/pdf-parse.js")(buffer)` → `.text` (require the lib path: pdf-parse 1.x's index runs a debug file read when required directly).
  - `.docx` → `mammoth.extractRawText({ buffer })` → `.value`.
  - Other ext → throws `UserError("Only PDF, DOCX and TXT files are supported.")`.
  - Result `.trim()` empty → throws `UserError("No readable text found in this file. Scanned PDFs aren't supported.")`.
  - Length > 600000 → throws `UserError("This document is too long (over 600,000 characters). Please upload a shorter one.")`.
- Produces: `class UserError extends Error` with `constructor(message: string, status = 422)` setting `this.status`, exported from `server/errors.js` — used by Tasks 3–4.

- [ ] **Step 1: Write failing tests:**

```js
test("txt: keeps unicode, strips BOM", async () => {
  const buf = Buffer.from("﻿नमस्ते world", "utf8");
  assert.equal(await extractText(buf, "a.TXT"), "नमस्ते world");
});
test("unsupported extension -> UserError", async () => {
  await assert.rejects(extractText(Buffer.from("x"), "a.exe"), { name: "UserError", message: /Only PDF, DOCX and TXT/ });
});
test("empty text -> UserError", async () => {
  await assert.rejects(extractText(Buffer.from("   \n"), "a.txt"), /No readable text/);
});
test("over 600000 chars -> UserError", async () => {
  await assert.rejects(extractText(Buffer.from("a".repeat(600001)), "a.txt"), /too long/);
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `server/errors.js` and `server/extract.js` per Interfaces. Set `this.name = "UserError"` in the class.
- [ ] **Step 4: Run** `npm test` — Expected: PASS. (PDF/DOCX paths are verified with real files in Task 6.)
- [ ] **Step 5: Checkpoint** — `feat(content-analysis): text extraction for pdf, docx, txt`

---

### Task 3: Claude module

**Files:**
- Create: `server/claude.js`
- Test: `server/test/claude.test.js`

**Interfaces:**
- Consumes: `UserError` from `server/errors.js`.
- Produces: `createClaude({ client?, model? }) → { analyzeDocument(text): Promise<{summary: string, topics: string[], people: string[]}>, askQuestion(text, question, history): Promise<string> }`
  - `client` defaults to `new Anthropic({ maxRetries: 0 })` (reads `ANTHROPIC_API_KEY`; no SDK auto-retries); `model` defaults to `process.env.CLAUDE_MODEL || "claude-sonnet-5-5"`. If no key and no injected client, methods throw `UserError("ANTHROPIC_API_KEY is not set in server/.env", 500)` (UserError takes optional status as 2nd arg).
  - Both calls use `client.messages.create` (exactly one call per method invocation, no loops/retries, no `fallbacks`) with: `model`, `max_tokens: 16000`, and the **same** `system` array from `buildSystem(text)`:
    `[{ type: "text", text: INSTRUCTIONS }, { type: "text", text: "<document>\n" + text + "\n</document>", cache_control: { type: "ephemeral" } }]`
  - `INSTRUCTIONS` (exact copy): `"You are a careful document analyst. Answer only from the document provided. If the document does not contain the answer, say so plainly and do not guess."`
  - `analyzeDocument`: `output_config: { effort: "medium", format: { type: "json_schema", schema: ANALYSIS_SCHEMA } }`, one user message `"Analyse this document. Give a 3-5 sentence summary, up to 8 key topics, and up to 10 main people or characters (empty list if none)."`. Parse the first `text` block with `JSON.parse`; normalize: `summary` → string (default `""`), `topics`/`people` → array of strings (anything else → `[]`). `ANALYSIS_SCHEMA` = object with required `summary` (string), `topics` (string[]), `people` (string[]), `additionalProperties: false`.
  - `askQuestion`: `output_config: { effort: "low" }`; messages = last 20 entries of `history` that have `role` in `user|assistant` and string `content`, then `{ role: "user", content: question }`. Returns joined text of all `text` blocks.
  - Both: if `response.stop_reason === "refusal"` → throw `UserError("Claude declined to process this request.", 422)`. Before each call log `[claude] call <analyze|ask>`; after it log `usage.input_tokens`, `usage.cache_read_input_tokens`, `usage.output_tokens` (one line) — this is how Task 6 counts paid calls.

- [ ] **Step 1: Write failing tests** using a fake client `{ messages: { create: async (req) => { calls.push(req); return next; } } }`:

```js
test("analyzeDocument sends cached doc and parses JSON", async () => {
  next = { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: '{"summary":"S","topics":["t"],"people":["p"]}' }] };
  const out = await claude.analyzeDocument("DOC");
  assert.deepEqual(out, { summary: "S", topics: ["t"], people: ["p"] });
  const req = calls.at(-1);
  assert.equal(req.model, "claude-sonnet-5-5");
  assert.equal(req.fallbacks, undefined);
  assert.equal(calls.length, 1);
  assert.deepEqual(req.system[1].cache_control, { type: "ephemeral" });
  assert.match(req.system[1].text, /<document>\nDOC\n<\/document>/);
});
test("analyzeDocument normalizes missing arrays", async () => {
  next = { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: '{"summary":"S","topics":null}' }] };
  assert.deepEqual(await claude.analyzeDocument("DOC"), { summary: "S", topics: [], people: [] });
});
test("askQuestion appends question after filtered history, same system", async () => {
  next = { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "A" }] };
  const hist = [{ role: "user", content: "q1" }, { role: "assistant", content: "a1" }, { role: "system", content: "x" }];
  assert.equal(await claude.askQuestion("DOC", "q2", hist), "A");
  const req = calls.at(-1);
  assert.deepEqual(req.messages.map(m => m.content), ["q1", "a1", "q2"]);
  assert.deepEqual(req.system, calls[0].system);
});
test("refusal -> UserError, no second call", async () => {
  next = { stop_reason: "refusal", usage: {}, content: [] };
  const before = calls.length;
  await assert.rejects(claude.askQuestion("DOC", "q", []), { name: "UserError" });
  assert.equal(calls.length, before + 1);
});
test("API error is not retried", async () => {
  let failCalls = 0;
  const failing = createClaude({ client: { messages: { create: async () => { failCalls++; throw new Error("boom"); } } } });
  await assert.rejects(failing.askQuestion("DOC", "q", []));
  assert.equal(failCalls, 1);
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `server/claude.js`** per Interfaces.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Checkpoint** — `feat(content-analysis): claude analyse and ask calls`

---

### Task 4: Express app and routes

**Files:**
- Create: `server/app.js`, `server/server.js`
- Test: `server/test/app.test.js`

**Interfaces:**
- Consumes: `docStore` (Task 1), `extractText`/`UserError` (Task 2), `createClaude` (Task 3).
- Produces: `createApp({ claude }): express.Application`; `server.js` does `require("dotenv").config({ path: path.join(__dirname, ".env") })`, warns `console.warn("ANTHROPIC_API_KEY is not set — add it to server/.env")` if missing, then `createApp({ claude: createClaude() }).listen(process.env.PORT || 5050)`.
- Routes:
  - `POST /api/upload` — multer `memoryStorage`, field `file`, `limits.fileSize = 10 * 1024 * 1024`. No file → 400 `"Please choose a file to upload."`. Flow:
    1. `key = cacheKey("analysis", hashBuffer(buffer))`; if `readCache(key)` hits → return it as-is (`200 { docId, fileName, analysis, cached: true }`) with **no** Claude call and no new file saved.
    2. Otherwise, via `dedupe(key, fn)`: `extractText` (before saving, so rejected files aren't kept) → `saveUpload` → `saveText` → `claude.analyzeDocument` → `writeCache(key, { docId, fileName, analysis })` → `200 { docId, fileName: originalname, analysis, cached: false }`.
  - `POST /api/ask` — JSON body `{ docId, question, history }`. `!isValidDocId(docId)` → 400 `"Invalid document id."`; empty/whitespace `question` → 400 `"Please type a question."`; `loadText` null → 404 `"Document not found. Please upload it again."`. `history` defaults to `[]` if not an array. Then `key = cacheKey("ask", docId, question.trim().replace(/\s+/g, " ").toLowerCase(), history)`; cache hit → `200 { answer, cached: true }`; otherwise `dedupe(key, …)` → `claude.askQuestion` → `writeCache(key, { answer })` → `200 { answer, cached: false }`.
  - `dedupe(key, fn)` (in `app.js`): a module-level `Map<string, Promise>`; if `key` is pending, return the same promise; otherwise store `fn()` and delete the entry when it settles (success or failure). Failures are **not** cached, so the user can click again.
  - Error middleware: `UserError` → its status + message; multer `LIMIT_FILE_SIZE` → 413 `"File is larger than 10 MB."`; `Anthropic.AuthenticationError` → 502 `"Claude rejected the API key. Check server/.env."`; `Anthropic.RateLimitError` → 429 `"Claude is busy, try again in a minute."`; `Anthropic.APIError` → 502 `"Claude request failed. Try again."`; anything else → 500 `"Something went wrong."` (log the error).

- [ ] **Step 1: Write failing tests** with supertest and a counting fake claude — `counts = { analyze: 0, ask: 0 }`; `analyzeDocument: async () => { counts.analyze++; await delay(50); return {summary:"S",topics:[],people:[]}; }`, `askQuestion: async (t,q) => { counts.ask++; await delay(50); return "ans:" + q; }`, held as `fakeClaude` (set `UPLOAD_DIR` to a temp dir first; use a fresh temp dir per test file so caches don't leak). The tests below plus:

```js
test("same file uploaded twice -> one Claude call, second is cached", async () => {
  const before = counts.analyze;
  const a = await request(app).post("/api/upload").attach("file", Buffer.from("same body"), "x.txt");
  const b = await request(app).post("/api/upload").attach("file", Buffer.from("same body"), "y.txt");
  assert.equal(counts.analyze, before + 1);
  assert.equal(b.body.cached, true);
  assert.equal(b.body.docId, a.body.docId);
});
test("concurrent identical uploads -> one Claude call", async () => {
  const before = counts.analyze;
  const send = () => request(app).post("/api/upload").attach("file", Buffer.from("parallel body"), "p.txt");
  const [a, b] = await Promise.all([send(), send()]);
  assert.equal(counts.analyze, before + 1);
  assert.equal(a.body.docId, b.body.docId);
});
test("same question (case/space differences) -> one call; concurrent -> one call", async () => {
  const up = await request(app).post("/api/upload").attach("file", Buffer.from("ask body"), "q.txt");
  const before = counts.ask;
  const ask = (q) => request(app).post("/api/ask").send({ docId: up.body.docId, question: q, history: [] });
  await Promise.all([ask("Who is it?"), ask("Who is it?")]);
  const r = await ask("  who   is IT? ");
  assert.equal(counts.ask, before + 1);
  assert.equal(r.body.cached, true);
});
test("failed call is not cached; next click calls again", async () => {
  let n = 0;
  const flaky = createApp({ claude: { ...fakeClaude, askQuestion: async () => { if (n++ === 0) throw new Error("boom"); return "ok"; } } });
  const up = await request(flaky).post("/api/upload").attach("file", Buffer.from("flaky body"), "f.txt");
  const ask = () => request(flaky).post("/api/ask").send({ docId: up.body.docId, question: "q" });
  assert.equal((await ask()).status, 500);
  assert.deepEqual((await ask()).body, { answer: "ok", cached: false });
  assert.equal(n, 2);
});
```

Original route tests:

```js
test("upload txt (uppercase ext) returns analysis and saves files", async () => {
  const r = await request(app).post("/api/upload").attach("file", Buffer.from("hello"), "Notes.TXT");
  assert.equal(r.status, 200);
  assert.match(r.body.docId, /^\d+-notes\.txt$/);
  assert.equal(r.body.analysis.summary, "S");
  assert.ok(fs.existsSync(path.join(dir, r.body.docId + ".txt")));
});
test("upload rejects unsupported type with 422", async () => {
  const r = await request(app).post("/api/upload").attach("file", Buffer.from("x"), "a.exe");
  assert.equal(r.status, 422); assert.match(r.body.error, /Only PDF, DOCX and TXT/);
});
test("upload over 10 MB -> 413", async () => {
  const r = await request(app).post("/api/upload").attach("file", Buffer.alloc(10 * 1024 * 1024 + 1, 97), "big.txt");
  assert.equal(r.status, 413);
});
test("ask rejects traversal docId", async () => {
  const r = await request(app).post("/api/ask").send({ docId: "../server/.env", question: "q" });
  assert.equal(r.status, 400);
});
test("ask unknown doc -> 404, empty question -> 400, valid -> answer", async () => {
  assert.equal((await request(app).post("/api/ask").send({ docId: "1-missing.txt", question: "q" })).status, 404);
  const up = await request(app).post("/api/upload").attach("file", Buffer.from("hello"), "a.txt");
  assert.equal((await request(app).post("/api/ask").send({ docId: up.body.docId, question: "  " })).status, 400);
  const r = await request(app).post("/api/ask").send({ docId: up.body.docId, question: "q" });
  assert.deepEqual(r.body, { answer: "ans:q", cached: false });
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `server/app.js` and `server/server.js`** per Interfaces.
- [ ] **Step 4: Run** `npm test` — Expected: all server tests PASS.
- [ ] **Step 5: Checkpoint** — `feat(content-analysis): upload and ask routes`

---

### Task 5: React client

**Files:**
- Create via `npm create vite@latest client -- --template react` (in `content-analysis/`), then remove the demo content/assets.
- Modify: `client/vite.config.js` — `server: { port: 5173, proxy: { "/api": "http://localhost:5050" } }`
- Create: `client/src/api.js`, `client/src/components/UploadForm.jsx`, `client/src/components/AnalysisPanel.jsx`, `client/src/components/ChatPanel.jsx`
- Modify: `client/src/App.jsx`, `client/src/App.css`, `client/index.html` (title `Content Analysis`)

**Interfaces:**
- Consumes: the HTTP routes from Task 4.
- Produces (`client/src/api.js`):
  - `uploadDocument(file: File): Promise<{ docId, fileName, analysis }>` — `FormData` field `file`, `POST /api/upload`.
  - `askQuestion(docId: string, question: string, history: {role, content}[]): Promise<string>` — `POST /api/ask`, returns `answer`.
  - Both throw `Error(body.error || "Request failed")` on non-2xx. No retry logic of any kind.
- **Duplicate-call guard:** API functions are called only from click/submit handlers, never from `useEffect` (React StrictMode runs effects twice in dev). Each handler checks a `useRef` in-flight flag first and returns immediately if set (state-based `disabled` alone can let a fast double-click through before re-render); the flag is cleared in `finally`.
- Components:
  - `UploadForm({ onUploaded, busy, setBusy })` — `<input type="file" accept=".pdf,.docx,.txt">` + Upload button; button disabled while `busy` or no file chosen; shows "Analysing document…" while busy.
  - `AnalysisPanel({ fileName, analysis })` — file name, Summary paragraph, "Key topics" list, "People" list (each list hidden when empty).
  - `ChatPanel({ docId })` — owns `messages` state (`{role, content}[]`); input + Ask button, disabled while waiting or input blank; Enter submits; on send appends user message, calls `askQuestion(docId, q, messages)`, appends assistant answer; on error shows the message inline in red. Reset when `docId` changes (`key={docId}` from App).
- `App` — state: `doc` (`{docId,fileName,analysis}` | null), `busy`, `error`. Uploading a new file replaces `doc` (which remounts ChatPanel and clears chat). Layout per spec sketch, single column, max-width ~760px, readable on mobile.

- [ ] **Step 1: Scaffold and configure** — run the Vite create command, `cd client && npm install`, set proxy and title.
- [ ] **Step 2: Implement** `api.js`, the three components, `App.jsx`, `App.css` per Interfaces.
- [ ] **Step 3: Verify build** — `cd client && npm run build` — Expected: completes with no errors.
- [ ] **Step 4: Checkpoint** — `feat(content-analysis): react single page client`

---

### Task 6: README and end-to-end run (needs the user's API key)

**Files:**
- Create: `content-analysis/README.md` — setup (`cp server/.env.example server/.env`, add key), run (`cd server && npm run dev`, `cd client && npm run dev`, open http://localhost:5173), limits (10 MB, PDF/DOCX/TXT, no scanned PDFs), where files go (`uploads/`).

- [ ] **Step 1: Write README.**
- [ ] **Step 2: Ask the user to create `server/.env` with their key** (do not read it). Wait for confirmation.
- [ ] **Step 3: Start both servers** in the background.
- [ ] **Step 4: Drive the app in a browser** (browser-automation skill): upload one small real TXT, DOCX and PDF; for each confirm summary/topics/people render and a question gets an answer; ask one question not covered by the document and confirm Claude says it isn't in the document. Confirm Upload/Ask buttons are disabled while a request is pending. Check the server log shows `cache_read_input_tokens > 0` on the second question.
- [ ] **Step 4b: Count paid calls** — reload the page: zero new `[claude] call` lines. Double-click Ask: one line. Re-upload the same file and re-ask the same question: zero new lines, responses show `cached: true`.
- [ ] **Step 5: Confirm** originals and `.txt` files are in `content-analysis/uploads/`.
- [ ] **Step 6: Checkpoint** — `docs(content-analysis): readme and verified end-to-end run`
