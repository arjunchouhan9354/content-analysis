const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ca-store-"));
const {
  safeName, makeDocId, isValidDocId, saveUpload, saveText, loadText,
  hashBuffer, cacheKey, readCache, writeCache,
} = require("../docStore");

test("safeName handles spaces, unicode, uppercase ext", () => {
  assert.equal(safeName("My Report.PDF"), "my-report.pdf");
  assert.equal(safeName("कहानी भाग 1.txt"), "1.txt");
  assert.equal(safeName("मेरी.docx"), "document.docx");
});

test("isValidDocId accepts generated ids and rejects traversal", () => {
  assert.ok(isValidDocId(makeDocId("a b.pdf")));
  for (const bad of ["../server/.env", "123-..pdf", "123-a.exe", "", null, "123-a/b.txt"])
    assert.equal(isValidDocId(bad), false, String(bad));
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

test("review fix: dotted names produce an askable docId", () => {
  assert.equal(safeName("Ch.1..Intro.pdf"), "ch.1.intro.pdf");
  assert.ok(isValidDocId(makeDocId("Ch.1..Intro.pdf")));
  assert.ok(isValidDocId(makeDocId("a...b..txt")));
});
