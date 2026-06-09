#!/usr/bin/env node
'use strict';

/**
 * Usage:  node bin/serve.js [--port 3000]
 *
 * Starts the dashboard server. Open http://localhost:3000 in your browser.
 * Others on your local network can access it at http://<your-ip>:3000
 *
 * Run node bin/setup.js first if you haven't already.
 */

const os = require('os');
const { createServer } = require('../src/server');

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : (parseInt(process.env.PORT ?? '3000', 10));

createServer(port).then((server) => {
  const addr = server.address();

  // Find a LAN IP to show alongside localhost
  const lanIp = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i.family === 'IPv4' && !i.internal)?.address;

  console.log('\n  Fundamental Quality Screener\n');
  console.log(`  Local   : http://localhost:${addr.port}`);
  if (lanIp) console.log(`  Network : http://${lanIp}:${addr.port}  ← share this with others`);
  console.log('\n  Press Ctrl+C to stop.\n');
}).catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
