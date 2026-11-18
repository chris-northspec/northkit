// Loaded before the Next.js server (node --import ./peer-address.mjs server.js). Puts
// the connecting (socket) address of every request in the X-NorthKit-Peer header,
// replacing anything a client sent under that name, so the app can tell the real
// connecting address from an X-Forwarded-For header anyone can type (D15). Next itself
// only fills X-Forwarded-For when a client hasn't, so it can't be used for this.
//
// It also stops a production server (NODE_ENV=production, as the Docker image sets)
// starting with NORTHKIT_DEMO_ORIGIN set: the demo link trusts forwarded headers from
// loopback and works under the development server only (docs/demo-link.md). The app
// checks again itself (src/instrumentation.ts), for servers started without this file.
import http from 'node:http';

export const PEER_HEADER = 'x-northkit-peer';

// The Docker demo profile is the one exception: its proxy shares the app's network
// namespace, and it only runs on a demo or development database (docs/demo-link.md).
const sidecar =
  process.env.NORTHKIT_DEMO_SIDECAR === '1' &&
  /^northkit_[a-z0-9_]*(demo|dev)[a-z0-9_]*$/.test(process.env.NORTHKIT_DB_NAME ?? '');

if (process.env.NODE_ENV === 'production' && process.env.NORTHKIT_DEMO_ORIGIN?.trim() && !sidecar) {
  process.stderr.write(
    'NorthKit will not start: NORTHKIT_DEMO_ORIGIN is set, and the demo link only works ' +
      'under the development server (`pnpm dev`, docs/demo-link.md). It makes the app trust ' +
      'forwarded headers from this machine, which a production install must not do. Remove ' +
      'NORTHKIT_DEMO_ORIGIN from deploy/.env and the environment, then start it again.\n',
  );
  process.exit(1);
}

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function emitWithPeer(event, ...args) {
  if (event === 'request') {
    const request = args[0];
    request.headers[PEER_HEADER] = request.socket?.remoteAddress ?? '';
  }
  return emit.call(this, event, ...args);
};
