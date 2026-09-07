import { Client } from 'ssh2';
import crypto from 'crypto';
import net from 'net';

const tunnels = new Map();
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_COMFY_INPUT_DIR = '/home/Developer/minimax-h3-dgx-spark/ComfyUI/input';

function normalizedConfig(config = {}) {
  return {
    host: String(config.host || ''),
    port: Number(config.port) || 22,
    user: String(config.user || ''),
    password: String(config.password || ''),
    comfyPort: Number(config.comfyPort) || 8188,
  };
}

function tunnelKey(config) {
  return crypto.createHash('sha256').update(JSON.stringify(normalizedConfig(config))).digest('hex');
}

function clearIdleTimer(entry) {
  if (entry?.idleTimer) clearTimeout(entry.idleTimer);
  if (entry) entry.idleTimer = null;
}

function touchTunnel(key, entry) {
  clearIdleTimer(entry);
  entry.idleTimer = setTimeout(() => {
    console.log(`[SSHTunnel] Idle timeout for ${entry.config.host}, closing tunnel`);
    closeTunnel(entry.config).catch(() => {});
  }, IDLE_TIMEOUT_MS);
}

async function closeEntry(key, entry) {
  if (!entry) return;
  clearIdleTimer(entry);
  for (const conn of entry.connections) {
    try { conn.destroy(); } catch {}
  }
  entry.connections.clear();

  if (entry.server) {
    await new Promise((resolve) => {
      entry.server.close(() => resolve());
      setTimeout(resolve, 1000);
    });
  }
  try { entry.client?.end(); } catch {}
  entry.ready = false;
  if (tunnels.get(key) === entry) tunnels.delete(key);
}

export async function ensureTunnel(config) {
  const normalized = normalizedConfig(config);
  if (!normalized.host || !normalized.user) throw new Error('SSH host and user are required');
  const key = tunnelKey(normalized);
  const existing = tunnels.get(key);
  if (existing?.ready) {
    touchTunnel(key, existing);
    return { host: '127.0.0.1', port: existing.localPort, key };
  }
  if (existing?.connecting) return existing.connecting;

  const entry = {
    config: normalized,
    client: new Client(),
    server: null,
    localPort: null,
    ready: false,
    connections: new Set(),
    idleTimer: null,
    connecting: null,
  };
  tunnels.set(key, entry);

  entry.connecting = new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      closeEntry(key, entry).catch(() => {});
      reject(err);
    };

    entry.client.on('ready', () => {
      entry.server = net.createServer((sock) => {
        entry.client.forwardOut(
          sock.remoteAddress, sock.remotePort,
          '127.0.0.1', normalized.comfyPort,
          (err, stream) => {
            if (err) {
              console.error('[SSHTunnel] Forward error:', err.message);
              sock.end();
              return;
            }
            sock.pipe(stream);
            stream.pipe(sock);
            entry.connections.add(sock);
            entry.connections.add(stream);
            const remove = () => {
              entry.connections.delete(sock);
              entry.connections.delete(stream);
            };
            stream.on('close', remove);
            sock.on('close', remove);
          }
        );
      });

      entry.server.on('error', fail);
      entry.server.listen(0, '127.0.0.1', () => {
        entry.localPort = entry.server.address().port;
        entry.ready = true;
        entry.connecting = null;
        settled = true;
        console.log(`[SSHTunnel] Tunnel established: localhost:${entry.localPort} -> ${normalized.host}:${normalized.comfyPort}`);
        touchTunnel(key, entry);
        resolve({ host: '127.0.0.1', port: entry.localPort, key });
      });
    });

    entry.client.on('error', fail);
    entry.client.on('close', () => {
      entry.ready = false;
      clearIdleTimer(entry);
      if (tunnels.get(key) === entry) tunnels.delete(key);
      console.log(`[SSHTunnel] SSH connection closed: ${normalized.host}`);
    });

    entry.client.connect({
      host: normalized.host,
      port: normalized.port,
      username: normalized.user,
      password: normalized.password,
      readyTimeout: 30000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    });
  });

  return entry.connecting;
}

export async function closeTunnel(config) {
  if (config) {
    const key = tunnelKey(config);
    await closeEntry(key, tunnels.get(key));
    return;
  }
  await Promise.all([...tunnels.entries()].map(([key, entry]) => closeEntry(key, entry)));
}

export function getTunnelStatus() {
  const entries = [...tunnels.values()];
  const ready = entries.filter(entry => entry.ready);
  return {
    connected: ready.length > 0,
    localPort: ready.length === 1 ? ready[0].localPort : null,
    activeConnections: entries.reduce((sum, entry) => sum + entry.connections.size, 0),
    tunnelCount: ready.length,
  };
}

function withSftp(config, operation) {
  const normalized = normalizedConfig(config);
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on('ready', () => {
      client.sftp(async (err, sftp) => {
        if (err) { client.end(); reject(err); return; }
        try {
          const result = await operation(sftp);
          client.end();
          resolve(result);
        } catch (operationError) {
          client.end();
          reject(operationError);
        }
      });
    });
    client.on('error', reject);
    client.connect({
      host: normalized.host,
      port: normalized.port,
      username: normalized.user,
      password: normalized.password,
      readyTimeout: 30000,
    });
  });
}

export async function uploadFileSFTP(config, localFilePath, remoteFileName) {
  const inputDir = process.env.COMFYUI_INPUT_DIR || DEFAULT_COMFY_INPUT_DIR;
  return withSftp(config, (sftp) => new Promise((resolve, reject) => {
    sftp.fastPut(localFilePath, `${inputDir}/${remoteFileName}`, (err) => err ? reject(err) : resolve(remoteFileName));
  }));
}

export async function deleteComfyInputFiles(config, remoteFileNames) {
  const safeNames = [...new Set(remoteFileNames || [])].filter(name => /^cine_[A-Za-z0-9_.-]+$/.test(name));
  if (!safeNames.length) return;
  const inputDir = process.env.COMFYUI_INPUT_DIR || DEFAULT_COMFY_INPUT_DIR;
  await withSftp(config, async (sftp) => {
    await Promise.all(safeNames.map(name => new Promise((resolve, reject) => {
      sftp.unlink(`${inputDir}/${name}`, (err) => {
        if (!err || err.code === 2) resolve();
        else reject(err);
      });
    })));
  });
}
