/**
 * High-Speed In-Memory LRU / TTL Cache
 * Provides sub-millisecond (< 1ms) response times for Discord autocomplete and search queries
 */
class MemoryCache {
  constructor(defaultTtlMs = 300000, maxEntries = 500) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }

    // Refresh position for LRU
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.store.has(key)) {
      // Updating a key must not evict an unrelated entry.
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }

    // A NaN/Infinity TTL would never expire (`Date.now() > NaN` is always false).
    const numericTtl = Number(ttlMs);
    const ttl = Number.isFinite(numericTtl) && numericTtl > 0 ? numericTtl : this.defaultTtlMs;

    this.store.set(key, {
      value,
      expiry: Date.now() + ttl,
    });
  }

  has(key) {
    return this.get(key) !== null;
  }

  clear() {
    this.store.clear();
  }
}

module.exports = new MemoryCache();
