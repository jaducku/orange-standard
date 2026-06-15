# orange-standard

A **headless Bitcoin network service** — think of it as the backend of a
mempool explorer without any UI. It exposes Bitcoin *network* data (fees,
mempool state, chain tip) over a clean JSON API. It is **not** a trading,
wallet, or investment tool.

> Status: early scaffold. The first iteration wraps the
> [mempool.space](https://mempool.space/docs/api/rest) public API behind a small
> caching layer. A self-hosted full node can be plugged in later **without
> changing the API layer**, thanks to the `DataSource` abstraction.

## Why this shape?

A home full node is a precious, limited resource. If every API request hit
`bitcoind` directly it would become a bottleneck. So the design treats the data
provider as a swappable *source*, fronted by a cache:

```
        DataSource (interface)
        ├── mempoolspace.Client   ← today: wraps mempool.space
        └── (future) bitcoind     ← later: your own node + indexer
                    │
              cache.Caching       ← per-method TTL cache, collapses bursts
                    │
                 api.Server       ← read-only JSON HTTP API
```

When you wire in your own node later, you implement the `DataSource` interface
once; the cache and API layers stay untouched.

## Layout

```
cmd/orange-standard/        service entrypoint (config, wiring, graceful shutdown)
internal/datasource/        DataSource interface + domain types
internal/datasource/mempoolspace/  mempool.space API client
internal/cache/             TTL caching decorator over a DataSource
internal/api/               HTTP server, routes, handlers
internal/config/            env-based configuration
```

## Run

```sh
make run        # or: go run ./cmd/orange-standard
```

The server listens on `:8080` by default.

## API

| Method | Path                          | Description                          |
| ------ | ----------------------------- | ------------------------------------ |
| GET    | `/healthz`                    | Liveness + active provider           |
| GET    | `/api/v1/fees/recommended`    | Recommended fee rates (sat/vB)       |
| GET    | `/api/v1/mempool`             | Mempool snapshot (count, vsize, fees)|
| GET    | `/api/v1/chain/tip`           | Best block height + hash             |

Example:

```sh
curl -s localhost:8080/api/v1/fees/recommended
# {"fastestFee":30,"halfHourFee":20,"hourFee":10,"economyFee":5,"minimumFee":1}
```

## Configuration

| Env var                   | Default                  | Description                      |
| ------------------------- | ------------------------ | -------------------------------- |
| `ORANGE_HTTP_ADDR`        | `:8080`                  | API listen address              |
| `ORANGE_MEMPOOL_BASE_URL` | `https://mempool.space`  | mempool.space API root          |
| `ORANGE_REQUEST_TIMEOUT`  | `10s`                    | Upstream HTTP request timeout   |

## Develop

```sh
make test       # run tests (no network required)
make vet        # static checks
make build      # build bin/orange-standard
```

## Roadmap

- [ ] WebSocket push for new blocks / mempool updates
- [ ] `bitcoind` DataSource (RPC + ZMQ) to use your own node
- [ ] Optional address/tx indexing via electrs/Fulcrum
- [ ] Persistent history store
```
