package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jaducku/orange-standard/internal/datasource"
)

// stubSource is a configurable datasource.DataSource for handler tests.
type stubSource struct {
	fees    datasource.FeeEstimate
	feesErr error
}

func (s stubSource) Name() string { return "stub" }
func (s stubSource) RecommendedFees(context.Context) (datasource.FeeEstimate, error) {
	return s.fees, s.feesErr
}
func (s stubSource) Mempool(context.Context) (datasource.MempoolInfo, error) {
	return datasource.MempoolInfo{}, nil
}
func (s stubSource) ChainTip(context.Context) (datasource.ChainTip, error) {
	return datasource.ChainTip{}, nil
}

func TestHandleRecommendedFeesOK(t *testing.T) {
	src := stubSource{fees: datasource.FeeEstimate{FastestFee: 25, HourFee: 8}}
	h := NewServer(src, nil).Handler()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/fees/recommended", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var got datasource.FeeEstimate
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if got.FastestFee != 25 || got.HourFee != 8 {
		t.Fatalf("got %+v, want FastestFee=25 HourFee=8", got)
	}
}

func TestHandleRecommendedFeesUpstreamError(t *testing.T) {
	src := stubSource{feesErr: errors.New("boom")}
	h := NewServer(src, nil).Handler()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/fees/recommended", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", rec.Code)
	}
}

func TestHandleHealth(t *testing.T) {
	h := NewServer(stubSource{}, nil).Handler()

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["provider"] != "stub" {
		t.Fatalf("provider = %v, want stub", body["provider"])
	}
}
