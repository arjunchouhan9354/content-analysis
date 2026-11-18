const test = require("node:test");
const assert = require("node:assert/strict");
const { createClaude } = require("../claude");

const calls = [];
let next;
const fake = { messages: { create: async (req) => { calls.push(req); return next; } } };
const claude = createClaude({ client: fake, model: "claude-sonnet-5-5" });

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
  assert.deepEqual(req.messages.map((m) => m.content), ["q1", "a1", "q2"]);
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

test("review fix: max_tokens cut-off -> UserError (not cached upstream)", async () => {
  next = { stop_reason: "max_tokens", usage: {}, content: [{ type: "text", text: "partial" }] };
  await assert.rejects(claude.askQuestion("DOC", "q", []), { name: "UserError", message: /cut off/ });
});

test("review fix: unreadable analysis JSON -> UserError", async () => {
  next = { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "not json" }] };
  await assert.rejects(claude.analyzeDocument("DOC"), { name: "UserError", message: /unreadable/ });
});

test("workspace id env adds anthropic-workspace-id header; absent -> no header", () => {
  const { clientOptions } = require("../claude");
  assert.deepEqual(clientOptions({ ANTHROPIC_WORKSPACE_ID: " wrkspc_123 " }), {
    maxRetries: 0,
    defaultHeaders: { "anthropic-workspace-id": "wrkspc_123" },
  });
  assert.deepEqual(clientOptions({}), { maxRetries: 0 });
});
