// Package cache provides a small TTL cache and a datasource.DataSource
// decorator built on top of it. The decorator shields the upstream data source
// (today mempool.space, later a home full node) from request bursts: many
// concurrent API callers collapse onto at most one upstream fetch per entry per
// TTL window.
package cache

import (
	"context"
	"sync"
	"time"

	"github.com/jaducku/orange-standard/internal/datasource"
)

// entry is a cached value with its expiry.
type entry[T any] struct {
	value     T
	expiresAt time.Time
}

// single caches one value of type T behind a TTL, with single-flight semantics
// so that concurrent misses trigger only one refresh.
type single[T any] struct {
	ttl  time.Duration
	now  func() time.Time
	mu   sync.Mutex
	cur  *entry[T]
	call *call[T] // in-flight refresh, if any
}

// call represents an in-flight refresh shared by concurrent callers.
type call[T any] struct {
	done  chan struct{}
	value T
	err   error
}

func newSingle[T any](ttl time.Duration, now func() time.Time) *single[T] {
	if now == nil {
		now = time.Now
	}
	return &single[T]{ttl: ttl, now: now}
}

// get returns the cached value when fresh, otherwise refreshes via fetch. At
// most one fetch runs at a time; concurrent callers wait for and share its
// result. A fresh cached value is always preferred over an in-flight refresh.
func (s *single[T]) get(ctx context.Context, fetch func(context.Context) (T, error)) (T, error) {
	s.mu.Lock()
	if s.cur != nil && s.now().Before(s.cur.expiresAt) {
		v := s.cur.value
		s.mu.Unlock()
		return v, nil
	}
	if s.call != nil {
		c := s.call
		s.mu.Unlock()
		return waitFor(ctx, c)
	}
	c := &call[T]{done: make(chan struct{})}
	s.call = c
	s.mu.Unlock()

	go func() {
		v, err := fetch(context.WithoutCancel(ctx))
		s.mu.Lock()
		c.value, c.err = v, err
		if err == nil {
			s.cur = &entry[T]{value: v, expiresAt: s.now().Add(s.ttl)}
		}
		s.call = nil
		s.mu.Unlock()
		close(c.done)
	}()

	return waitFor(ctx, c)
}

// waitFor blocks until the refresh completes or ctx is cancelled.
func waitFor[T any](ctx context.Context, c *call[T]) (T, error) {
	select {
	case <-c.done:
		return c.value, c.err
	case <-ctx.Done():
		var zero T
		return zero, ctx.Err()
	}
}

// TTLs configures how long each kind of value is cached. Zero values disable
// caching for that method (every call hits upstream).
type TTLs struct {
	Fees     time.Duration
	Mempool  time.Duration
	ChainTip time.Duration
}

// DefaultTTLs returns conservative defaults tuned to keep upstream load low
// while staying reasonably fresh for a mempool-style service.
func DefaultTTLs() TTLs {
	return TTLs{
		Fees:     10 * time.Second,
		Mempool:  5 * time.Second,
		ChainTip: 5 * time.Second,
	}
}

// Caching decorates a datasource.DataSource with per-method TTL caching.
type Caching struct {
	inner datasource.DataSource

	fees    *single[datasource.FeeEstimate]
	mempool *single[datasource.MempoolInfo]
	tip     *single[datasource.ChainTip]
}

// Wrap returns a Caching that serves reads from inner through TTL caches.
func Wrap(inner datasource.DataSource, ttls TTLs) *Caching {
	return wrapWithClock(inner, ttls, time.Now)
}

// wrapWithClock is Wrap with an injectable clock, used in tests.
func wrapWithClock(inner datasource.DataSource, ttls TTLs, now func() time.Time) *Caching {
	return &Caching{
		inner:   inner,
		fees:    newSingle[datasource.FeeEstimate](ttls.Fees, now),
		mempool: newSingle[datasource.MempoolInfo](ttls.Mempool, now),
		tip:     newSingle[datasource.ChainTip](ttls.ChainTip, now),
	}
}

// Name implements datasource.DataSource.
func (c *Caching) Name() string { return c.inner.Name() }

// RecommendedFees implements datasource.DataSource.
func (c *Caching) RecommendedFees(ctx context.Context) (datasource.FeeEstimate, error) {
	return c.fees.get(ctx, c.inner.RecommendedFees)
}

// Mempool implements datasource.DataSource.
func (c *Caching) Mempool(ctx context.Context) (datasource.MempoolInfo, error) {
	return c.mempool.get(ctx, c.inner.Mempool)
}

// ChainTip implements datasource.DataSource.
func (c *Caching) ChainTip(ctx context.Context) (datasource.ChainTip, error) {
	return c.tip.get(ctx, c.inner.ChainTip)
}
