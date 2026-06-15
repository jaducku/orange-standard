// Package datasource defines the abstraction over a source of Bitcoin network
// data. Today the only implementation is a thin client over the mempool.space
// public API (see package mempoolspace), but the interface is intentionally
// kept small and provider-agnostic so that a self-hosted full node + indexer
// can be plugged in later without touching the API layer.
package datasource

import (
	"context"
	"errors"
)

// ErrNotFound is returned when a requested resource (e.g. a block or
// transaction) does not exist at the upstream source.
var ErrNotFound = errors.New("datasource: not found")

// FeeEstimate holds recommended fee rates expressed in sat/vB.
type FeeEstimate struct {
	FastestFee  float64 `json:"fastestFee"`
	HalfHourFee float64 `json:"halfHourFee"`
	HourFee     float64 `json:"hourFee"`
	EconomyFee  float64 `json:"economyFee"`
	MinimumFee  float64 `json:"minimumFee"`
}

// MempoolInfo is a snapshot of the current mempool state.
type MempoolInfo struct {
	// Count is the number of transactions currently in the mempool.
	Count int `json:"count"`
	// VSize is the total virtual size of the mempool in vbytes.
	VSize int64 `json:"vsize"`
	// TotalFee is the sum of all mempool transaction fees in satoshis.
	TotalFee int64 `json:"totalFee"`
	// FeeHistogram is a list of [feeRate, vsize] buckets, ordered from the
	// highest fee rate to the lowest, as exposed by mempool.space.
	FeeHistogram [][2]float64 `json:"feeHistogram"`
}

// ChainTip identifies the current best block of the chain.
type ChainTip struct {
	Height int    `json:"height"`
	Hash   string `json:"hash"`
}

// DataSource provides read access to Bitcoin network data. Implementations must
// be safe for concurrent use by multiple goroutines.
type DataSource interface {
	// Name identifies the backing provider, e.g. "mempool.space" or
	// "bitcoind". Useful for diagnostics and the health endpoint.
	Name() string

	// RecommendedFees returns suggested fee rates for upcoming blocks.
	RecommendedFees(ctx context.Context) (FeeEstimate, error)

	// Mempool returns a snapshot of the current mempool.
	Mempool(ctx context.Context) (MempoolInfo, error)

	// ChainTip returns the height and hash of the current best block.
	ChainTip(ctx context.Context) (ChainTip, error)
}
