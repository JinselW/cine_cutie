import express from 'express';
import { LRUCache } from './cache.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const cache = new LRUCache(100);
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api/')) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

app.post('/api/chat/completions', async (req, res) => {
  const { model, messages, temperature, response_format } = req.body;

  if (!model || !messages) {
    return res.status(400).json({ error: 'Missing required fields: model, messages' });
  }

  const cached = cache.get(model, messages);
  if (cached) {
    res.set('X-Cache', 'HIT');
    return res.json(cached);
  }

  const endpoint = req.headers['x-target-endpoint'] || 'https://api.openai.com/v1';
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key. Send via X-Api-Key header.' });
  }

  const url = `${endpoint.replace(/\/+$/, '')}/chat/completions`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    const body = { model, messages, temperature: temperature ?? 0.8 };
    if (response_format) body.response_format = response_format;

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return res.status(upstream.status).json({
        error: `Upstream API error: ${upstream.status}`,
        detail: text.substring(0, 500)
      });
    }

    const data = await upstream.json();
    cache.set(model, messages, data);

    res.set('X-Cache', 'MISS');
    res.json(data);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Upstream request timed out (90s)' });
    }
    res.status(502).json({ error: 'Upstream request failed', detail: err.message });
  }
});

app.get('/api/cache/stats', (req, res) => {
  res.json(cache.stats());
});

app.post('/api/cache/clear', (req, res) => {
  cache.cache.clear();
  cache.hits = 0;
  cache.misses = 0;
  res.json({ ok: true, message: 'Cache cleared' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', cache: cache.stats() });
});

app.use(express.static(path.join(__dirname, '..', 'dist')));

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`Cine-Cutie server running at http://localhost:${PORT}`);
  console.log(`Serving static files from dist/`);
  console.log(`Cache: LRU, max ${cache.maxSize} entries`);
});
