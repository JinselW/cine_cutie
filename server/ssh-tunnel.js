import { Client } from 'ssh2';
import net from 'net';

let tunnelServer = null;
let sshClient = null;
let localPort = null;
let tunnelReady = false;
let activeConnections = new Set();
let idleTimer = null;

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function startIdleTimer() {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    console.log('[SSHTunnel] Idle timeout, closing tunnel');
    closeTunnel();
  }, IDLE_TIMEOUT_MS);
}

export async function ensureTunnel(config) {
  if (tunnelServer && sshClient && tunnelReady) {
    clearIdleTimer();
    startIdleTimer();
    return { host: '127.0.0.1', port: localPort };
  }

  await closeTunnel();

  const { host, port: sshPort, user, password, comfyPort } = config;

  return new Promise((resolve, reject) => {
    const client = new Client();
    let resolved = false;

    client.on('ready', () => {
      sshClient = client;

      const server = net.createServer((sock) => {
        client.forwardOut(
          sock.remoteAddress, sock.remotePort,
          '127.0.0.1', comfyPort || 8188,
          (err, stream) => {
            if (err) {
              console.error('[SSHTunnel] Forward error:', err.message);
              sock.end();
              return;
            }
            sock.pipe(stream);
            stream.pipe(sock);
            activeConnections.add(sock);
            activeConnections.add(stream);
            stream.on('close', () => {
              activeConnections.delete(sock);
              activeConnections.delete(stream);
            });
            sock.on('close', () => {
              activeConnections.delete(sock);
              activeConnections.delete(stream);
            });
          }
        );
      });

      server.listen(0, '127.0.0.1', () => {
        localPort = server.address().port;
        tunnelServer = server;
        tunnelReady = true;
        console.log(`[SSHTunnel] Tunnel established: localhost:${localPort} -> ${host}:${comfyPort || 8188}`);
        startIdleTimer();
        if (!resolved) {
          resolved = true;
          resolve({ host: '127.0.0.1', port: localPort });
        }
      });

      server.on('error', (err) => {
        console.error('[SSHTunnel] Local server error:', err.message);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });
    });

    client.on('error', (err) => {
      console.error('[SSHTunnel] SSH error:', err.message);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    client.on('close', () => {
      console.log('[SSHTunnel] SSH connection closed');
      sshClient = null;
      tunnelReady = false;
    });

    client.connect({
      host,
      port: sshPort || 22,
      username: user,
      password,
      readyTimeout: 30000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    });
  });
}

export async function closeTunnel() {
  clearIdleTimer();
  for (const conn of activeConnections) {
    try { conn.destroy(); } catch {}
  }
  activeConnections.clear();

  if (tunnelServer) {
    await new Promise((resolve) => {
      tunnelServer.close(() => resolve());
      setTimeout(resolve, 1000);
    });
    tunnelServer = null;
  }

  if (sshClient) {
    try { sshClient.end(); } catch {}
    sshClient = null;
  }

  localPort = null;
  tunnelReady = false;
}

export function getTunnelStatus() {
  return {
    connected: tunnelReady,
    localPort,
    activeConnections: activeConnections.size,
  };
}

export async function uploadFileSFTP(config, localFilePath, remoteFileName) {
  const tunnel = await ensureTunnel(config);

  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on('ready', () => {
      client.sftp((err, sftp) => {
        if (err) { client.end(); return reject(err); }

        const remotePath = `/home/Developer/minimax-h3-dgx-spark/ComfyUI/input/${remoteFileName}`;
        sftp.fastPut(localFilePath, remotePath, (putErr) => {
          client.end();
          if (putErr) return reject(putErr);
          resolve(remoteFileName);
        });
      });
    });
    client.on('error', reject);
    client.connect({
      host: config.host,
      port: config.port || 22,
      username: config.user,
      password: config.password,
      readyTimeout: 30000,
    });
  });
}
