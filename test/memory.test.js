import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createMemoryRouter } from '../server/memory.js';

test('history persists across router restarts, searches, renames, deletes without resurrection', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cine-memory-test-'));
  let server;
  const start = async () => {
    const app = express(); app.use(express.json()); app.use('/api/memory', createMemoryRouter(directory));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    return `http://127.0.0.1:${server.address().port}/api/memory`;
  };
  const close = () => new Promise(resolve => server.close(resolve));
  const request = (url, method, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  try {
    let url = await start();
    const snapshot = { status: 'running', input: { userInput: '太空猫' }, data: { script: { title: '月球旅行' } }, messages: [{ role: 'user', text: '<script>test</script>' }] };
    const response = await request(url, 'POST', { title: '电影', snapshot });
    assert.equal(response.status, 201);
    const record = await response.json();
    await close(); url = await start();
    assert.deepEqual((await (await fetch(`${url}/${record.id}`)).json()).snapshot, snapshot);
    assert.equal((await (await fetch(`${url}?q=${encodeURIComponent('月球')}`)).json()).length, 1);
    assert.equal((await (await fetch(`${url}?q=missing`)).json()).length, 0);
    await request(`${url}/${record.id}`, 'PATCH', { title: '新名称' });
    await request(`${url}/${record.id}`, 'PUT', { snapshot: { ...snapshot, status: 'completed' } });
    const updated = await (await fetch(`${url}/${record.id}`)).json();
    assert.equal(updated.title, '新名称'); assert.equal(updated.snapshot.status, 'completed');
    assert.equal((await request(`${url}/${record.id}`, 'PATCH', { title: '  ' })).status, 400);
    assert.equal((await fetch(`${url}/invalid`)).status, 400);
    fs.writeFileSync(path.join(directory, '00000000-0000-0000-0000-000000000000.json'), 'broken');
    assert.equal((await (await fetch(url)).json()).length, 1);
    assert.equal((await request(`${url}/${record.id}`, 'DELETE')).status, 204);
    assert.equal((await request(`${url}/${record.id}`, 'PUT', { snapshot })).status, 404);
    assert.equal((await fetch(`${url}/${record.id}`)).status, 404);
  } finally {
    await close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
