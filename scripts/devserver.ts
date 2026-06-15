/**
 * Local dev server — runs the same Express app as the Netlify function on a
 * plain HTTP port, for testing without the Netlify CLI.
 *
 *   npm run serve   # then hit http://localhost:8910/mcp
 */

import { createApp } from "../src/server/app.js";

const port = Number(process.env.PORT ?? 8910);
createApp().listen(port, () => console.log(`MCP dev server on http://localhost:${port}/mcp`));
