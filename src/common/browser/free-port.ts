import { createServer } from 'node:net';

/**
 * Asks the OS for an unused TCP port by briefly binding to port 0.
 * Small TOCTOU risk between closing this probe socket and the real listener
 * (Chromium's --remote-debugging-port) binding it, but that's the same
 * approach every "find a free port" utility uses.
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('Could not determine a free port'));
        }
      });
    });
  });
}
