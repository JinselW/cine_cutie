import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDgxMetrics } from '../server/ssh-tunnel.js';
import { isPromptRunning } from '../server/comfyui.js';

test('DGX metrics parser returns GPU, VRAM, thermal, power and disk values', () => {
  const data = parseDgxMetrics([
    '0, NVIDIA GB10, 72, 6400, 128000, 54, 88.5, 140.0',
    '__MEMORY__',
    '128000000000 32000000000 96000000000',
    '__DISK__',
    '/dev/nvme0n1 1000000 250000 750000 25% /home',
  ].join('\n'));
  assert.deepEqual(data.gpus[0], {
    index: 0,
    name: 'NVIDIA GB10',
    utilization: 72,
    memoryUsedMiB: 6400,
    memoryTotalMiB: 128000,
    temperatureC: 54,
    powerDrawW: 88.5,
    powerLimitW: 140,
  });
  assert.equal(data.disk.usedPercent, 25);
  assert.equal(data.disk.usedBytes, 250000 * 1024);
  assert.equal(data.memory.usedPercent, 25);
});

test('Comfy queue status distinguishes running work from pending work', () => {
  const queue = {
    queue_running: [[1, 'active-id', {}, {}, []]],
    queue_pending: [[2, 'waiting-id', {}, {}, []]],
  };
  assert.equal(isPromptRunning(queue, 'active-id'), true);
  assert.equal(isPromptRunning(queue, 'waiting-id'), false);
});
