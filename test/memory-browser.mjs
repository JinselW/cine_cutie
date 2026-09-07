// Optional browser integration: node test/memory-browser.mjs <absolute-playwright-module>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'vite';
import { createMemoryRouter } from '../server/memory.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cine-memory-browser-'));
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api/memory', createMemoryRouter(directory));
const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'spa' });
app.use(vite.middlewares);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('#historyBtn').click();
  await page.getByText('暂无记录。开始一次创作后会自动保存。').waitFor();
  await page.locator('[data-close]').click();
  await page.evaluate(async () => {
    const { state } = await import('/src/js/state.js');
    const { beginMemory, saveMemory, recordMemoryMessage } = await import('/src/js/memory.js');
    state.userInput = '测试猫咪的月球旅行';
    localStorage.setItem('cine-cutie-settings', JSON.stringify({ apiProviders: { test: { apiKey: 'SECRET-NOT-SAVED' } }, models: { text: { name: 'test-model' } } }));
    await beginMemory();
    state.data.script = { title: '月球猫', synopsis: '<img src=x onerror=alert(1)>', characters: [] };
    recordMemoryMessage('user', '请让猫咪穿红色衣服', 'script');
    await saveMemory('stopped');
    state.data.script = null; // UI resets after stop must not overwrite the saved result.
    await saveMemory();
  });
  await page.reload();
  await page.locator('#historyBtn').click();
  await page.locator('.history-card').click();
  await page.locator('article h3').waitFor();
  assert.match(await page.locator('article').innerText(), /月球猫/);
  assert.equal(await page.locator('article img').count(), 0);
  page.once('dialog', d => d.accept('重命名的电影'));
  await page.locator('[data-rename]').click();
  await page.getByRole('heading', { name: '重命名的电影' }).waitFor();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-export]').click();
  const download = await downloadPromise;
  const exported = fs.readFileSync(await download.path(), 'utf8');
  assert.ok(exported.includes('test-model'));
  assert.ok(exported.includes('请让猫咪穿红色衣服'));
  assert.ok(!exported.includes('SECRET-NOT-SAVED'));
  await page.locator('input[type=search]').fill('不存在');
  await page.getByText('0 条记录', { exact: true }).waitFor();
  await page.locator('input[type=search]').fill('红色衣服');
  await page.getByText('1 条记录', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator('.history-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  page.once('dialog', d => d.accept());
  await page.locator('[data-delete]').click();
  await page.getByText('记录已删除，媒体文件已保留。').waitFor();
  await page.locator('[data-close]').click();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#userInput').fill('一只猫在月球上种花');
  await page.locator('#modeInteractive').click();
  await page.locator('#startBtn').click();
  const deadline = Date.now() + 60000;
  while (true) {
    const records = await (await fetch(`${base}/api/memory`)).json();
    if (records.some(r => r.steps >= 1)) break;
    if (Date.now() > deadline) throw new Error(`Pipeline did not save: ${errors.join('; ')}`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  await page.evaluate(async () => {
    const { stopPipeline } = await import('/src/js/orchestrator.js');
    stopPipeline();
    const { saveMemory } = await import('/src/js/memory.js');
    await saveMemory();
  });
  const runs = await (await fetch(`${base}/api/memory`)).json();
  const run = await (await fetch(`${base}/api/memory/${runs[0].id}`)).json();
  assert.ok(run.snapshot.data.script);
  assert.ok(Object.keys(run.snapshot.artifacts).length);
  assert.ok(run.snapshot.messages.length);
  assert.equal(run.snapshot.status, 'stopped');
  assert.deepEqual(errors, []);
  console.log('PASS: autosave, reload, stopped snapshot, search, rename, export, secret exclusion, safe rendering, mobile layout, delete, actual interactive pipeline artifacts/messages');
} finally {
  await browser?.close(); await vite.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
}
