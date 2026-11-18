const test = require("node:test");
const assert = require("node:assert/strict");
const { extractText } = require("../extract");

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

test("pdf: extracts text from a real PDF", async () => {
  const buf = require("fs").readFileSync(require("path").join(__dirname, "fixtures", "sample.pdf"));
  assert.match(await extractText(buf, "s.PDF"), /Ravi Kumar runs a small bakery/);
});

test("pdf: broken file -> UserError", async () => {
  await assert.rejects(extractText(Buffer.from("not a pdf"), "b.pdf"), { name: "UserError", message: /Could not read this PDF/ });
});

test("docx: extracts text from a real DOCX", async () => {
  const JSZip = require("jszip");
  const z = new JSZip();
  z.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello from DOCX</w:t></w:r></w:p></w:body></w:document>');
  assert.equal(await extractText(await z.generateAsync({ type: "nodebuffer" }), "a.docx"), "Hello from DOCX");
});
