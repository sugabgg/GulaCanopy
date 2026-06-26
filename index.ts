/**
 * index.ts — Gula Log entrypoint
 *
 * Jalankan dengan:
 *   npm run dev         (development, hot reload via tsx)
 *   npm start           (production, setelah npm run build)
 *
 * Env vars (semua opsional, ada default):
 *   RPC_URL=http://localhost:50002   Canopy public RPC
 *   ADMIN_URL=http://localhost:50003 Canopy admin RPC
 *   CHAIN_ID=1
 *   NETWORK_ID=1
 *   FEED_PORT=3000
 */

import { CONFIG }    from './config.js';
import { GulaLogStore } from './state.js';
import { Indexer }   from './indexer.js';
import { startServer } from './server.js';

console.log('');
console.log('  🌿 Gula Log — SocialFi on Canopy Network');
console.log('  ─────────────────────────────────────────');
console.log(`  Public RPC  : ${CONFIG.RPC_URL}  (port 50002)`);
console.log(`  Admin RPC   : ${CONFIG.ADMIN_URL}  (port 50003)`);
console.log(`  Feed server : http://localhost:${CONFIG.FEED_PORT}`);
console.log(`  Chain ID    : ${CONFIG.CHAIN_ID}`);
console.log('');

const store   = new GulaLogStore();
const indexer = new Indexer(store);

// Start feed server
startServer(store);

// Start block indexer (poll port 50002)
indexer.start();

// Graceful shutdown
process.on('SIGINT',  () => { indexer.stop(); process.exit(0); });
process.on('SIGTERM', () => { indexer.stop(); process.exit(0); });
