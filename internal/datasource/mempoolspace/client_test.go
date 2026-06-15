package mempoolspace

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientMapsEndpoints(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/fees/recommended", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"fastestFee":30,"halfHourFee":20,"hourFee":10,"economyFee":5,"minimumFee":1}`))
	})
	mux.HandleFunc("/api/mempool", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"count":42,"vsize":1234,"total_fee":9999,"fee_histogram":[[10.0,2000.0]]}`))
	})
	mux.HandleFunc("/api/blocks/tip/height", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("800123\n"))
	})
	mux.HandleFunc("/api/blocks/tip/hash", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("0000000000000000000abc\n"))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := New(Config{BaseURL: srv.URL})
	ctx := context.Background()

	fees, err := c.RecommendedFees(ctx)
	if err != nil {
		t.Fatalf("RecommendedFees: %v", err)
	}
	if fees.FastestFee != 30 || fees.MinimumFee != 1 {
		t.Fatalf("fees = %+v", fees)
	}

	mp, err := c.Mempool(ctx)
	if err != nil {
		t.Fatalf("Mempool: %v", err)
	}
	if mp.Count != 42 || mp.TotalFee != 9999 || len(mp.FeeHistogram) != 1 {
		t.Fatalf("mempool = %+v", mp)
	}

	tip, err := c.ChainTip(ctx)
	if err != nil {
		t.Fatalf("ChainTip: %v", err)
	}
	if tip.Height != 800123 || tip.Hash != "0000000000000000000abc" {
		t.Fatalf("tip = %+v", tip)
	}
}
