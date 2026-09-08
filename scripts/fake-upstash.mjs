/*
 * Minimal Upstash-REST-compatible server, for proving that `use cache: remote`
 * entries are genuinely shared between server instances.
 *
 * Locally `createKVAdapter` falls back to `MemoryKvAdapter`, which is per-process
 * — so two `next start` processes each get their own cache and "sharing" can
 * neither be observed nor disproven. Pointing both at this server exercises the
 * real `UpstashKvAdapter` code path against one shared store.
 *
 * Implements only what the adapter uses: SET (with EX), GET, MGET, and the
 * /pipeline batch form. Values arrive already JSON-encoded by @upstash/redis.
 */
import http from 'node:http';

const store = new Map(); // key -> { value, expiresAt }
const stats = { set: 0, get: 0, mget: 0 };

const now = () => Date.now();

function read(key) {
  const hit = store.get(key);

  if (!hit) return null;
  if (hit.expiresAt && hit.expiresAt < now()) {
    store.delete(key);

    return null;
  }

  return hit.value;
}

function exec(cmd) {
  const [nameRaw, ...args] = cmd;
  const name = String(nameRaw).toUpperCase();

  if (name === 'SET') {
    const [key, value, ...rest] = args;
    let expiresAt = 0;
    const exIndex = rest.findIndex((a) => String(a).toUpperCase() === 'EX');

    if (exIndex !== -1) expiresAt = now() + Number(rest[exIndex + 1]) * 1000;
    store.set(key, { value, expiresAt });
    stats.set++;

    return 'OK';
  }

  if (name === 'GET') {
    stats.get++;

    return read(args[0]);
  }

  if (name === 'MGET') {
    stats.mget++;

    return args.map((k) => read(k));
  }

  if (name === 'PING') return 'PONG';

  return null;
}

const server = http.createServer((req, res) => {
  if (req.url === '/__stats') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ...stats, keys: store.size }));

    return;
  }

  if (req.url === '/__keys') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([...store.keys()]));

    return;
  }

  let body = '';

  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let parsed;

    try {
      parsed = JSON.parse(body || '[]');
    } catch {
      res.writeHead(400).end('{"error":"bad json"}');

      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });

    // /pipeline takes an array of commands and returns an array of results.
    if (req.url?.startsWith('/pipeline')) {
      res.end(JSON.stringify(parsed.map((cmd) => ({ result: exec(cmd) }))));

      return;
    }

    res.end(JSON.stringify({ result: exec(parsed) }));
  });
});

server.listen(Number(process.env.PORT ?? 4010), '127.0.0.1', () => {
  console.log(`fake-upstash listening on ${Number(process.env.PORT ?? 4010)}`);
});
