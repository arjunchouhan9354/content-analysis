const express = require("express");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const { UserError } = require("./errors");
const { extractText } = require("./extract");
const store = require("./docStore");

const MAX_BYTES = 10 * 1024 * 1024;

// A failed cache write must not lose a result that was already paid for.
async function safeWriteCache(key, value) {
  try {
    await store.writeCache(key, value);
  } catch (err) {
    console.error("[cache] write failed:", err.message);
  }
}

// A cached upload is only usable if its extracted text still exists on disk.
async function readUploadCache(key) {
  const hit = await store.readCache(key);
  if (!hit || (await store.loadText(hit.docId)) === null) return null;
  return hit;
}

// Identical requests in flight share one promise, so they make one Claude call.
const pending = new Map();
function dedupe(key, fn) {
  if (pending.has(key)) return pending.get(key);
  const p = Promise.resolve()
    .then(fn)
    .finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

function createApp({ claude }) {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

  app.use(express.json({ limit: "2mb" }));

  app.post("/api/upload", upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) throw new UserError("Please choose a file to upload.", 400);
      // multer decodes the filename as latin1; restore UTF-8 names (e.g. Hindi).
      const fileName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
      const key = store.cacheKey("analysis", store.hashBuffer(req.file.buffer));

      const cached = await readUploadCache(key);
      if (cached) return res.json({ ...cached, fileName, cached: true });

      let fresh = false;
      const result = await dedupe(key, async () => {
        const again = await readUploadCache(key);
        if (again) return again;
        fresh = true;
        const text = await extractText(req.file.buffer, fileName);
        const { docId } = await store.saveUpload(req.file.buffer, fileName);
        await store.saveText(docId, text);
        const analysis = await claude.analyzeDocument(text);
        const value = { docId, fileName, analysis };
        await safeWriteCache(key, value);
        return value;
      });
      res.json({ ...result, fileName, cached: !fresh });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/ask", async (req, res, next) => {
    try {
      const { docId, question } = req.body || {};
      const history = Array.isArray(req.body?.history) ? req.body.history : [];
      if (!store.isValidDocId(docId)) throw new UserError("Invalid document id.", 400);
      if (typeof question !== "string" || !question.trim()) throw new UserError("Please type a question.", 400);
      const text = await store.loadText(docId);
      if (text === null) throw new UserError("Document not found. Please upload it again.", 404);

      const normalized = question.trim().replace(/\s+/g, " ").toLowerCase();
      const key = store.cacheKey("ask", docId, normalized, history);
      const cached = await store.readCache(key);
      if (cached) return res.json({ answer: cached.answer, cached: true });

      let fresh = false;
      const result = await dedupe(key, async () => {
        const again = await store.readCache(key);
        if (again) return again;
        fresh = true;
        const answer = await claude.askQuestion(text, question.trim(), history);
        const value = { answer };
        await safeWriteCache(key, value);
        return value;
      });
      res.json({ answer: result.answer, cached: !fresh });
    } catch (err) {
      next(err);
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof UserError) return res.status(err.status).json({ error: err.message });
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE")
      return res.status(413).json({ error: "File is larger than 10 MB." });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: "Upload failed. Use the file field." });
    if (err instanceof Anthropic.AuthenticationError)
      return res.status(502).json({ error: "Claude rejected the API key. Check server/.env." });
    if (err instanceof Anthropic.RateLimitError)
      return res.status(429).json({ error: "Claude is busy, try again in a minute." });
    if (err instanceof Anthropic.APIError) {
      console.error("[claude] API error", err.status, err.message);
      return res.status(502).json({ error: "Claude request failed. Try again." });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  });

  return app;
}

module.exports = { createApp };
