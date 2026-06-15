// Command orange-standard runs the headless Bitcoin network service.
//
// In this first iteration it wraps the mempool.space public API behind a small
// caching layer and exposes a read-only JSON API. The datasource.DataSource
// abstraction means a self-hosted full node can be swapped in later without
// changing the API layer.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jaducku/orange-standard/internal/api"
	"github.com/jaducku/orange-standard/internal/cache"
	"github.com/jaducku/orange-standard/internal/config"
	"github.com/jaducku/orange-standard/internal/datasource/mempoolspace"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if err := run(logger); err != nil {
		logger.Error("fatal", "error", err.Error())
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Upstream data source: mempool.space today, a full node tomorrow.
	upstream := mempoolspace.New(mempoolspace.Config{
		BaseURL:    cfg.MempoolBaseURL,
		HTTPClient: &http.Client{Timeout: cfg.RequestTimeout},
	})

	// Shield the upstream from request bursts with per-method TTL caching.
	src := cache.Wrap(upstream, cache.DefaultTTLs())

	srv := api.NewServer(src, logger)
	httpServer := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Run the server and wait for either a fatal error or a shutdown signal.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("server_starting", "addr", cfg.HTTPAddr, "provider", src.Name())
		err := httpServer.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
		logger.Info("server_stopping")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return httpServer.Shutdown(shutdownCtx)
	}
}
