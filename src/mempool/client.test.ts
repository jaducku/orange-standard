import assert from "node:assert/strict";
import { test } from "node:test";
import { MempoolApiError, MempoolClient } from "./client.js";

/** Builds a fetch stub that maps URL paths to canned responses. */
function stubFetch(routes: Record<string, { body: string; status?: number }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    return new Response(route.body, {
      status: route.status ?? 200,
      statusText: "OK",
    });
  }) as typeof fetch;
}

test("getLatestBlocks maps fields and respects limit", async () => {
  const fetchImpl = stubFetch({
    "/api/v1/blocks": {
      body: JSON.stringify([
        { id: "hashA", height: 800002, timestamp: 100, tx_count: 3, extras: { pool: { name: "Foundry" } } },
        { id: "hashB", height: 800001, timestamp: 90, tx_count: 2, extras: { pool: { name: "AntPool" } } },
        { id: "hashC", height: 800000, timestamp: 80, tx_count: 1 },
      ]),
    },
  });
  const client = new MempoolClient({ fetchImpl });

  const blocks = await client.getLatestBlocks(2);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], {
    height: 800002,
    hash: "hashA",
    timestamp: 100,
    txCount: 3,
    miner: "Foundry",
  });
  // Missing pool extras should surface as null, not throw.
  const all = await client.getLatestBlocks(3);
  assert.equal(all[2]?.miner, null);
});

test("getBlockDetail resolves height to hash then fetches detail", async () => {
  const fetchImpl = stubFetch({
    "/api/block-height/800000": { body: "hashC" },
    "/api/v1/block/hashC": {
      body: JSON.stringify({
        id: "hashC",
        height: 800000,
        version: 1,
        timestamp: 80,
        tx_count: 1,
        size: 1000,
        weight: 4000,
        merkle_root: "mroot",
        previousblockhash: "hashB",
        nonce: 42,
        bits: 386,
        difficulty: 123.4,
        extras: { pool: { name: "AntPool" } },
      }),
    },
  });
  const client = new MempoolClient({ fetchImpl });

  const detail = await client.getBlockDetail({ height: 800000 });
  assert.equal(detail.hash, "hashC");
  assert.equal(detail.miner, "AntPool");
  assert.equal(detail.size, 1000);
  assert.equal(detail.previousBlockHash, "hashB");
});

test("getMempoolStatus combines mempool and projected blocks", async () => {
  const fetchImpl = stubFetch({
    "/api/mempool": { body: JSON.stringify({ count: 12345, vsize: 6789, total_fee: 999 }) },
    "/api/v1/fees/mempool-blocks": {
      body: JSON.stringify([
        { blockVSize: 999000, nTx: 2500, medianFee: 15, feeRange: [1, 50], totalFees: 1234 },
      ]),
    },
  });
  const client = new MempoolClient({ fetchImpl });

  const status = await client.getMempoolStatus();
  assert.equal(status.txCount, 12345);
  assert.equal(status.vsize, 6789);
  assert.equal(status.projectedBlocks.length, 1);
  assert.equal(status.projectedBlocks[0]?.medianFee, 15);
});

test("non-200 responses raise MempoolApiError with status", async () => {
  const fetchImpl = stubFetch({
    "/api/v1/fees/recommended": { body: "rate limited", status: 429 },
  });
  const client = new MempoolClient({ fetchImpl });

  await assert.rejects(
    () => client.getFeeEstimates(),
    (err: unknown) => err instanceof MempoolApiError && err.status === 429,
  );
});
