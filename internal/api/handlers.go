package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jaducku/orange-standard/internal/datasource"
)

// handleHealth reports liveness and which upstream provider is in use.
func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "ok",
		"provider": s.src.Name(),
	})
}

// handleRecommendedFees returns suggested fee rates in sat/vB.
func (s *Server) handleRecommendedFees(w http.ResponseWriter, r *http.Request) {
	fees, err := s.src.RecommendedFees(r.Context())
	if err != nil {
		s.writeUpstreamError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, fees)
}

// handleMempool returns a snapshot of the current mempool.
func (s *Server) handleMempool(w http.ResponseWriter, r *http.Request) {
	info, err := s.src.Mempool(r.Context())
	if err != nil {
		s.writeUpstreamError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// handleChainTip returns the height and hash of the best block.
func (s *Server) handleChainTip(w http.ResponseWriter, r *http.Request) {
	tip, err := s.src.ChainTip(r.Context())
	if err != nil {
		s.writeUpstreamError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tip)
}

// writeUpstreamError maps datasource errors onto HTTP responses.
func (s *Server) writeUpstreamError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, datasource.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		s.logger.Error("upstream_error", "error", err.Error())
		writeError(w, http.StatusBadGateway, "upstream data source error")
	}
}

// writeJSON encodes v as a JSON response with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError writes a JSON error envelope: {"error": "..."}.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
