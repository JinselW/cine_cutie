// Backward-compatible entry point. Maintained smoke checks live in test/smoke.test.js.
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--test', 'test/smoke.test.js'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
