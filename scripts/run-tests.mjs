import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const files = readdirSync('test')
  .filter(name => name.endsWith('.test.js') && name !== 'smoke.test.js')
  .sort()
  .map(name => path.join('test', name));

if (!files.length) throw new Error('No test/*.test.js files found');
const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
