const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const DOC_ID_RE = /^\d+-[a-z0-9.-]+\.(pdf|docx|txt)$/;
const CACHE_KEY_RE = /^[a-f0-9]{64}$/;

function getUploadDir() {
  const dir = process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeName(originalName) {
  const lower = String(originalName || "").toLowerCase();
  const ext = path.extname(lower);
  const stem = lower
    .slice(0, lower.length - ext.length)
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/\.{2,}/g, ".") // ".." would make the docId fail isValidDocId
    .replace(/^[-.]+|[-.]+$/g, "");
  const safeExt = ext.replace(/[^a-z0-9.]/g, "");
  return (stem || "document") + safeExt;
}

function makeDocId(originalName) {
  return `${Date.now()}-${safeName(originalName)}`;
}

function isValidDocId(id) {
  return typeof id === "string" && DOC_ID_RE.test(id) && !id.includes("..");
}

async function saveUpload(buffer, originalName) {
  const docId = makeDocId(originalName);
  const filePath = path.join(getUploadDir(), docId);
  await fsp.writeFile(filePath, buffer);
  return { docId, filePath };
}

async function saveText(docId, text) {
  await fsp.writeFile(path.join(getUploadDir(), `${docId}.txt`), text, "utf8");
}

async function loadText(docId) {
  if (!isValidDocId(docId)) return null;
  try {
    return await fsp.readFile(path.join(getUploadDir(), `${docId}.txt`), "utf8");
  } catch {
    return null;
  }
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function cacheKey(...parts) {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function cacheDir() {
  const dir = path.join(getUploadDir(), ".cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function readCache(key) {
  if (typeof key !== "string" || !CACHE_KEY_RE.test(key)) return null;
  try {
    return JSON.parse(await fsp.readFile(path.join(cacheDir(), `${key}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function writeCache(key, value) {
  if (typeof key !== "string" || !CACHE_KEY_RE.test(key)) throw new Error("Invalid cache key");
  await fsp.writeFile(path.join(cacheDir(), `${key}.json`), JSON.stringify(value), "utf8");
}

module.exports = {
  getUploadDir, safeName, makeDocId, isValidDocId, saveUpload, saveText, loadText,
  hashBuffer, cacheKey, readCache, writeCache,
};
