const path = require("path");
const { UserError } = require("./errors");

const MAX_CHARS = 600000;

async function extractText(buffer, originalName) {
  const ext = path.extname(String(originalName || "")).toLowerCase();
  let text;
  if (ext === ".txt") {
    text = buffer.toString("utf8").replace(/^﻿/, "");
  } else if (ext === ".pdf") {
    const { PDFParse } = require("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      text = (await parser.getText()).text;
    } catch {
      throw new UserError("Could not read this PDF. It may be damaged or password-protected.");
    } finally {
      await parser.destroy().catch(() => {});
    }
  } else if (ext === ".docx") {
    const mammoth = require("mammoth");
    try {
      text = (await mammoth.extractRawText({ buffer })).value;
    } catch {
      throw new UserError("Could not read this DOCX file. It may be damaged.");
    }
  } else {
    throw new UserError("Only PDF, DOCX and TXT files are supported.");
  }

  text = (text || "").trim();
  if (!text) throw new UserError("No readable text found in this file. Scanned PDFs aren't supported.");
  if (text.length > MAX_CHARS)
    throw new UserError("This document is too long (over 600,000 characters). Please upload a shorter one.");
  return text;
}

module.exports = { extractText, MAX_CHARS };
