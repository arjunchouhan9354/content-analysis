const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { createApp } = require("./app");
const { createClaude } = require("./claude");

if (!process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY is not set — add it to server/.env");

const port = Number(process.env.PORT) || 5050;
createApp({ claude: createClaude() }).listen(port, () => {
  console.log(`Content analysis server on http://localhost:${port}`);
});
