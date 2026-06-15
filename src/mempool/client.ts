/**
 * Thin, read-only client over the mempool.space public REST API.
 *
 * It is intentionally provider-specific but kept isolated behind small,
 * domain-shaped return types so a self-hosted full node could replace it later
 * without changing the MCP tool layer.
 *
 * Docs: https://mempool.space/docs/api/rest
 */

const DEFAULT_BASE_URL = "https://mempool.space";
const DEFAULT_TIMEOUT_MS = 8_000;

/** A recent block, trimmed to the fields agents care about. */
export interface LatestBlock {
  height: number;
  hash: string;
  timestamp: number;
  txCount: number;
  miner: string | null;
}

/** Detailed metadata for a single block. */
export interface BlockDetail {
  height: number;
  hash: string;
  timestamp: number;
  txCount: number;
  size: number;
  weight: number;
  miner: string | null;
  version: number;
  merkleRoot: string;
  previousBlockHash: string | null;
  nonce: number;
  bits: number;
  difficulty: number;
}

/** One of the next projected blocks the mempool would produce. */
export interface ProjectedBlock {
  blockVSize: number;
  nTx: number;
  medianFee: number;
  feeRange: number[];
  totalFees: number;
}

/** A snapshot of the current mempool. */
export interface MempoolStatus {
  txCount: number;
  /** Total virtual size (pending vbytes) of the mempool. */
  vsize: number;
  totalFee: number;
  projectedBlocks: ProjectedBlock[];
}

/** Recommended fee rates in sat/vB. */
export interface FeeEstimates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

export interface MempoolClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable fetch, primarily for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Raised when the upstream API returns an error or is unreachable. */
export class MempoolApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MempoolApiError";
  }
}

export class MempoolClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MempoolClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Most recent blocks (mempool.space returns ~15), trimmed to `limit`. */
  async getLatestBlocks(limit = 10): Promise<LatestBlock[]> {
    const blocks = await this.getJson<RawBlock[]>("/api/v1/blocks");
    return blocks.slice(0, Math.max(1, limit)).map(toLatestBlock);
  }

  /** Detailed metadata for a block identified by height or hash. */
  async getBlockDetail(ref: { height?: number; hash?: string }): Promise<BlockDetail> {
    let hash = ref.hash;
    if (!hash) {
      if (ref.height === undefined) {
        throw new MempoolApiError("either a block height or hash is required");
      }
      hash = await this.getText(`/api/block-height/${ref.height}`);
    }
    const block = await this.getJson<RawBlock>(`/api/v1/block/${hash}`);
    return toBlockDetail(block);
  }

  /** Current mempool snapshot plus the next projected blocks. */
  async getMempoolStatus(): Promise<MempoolStatus> {
    const [mempool, projected] = await Promise.all([
      this.getJson<RawMempool>("/api/mempool"),
      this.getJson<RawProjectedBlock[]>("/api/v1/fees/mempool-blocks"),
    ]);
    return {
      txCount: mempool.count,
      vsize: mempool.vsize,
      totalFee: mempool.total_fee,
      projectedBlocks: projected.map((b) => ({
        blockVSize: b.blockVSize,
        nTx: b.nTx,
        medianFee: b.medianFee,
        feeRange: b.feeRange,
        totalFees: b.totalFees,
      })),
    };
  }

  /** Recommended fee rates in sat/vB. */
  async getFeeEstimates(): Promise<FeeEstimates> {
    return this.getJson<FeeEstimates>("/api/v1/fees/recommended");
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.request(path);
    return (await res.json()) as T;
  }

  private async getText(path: string): Promise<string> {
    const res = await this.request(path);
    return (await res.text()).trim();
  }

  private async request(path: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.baseUrl + path, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "orange-standard-mcp/0.1 (+https://github.com/jaducku/orange-standard)",
        },
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 200);
        throw new MempoolApiError(
          `mempool.space GET ${path} failed: ${res.status} ${res.statusText} ${body}`.trim(),
          res.status,
        );
      }
      return res;
    } catch (err) {
      if (err instanceof MempoolApiError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new MempoolApiError(`mempool.space GET ${path} timed out after ${this.timeoutMs}ms`);
      }
      throw new MempoolApiError(
        `mempool.space GET ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

// --- Upstream payload shapes (snake_case as returned by mempool.space) -------

interface RawBlock {
  id: string;
  height: number;
  version: number;
  timestamp: number;
  tx_count: number;
  size: number;
  weight: number;
  merkle_root: string;
  previousblockhash: string | null;
  nonce: number;
  bits: number;
  difficulty: number;
  extras?: { pool?: { name?: string } };
}

interface RawMempool {
  count: number;
  vsize: number;
  total_fee: number;
}

interface RawProjectedBlock {
  blockVSize: number;
  nTx: number;
  medianFee: number;
  feeRange: number[];
  totalFees: number;
}

function toLatestBlock(b: RawBlock): LatestBlock {
  return {
    height: b.height,
    hash: b.id,
    timestamp: b.timestamp,
    txCount: b.tx_count,
    miner: b.extras?.pool?.name ?? null,
  };
}

function toBlockDetail(b: RawBlock): BlockDetail {
  return {
    height: b.height,
    hash: b.id,
    timestamp: b.timestamp,
    txCount: b.tx_count,
    size: b.size,
    weight: b.weight,
    miner: b.extras?.pool?.name ?? null,
    version: b.version,
    merkleRoot: b.merkle_root,
    previousBlockHash: b.previousblockhash,
    nonce: b.nonce,
    bits: b.bits,
    difficulty: b.difficulty,
  };
}
