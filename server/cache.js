import crypto from 'crypto';

class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  _key(model, messages) {
    const payload = JSON.stringify({ model, messages });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  get(model, messages) {
    const key = this._key(model, messages);
    if (this.cache.has(key)) {
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      this.hits++;
      return value;
    }
    this.misses++;
    return null;
  }

  set(model, messages, response) {
    const key = this._key(model, messages);
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    this.cache.set(key, response);
  }

  stats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? Math.round(this.hits / (this.hits + this.misses) * 1000) / 10
        : 0
    };
  }
}

export { LRUCache };
