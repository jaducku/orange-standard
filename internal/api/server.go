// Package api exposes the headless HTTP interface of the service. It is a thin
// translation layer: it turns HTTP requests into datasource.DataSource calls
// and encodes the results as JSON. All non-trivial logic lives below this
// layer (datasource, cache).
package api

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/jaducku/orange-standard/internal/datasource"
)

// Server wires routes to a datasource.DataSource.
type Server struct {
	src    datasource.DataSource
	logger *slog.Logger
}

// NewServer returns a Server backed by src. A nil logger falls back to the
// slog default.
func NewServer(src datasource.DataSource, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	return &Server{src: src, logger: logger}
}

// Handler builds the http.Handler with all routes and middleware applied.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// Liveness/readiness.
	mux.HandleFunc("GET /healthz", s.handleHealth)

	// v1 read API.
	mux.HandleFunc("GET /api/v1/fees/recommended", s.handleRecommendedFees)
	mux.HandleFunc("GET /api/v1/mempool", s.handleMempool)
	mux.HandleFunc("GET /api/v1/chain/tip", s.handleChainTip)

	return s.recover(s.logRequests(mux))
}

// logRequests logs one line per request with method, path, status and latency.
func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		s.logger.Info("http_request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration", time.Since(start).String(),
		)
	})
}

// recover turns a panic in a handler into a 500 rather than crashing the
// process.
func (s *Server) recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				s.logger.Error("handler_panic", "value", v, "path", r.URL.Path)
				writeError(w, http.StatusInternalServerError, "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// statusRecorder captures the response status for logging.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}
