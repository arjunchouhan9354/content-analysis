const Anthropic = require("@anthropic-ai/sdk");
const { UserError } = require("./errors");

const INSTRUCTIONS =
  "You are a careful document analyst. Answer only from the document provided. If the document does not contain the answer, say so plainly and do not guess. " +
  "Write answers as plain text without markdown (no **bold**, # headings or tables); the app shows text as-is. Use simple numbered lines for lists.";

const ANALYSIS_PROMPT =
  "Analyse this document. Give a 3-5 sentence summary, up to 8 key topics, and up to 10 main people or characters (empty list if none).";

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    topics: { type: "array", items: { type: "string" } },
    people: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "topics", "people"],
  additionalProperties: false,
};

function buildSystem(text) {
  return [
    { type: "text", text: INSTRUCTIONS },
    { type: "text", text: `<document>\n${text}\n</document>`, cache_control: { type: "ephemeral" } },
  ];
}

function textOf(response) {
  return response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

// maxRetries: 0 — never re-send a paid request automatically.
// ANTHROPIC_WORKSPACE_ID is needed only when the API key isn't scoped to a workspace.
function clientOptions(env = process.env) {
  const opts = { maxRetries: 0 };
  const workspaceId = (env.ANTHROPIC_WORKSPACE_ID || "").trim();
  if (workspaceId) opts.defaultHeaders = { "anthropic-workspace-id": workspaceId };
  return opts;
}

function createClaude({ client, model } = {}) {
  const useModel = model || process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
  let api = client;

  function getClient() {
    if (api) return api;
    if (!process.env.ANTHROPIC_API_KEY) throw new UserError("ANTHROPIC_API_KEY is not set in server/.env", 500);
    api = new Anthropic(clientOptions());
    return api;
  }

  // Exactly one Claude call per invocation. No loops, no retries, no fallbacks.
  async function call(kind, params) {
    const c = getClient();
    console.log(`[claude] call ${kind}`);
    const response = await c.messages.create({ model: useModel, max_tokens: 16000, ...params });
    const u = response.usage || {};
    console.log(
      `[claude] ${kind} usage input=${u.input_tokens} cache_read=${u.cache_read_input_tokens} output=${u.output_tokens}`
    );
    if (response.stop_reason === "refusal") throw new UserError("Claude declined to process this request.", 422);
    // Thrown, so a truncated result is never cached.
    if (response.stop_reason === "max_tokens")
      throw new UserError("Claude's answer was cut off. Try a shorter question or document.", 502);
    return response;
  }

  async function analyzeDocument(text) {
    const response = await call("analyze", {
      system: buildSystem(text),
      output_config: { effort: "medium", format: { type: "json_schema", schema: ANALYSIS_SCHEMA } },
      messages: [{ role: "user", content: ANALYSIS_PROMPT }],
    });
    let parsed;
    try {
      parsed = JSON.parse(textOf(response));
    } catch {
      parsed = null;
    }
    // Thrown, so a blank analysis is never cached against the file's hash.
    if (!parsed || typeof parsed.summary !== "string" || !parsed.summary.trim())
      throw new UserError("Claude returned an unreadable analysis. Please upload again.", 502);
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      topics: stringList(parsed.topics),
      people: stringList(parsed.people),
    };
  }

  async function askQuestion(text, question, history) {
    const past = (Array.isArray(history) ? history : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));
    const response = await call("ask", {
      system: buildSystem(text),
      output_config: { effort: "low" },
      messages: [...past, { role: "user", content: question }],
    });
    return textOf(response);
  }

  return { analyzeDocument, askQuestion };
}

module.exports = { createClaude, buildSystem, clientOptions, INSTRUCTIONS };
