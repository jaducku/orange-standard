// Package config loads service configuration from environment variables,
// keeping a single source of truth for tunables and their defaults.
package config

import (
	"fmt"
	"os"
	"time"
)

// Config holds all runtime configuration for the service.
type Config struct {
	// HTTPAddr is the listen address for the API server, e.g. ":8080".
	HTTPAddr string
	// MempoolBaseURL is the root URL of the mempool.space API to wrap.
	MempoolBaseURL string
	// RequestTimeout bounds a single upstream HTTP request.
	RequestTimeout time.Duration
}

// Default returns the baseline configuration before environment overrides.
func Default() Config {
	return Config{
		HTTPAddr:       ":8080",
		MempoolBaseURL: "https://mempool.space",
		RequestTimeout: 10 * time.Second,
	}
}

// Load builds a Config from Default() overlaid with environment variables:
//
//	ORANGE_HTTP_ADDR         listen address          (default ":8080")
//	ORANGE_MEMPOOL_BASE_URL  mempool.space API root  (default "https://mempool.space")
//	ORANGE_REQUEST_TIMEOUT   upstream request timeout, Go duration (default "10s")
func Load() (Config, error) {
	cfg := Default()

	if v := os.Getenv("ORANGE_HTTP_ADDR"); v != "" {
		cfg.HTTPAddr = v
	}
	if v := os.Getenv("ORANGE_MEMPOOL_BASE_URL"); v != "" {
		cfg.MempoolBaseURL = v
	}
	if v := os.Getenv("ORANGE_REQUEST_TIMEOUT"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return Config{}, fmt.Errorf("config: invalid ORANGE_REQUEST_TIMEOUT %q: %w", v, err)
		}
		cfg.RequestTimeout = d
	}

	return cfg, nil
}
