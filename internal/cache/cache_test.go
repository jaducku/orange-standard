package cache

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jaducku/orange-standard/internal/datasource"
)

// fakeSource counts calls so tests can assert how often the upstream is hit.
type fakeSource struct {
	fees atomic.Int64
}

func (f *fakeSource) Name() string { return "fake" }

func (f *fakeSource) RecommendedFees(context.Context) (datasource.FeeEstimate, error) {
	f.fees.Add(1)
	return datasource.FeeEstimate{FastestFee: 12}, nil
}

func (f *fakeSource) Mempool(context.Context) (datasource.MempoolInfo, error) {
	return datasource.MempoolInfo{Count: 1}, nil
}

func (f *fakeSource) ChainTip(context.Context) (datasource.ChainTip, error) {
	return datasource.ChainTip{Height: 800000}, nil
}

func TestCachingServesFromCacheWithinTTL(t *testing.T) {
	now := time.Unix(0, 0)
	clock := func() time.Time { return now }
	src := &fakeSource{}
	c := wrapWithClock(src, TTLs{Fees: 10 * time.Second}, clock)

	for i := 0; i < 5; i++ {
		got, err := c.RecommendedFees(context.Background())
		if err != nil {
			t.Fatalf("RecommendedFees: %v", err)
		}
		if got.FastestFee != 12 {
			t.Fatalf("FastestFee = %v, want 12", got.FastestFee)
		}
	}
	if n := src.fees.Load(); n != 1 {
		t.Fatalf("upstream called %d times within TTL, want 1", n)
	}

	// Advance past the TTL: the next call must refresh.
	now = now.Add(11 * time.Second)
	if _, err := c.RecommendedFees(context.Background()); err != nil {
		t.Fatalf("RecommendedFees after expiry: %v", err)
	}
	if n := src.fees.Load(); n != 2 {
		t.Fatalf("upstream called %d times after expiry, want 2", n)
	}
}

func TestCachingCollapsesConcurrentCalls(t *testing.T) {
	now := time.Unix(0, 0)
	clock := func() time.Time { return now }
	src := &fakeSource{}
	c := wrapWithClock(src, TTLs{Fees: time.Minute}, clock)

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := c.RecommendedFees(context.Background()); err != nil {
				t.Errorf("RecommendedFees: %v", err)
			}
		}()
	}
	wg.Wait()

	if n := src.fees.Load(); n != 1 {
		t.Fatalf("upstream called %d times for concurrent burst, want 1", n)
	}
}
