# orange-standard

A **headless Bitcoin Mempool MCP server** for AI agents. It exposes real-time
Bitcoin *network* state (latest blocks, block details, mempool congestion,
recommended fees) over the [Model Context Protocol](https://modelcontextprotocol.io),
so an agent can answer questions like *"what's the current block height?"* or
*"what's a good fee right now?"* in natural language — no browser, no UI.

It is **not** a wallet, trading, or portfolio tool. Data comes from the
[mempool.space](https://mempool.space/docs/api/rest) public API.

> Status: MVP. Deployed as a stateless Streamable-HTTP MCP server on Netlify
> Functions.

## Architecture

```
AI Agent ──> MCP Client ──> Netlify Function (/mcp) ──> mempool.space REST API
                              stateless Streamable HTTP
```

- **Stateless**: a fresh MCP server + transport is built per request, so
  concurrent serverless invocations stay isolated (no shared sessions).
- **Swappable source**: all upstream access is isolated in `MempoolClient`, so a
  self-hosted full node could replace mempool.space later without touching the
  tool layer.

## Tools

| Tool                 | Input                       | Returns                                                |
| -------------------- | --------------------------- | ------------------------------------------------------ |
| `get_latest_blocks`  | `limit?` (1–15, default 10) | Recent blocks: height, hash, timestamp, tx count, miner|
| `get_block_detail`   | `height` **or** `hash`      | Block metadata: size, weight, miner, merkle root, …    |
| `get_mempool_status` | —                           | Pending tx count, vsize, total fee, projected blocks   |
| `get_fee_estimates`  | —                           | Recommended fee rates (sat/vB)                         |

## Layout

```
netlify/functions/mcp.ts   Netlify entrypoint: Express + Streamable HTTP transport at /mcp
src/mcp/server.ts          setupMCPServer(): registers the four tools
src/mempool/client.ts      typed, read-only mempool.space API client
public/index.html          static landing page
netlify.toml               build config + /mcp redirect
```

## Develop

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # unit + in-memory MCP integration tests (no network)
npm run dev         # netlify dev — serves the function locally at /mcp
```

### Try it locally

With `netlify dev` running (default `http://localhost:8888`):

```sh
npx @modelcontextprotocol/inspector
# then point it at http://localhost:8888/mcp  (Streamable HTTP)
```

## Deploy (Netlify)

1. Connect this repo to a Netlify site (or `netlify deploy`).
2. The function is published at `/.netlify/functions/mcp` and exposed at `/mcp`
   via the redirect in `netlify.toml`.
3. Point any MCP client at `https://<your-site>.netlify.app/mcp`.

Runs comfortably within the Netlify Free Tier — it's stateless and only proxies
small JSON reads.

## Non-functional notes

- Upstream requests time out at 8s and surface clear `MempoolApiError`s, which
  become MCP tool errors (`isError: true`) rather than crashing the function.
- No persistent state, no secrets required.

## Roadmap

- [ ] `get_block_detail` by recent block range / pagination
- [ ] Self-hosted `bitcoind` (RPC + ZMQ) data source behind the same tools
- [ ] Optional caching layer to shield upstream under load
