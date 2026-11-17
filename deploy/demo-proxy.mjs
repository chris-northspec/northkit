// The Docker demo profile's proxy (docs/demo-link.md, K19). It runs in the SAME network
// namespace as the demo web container (network_mode: service:web-demo), so it reaches the
// app over loopback (127.0.0.1), and the app, told by NORTHKIT_DEMO_SIDECAR=1, trusts
// loopback to name the visitor. Only this proxy's port is published, and only on 127.0.0.1
// of the demo PC, so the Cloudflare Tunnel (running on that PC) is the only way in.
// Headers pass through untouched: Host stays the demo address, and the tunnel's
// X-Forwarded-Proto and Cf-Connecting-Ip reach the app. Nothing is logged or stored.
import http from 'node:http';

const LISTEN = Number(process.env.DEMO_PROXY_PORT || 3030);
const TARGET = Number(process.env.DEMO_TARGET_PORT || 3000);

const server = http.createServer((req, res) => {
  const upstream = http.request(
    { host: '127.0.0.1', port: TARGET, method: req.method, path: req.url, headers: req.headers },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('The demo is starting. Try again in a moment.');
  });
  req.pipe(upstream);
});
server.listen(LISTEN, '0.0.0.0', () =>
  process.stdout.write(`demo proxy on ${LISTEN} to 127.0.0.1:${TARGET}\n`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
