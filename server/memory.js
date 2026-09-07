import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';

// One atomic JSON document per run. Media remains in the existing media store.
export function createMemoryRouter(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const router = Router();
  const filename = id => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Object.assign(new Error('Invalid record ID'), { status: 400 });
    return path.join(directory, `${id}.json`);
  };
  const read = id => JSON.parse(fs.readFileSync(filename(id), 'utf8'));
  const write = record => {
    const file = filename(record.id);
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(record), 'utf8');
    fs.renameSync(temporary, file);
    return record;
  };
  const wrap = fn => (req, res, next) => { try { fn(req, res); } catch (error) { next(error); } };
  router.get('/', wrap((req, res) => {
    const q = String(req.query.q || '').toLowerCase();
    const records = [];
    for (const file of fs.readdirSync(directory).filter(f => /^[a-f0-9-]{36}\.json$/.test(f))) {
      try {
        const record = read(file.slice(0, -5));
        if (q && !JSON.stringify(record).toLowerCase().includes(q)) continue;
        records.push({ id: record.id, title: record.title, createdAt: record.createdAt,
          updatedAt: record.updatedAt, status: record.snapshot?.status || 'saved',
          input: record.snapshot?.input?.userInput || '',
          steps: Object.values(record.snapshot?.data || {}).filter(Boolean).length });
      } catch (error) { console.warn(`Cannot read history ${file}: ${error.message}`); }
    }
    res.json(records.sort((a, b) => b.updatedAt - a.updatedAt));
  }));
  router.post('/', wrap((req, res) => {
    const now = Date.now();
    res.status(201).json(write({ id: randomUUID(), schemaVersion: 1,
      title: String(req.body.title || '未命名创作').slice(0, 200), createdAt: now, updatedAt: now,
      snapshot: req.body.snapshot || {} }));
  }));
  router.get('/:id', wrap((req, res) => res.json(read(req.params.id))));
  router.put('/:id', wrap((req, res) => {
    const record = read(req.params.id); // Deleted runs must never be recreated by late autosaves.
    if (!req.body.snapshot || typeof req.body.snapshot !== 'object') {
      return res.status(400).json({ error: 'Missing snapshot' });
    }
    record.snapshot = req.body.snapshot;
    record.updatedAt = Date.now();
    res.json(write(record));
  }));
  router.patch('/:id', wrap((req, res) => {
    const record = read(req.params.id);
    if (typeof req.body.title !== 'string' || !req.body.title.trim()) {
      return res.status(400).json({ error: 'Title required' });
    }
    record.title = req.body.title.trim().slice(0, 200);
    res.json(write(record));
  }));
  router.delete('/:id', wrap((req, res) => {
    fs.unlinkSync(filename(req.params.id));
    res.status(204).end();
  }));
  router.use((error, _req, res, _next) => {
    const status = error.code === 'ENOENT' ? 404 : error.status || 500;
    res.status(status).json({ error: status === 404 ? 'Record not found' : status === 500 ? 'History storage failed' : error.message });
  });
  return router;
}
