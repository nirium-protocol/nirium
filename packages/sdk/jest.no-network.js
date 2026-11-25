// Issue #126: fail any jest test that opens a real outbound connection.
//
// Loopback stays allowed so a test can run a local stub server. Everything
// else is refused at the socket and recorded, and the test that caused it
// fails in afterEach. The record matters: code under test often catches the
// connection error (x402Serve turns it into a 503), so refusing alone would
// pass silently.
const net = require('net');

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1']);
const violations = [];

function target(args) {
  const [a, b] = args;
  if (Array.isArray(a)) return target(a); // internal normalized form
  if (a && typeof a === 'object') {
    if (a.path) return null; // unix socket / named pipe: not network
    return { host: a.host ?? 'localhost', port: a.port };
  }
  if (typeof a === 'string' && Number.isNaN(Number(a))) return null; // ipc path
  return { host: typeof b === 'string' ? b : 'localhost', port: a };
}

if (!net.Socket.prototype.__niriumNoNetwork) {
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const t = target(args);
    if (t && !LOOPBACK.has(String(t.host).replace(/^\[|\]$/g, ''))) {
      const err = new Error(`outbound network blocked in tests: ${t.host}:${t.port} (see jest.no-network.js)`);
      violations.push(err.message);
      process.nextTick(() => this.destroy(err));
      return this;
    }
    return connect.apply(this, args);
  };
  net.Socket.prototype.__niriumNoNetwork = true;
}

afterEach(() => {
  if (violations.length) {
    const found = violations.splice(0);
    throw new Error(`test opened ${found.length} outbound connection(s):\n  ${found.join('\n  ')}`);
  }
});
