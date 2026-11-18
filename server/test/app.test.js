const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ca-app-"));
process.env.UPLOAD_DIR = dir;
const request = require("supertest");
const { createApp } = require("../app");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const counts = { analyze: 0, ask: 0 };
const fakeClaude = {
  analyzeDocument: async () => { counts.analyze++; await delay(50); return { summary: "S", topics: [], people: [] }; },
  askQuestion: async (t, q) => { counts.ask++; await delay(50); return "ans:" + q; },
};
const app = createApp({ claude: fakeClaude });

test("upload txt (uppercase ext) returns analysis and saves files", async () => {
  const r = await request(app).post("/api/upload").attach("file", Buffer.from("hello"), "Notes.TXT");
  assert.equal(r.status, 200);
  assert.match(r.body.docId, /^\d+-notes\.txt$/);
  assert.equal(r.body.analysis.summary, "S");
  assert.equal(r.body.cached, false);
  assert.ok(fs.existsSync(path.join(dir, r.body.docId + ".txt")));
});

test("upload with no file -> 400", async () => {
  const r = await request(app).post("/api/upload");
  assert.equal(r.status, 400);
});

test("upload rejects unsupported type with 422", async () => {
  const r = await request(app).post("/api/upload").attach("file", Buffer.from("x"), "a.exe");
  assert.equal(r.status, 422);
  assert.match(r.body.error, /Only PDF, DOCX and TXT/);
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
  const up = await request(app).post("/api/upload").attach("file", Buffer.from("hello there"), "a.txt");
  assert.equal((await request(app).post("/api/ask").send({ docId: up.body.docId, question: "  " })).status, 400);
  const r = await request(app).post("/api/ask").send({ docId: up.body.docId, question: "q" });
  assert.deepEqual(r.body, { answer: "ans:q", cached: false });
});

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

test("review fix: cache write failure still returns the paid answer", async () => {
  const store = require("../docStore");
  const up = await request(app).post("/api/upload").attach("file", Buffer.from("write fail body"), "w.txt");
  const orig = store.writeCache;
  store.writeCache = async () => { throw new Error("disk full"); };
  try {
    const r = await request(app).post("/api/ask").send({ docId: up.body.docId, question: "write fail q" });
    assert.equal(r.status, 200);
    assert.equal(r.body.answer, "ans:write fail q");
  } finally {
    store.writeCache = orig;
  }
});

test("review fix: cache hit whose text was deleted is treated as a miss; current fileName returned", async () => {
  const before = counts.analyze;
  const a = await request(app).post("/api/upload").attach("file", Buffer.from("deleted text body"), "first.txt");
  fs.unlinkSync(path.join(dir, a.body.docId + ".txt"));
  const b = await request(app).post("/api/upload").attach("file", Buffer.from("deleted text body"), "second.txt");
  assert.equal(counts.analyze, before + 2);
  assert.notEqual(b.body.docId, a.body.docId);
  const c = await request(app).post("/api/upload").attach("file", Buffer.from("deleted text body"), "third.txt");
  assert.equal(c.body.cached, true);
  assert.equal(c.body.fileName, "third.txt");
});
