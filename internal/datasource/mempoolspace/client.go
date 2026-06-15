// Package mempoolspace implements datasource.DataSource on top of the
// mempool.space public REST API (https://mempool.space/docs/api/rest).
//
// It is deliberately a thin, read-only client: it performs no caching of its
// own (that concern lives in package cache) so that it stays easy to reason
// about and to swap out for a self-hosted node later.
package mempoolspace

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jaducku/orange-standard/internal/datasource"
)

// DefaultBaseURL is the public mempool.space instance. Point this at your own
// mempool.space deployment (or a regional mirror) via Config.BaseURL.
const DefaultBaseURL = "https://mempool.space"

// Config configures a Client.
type Config struct {
	// BaseURL is the root of the mempool.space API, without a trailing slash.
	// Defaults to DefaultBaseURL when empty.
	BaseURL string
	// HTTPClient is used for all requests. Defaults to a client with a
	// sensible timeout when nil.
	HTTPClient *http.Client
	// UserAgent is sent with every request. Defaults to a generic value.
	UserAgent string
}

// Client is a mempool.space API client. It is safe for concurrent use.
type Client struct {
	baseURL    string
	httpClient *http.Client
	userAgent  string
}

// New returns a Client configured from cfg, applying defaults for any zero
// values.
func New(cfg Config) *Client {
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	ua := cfg.UserAgent
	if ua == "" {
		ua = "orange-standard/0.1 (+https://github.com/jaducku/orange-standard)"
	}
	return &Client{baseURL: baseURL, httpClient: httpClient, userAgent: ua}
}

// Name implements datasource.DataSource.
func (c *Client) Name() string { return "mempool.space" }

// RecommendedFees implements datasource.DataSource.
func (c *Client) RecommendedFees(ctx context.Context) (datasource.FeeEstimate, error) {
	var out datasource.FeeEstimate
	err := c.getJSON(ctx, "/api/v1/fees/recommended", &out)
	return out, err
}

// Mempool implements datasource.DataSource.
func (c *Client) Mempool(ctx context.Context) (datasource.MempoolInfo, error) {
	// The upstream payload uses snake_case and a slightly different shape, so
	// we decode into a local struct and map it onto the domain type.
	var raw struct {
		Count        int          `json:"count"`
		VSize        int64        `json:"vsize"`
		TotalFee     int64        `json:"total_fee"`
		FeeHistogram [][2]float64 `json:"fee_histogram"`
	}
	if err := c.getJSON(ctx, "/api/mempool", &raw); err != nil {
		return datasource.MempoolInfo{}, err
	}
	return datasource.MempoolInfo{
		Count:        raw.Count,
		VSize:        raw.VSize,
		TotalFee:     raw.TotalFee,
		FeeHistogram: raw.FeeHistogram,
	}, nil
}

// ChainTip implements datasource.DataSource.
func (c *Client) ChainTip(ctx context.Context) (datasource.ChainTip, error) {
	height, err := c.getPlainInt(ctx, "/api/blocks/tip/height")
	if err != nil {
		return datasource.ChainTip{}, err
	}
	hash, err := c.getPlainString(ctx, "/api/blocks/tip/hash")
	if err != nil {
		return datasource.ChainTip{}, err
	}
	return datasource.ChainTip{Height: height, Hash: hash}, nil
}

// getJSON performs a GET request and decodes a JSON body into dst.
func (c *Client) getJSON(ctx context.Context, path string, dst any) error {
	body, err := c.get(ctx, path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, dst); err != nil {
		return fmt.Errorf("mempoolspace: decode %s: %w", path, err)
	}
	return nil
}

// getPlainString performs a GET request and returns the trimmed text body.
// Several mempool.space endpoints return a bare value rather than JSON.
func (c *Client) getPlainString(ctx context.Context, path string) (string, error) {
	body, err := c.get(ctx, path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(body)), nil
}

// getPlainInt is getPlainString parsed as an integer.
func (c *Client) getPlainInt(ctx context.Context, path string) (int, error) {
	s, err := c.getPlainString(ctx, path)
	if err != nil {
		return 0, err
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("mempoolspace: parse int from %s: %w", path, err)
	}
	return n, nil
}

// get performs a GET request against the configured base URL and returns the
// raw response body, translating HTTP-level problems into errors.
func (c *Client) get(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("mempoolspace: build request %s: %w", path, err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.userAgent)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mempoolspace: GET %s: %w", path, err)
	}
	defer resp.Body.Close()

	// Cap the body to a few MiB to avoid unbounded reads from a misbehaving
	// upstream; all endpoints we use are far smaller than this.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("mempoolspace: read %s: %w", path, err)
	}

	switch {
	case resp.StatusCode == http.StatusNotFound:
		return nil, datasource.ErrNotFound
	case resp.StatusCode >= 400:
		return nil, fmt.Errorf("mempoolspace: GET %s: unexpected status %d: %s",
			path, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}
