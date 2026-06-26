/**
 * config.ts
 *
 * Semua konfigurasi koneksi ke Canopy Network node.
 *
 * Port 50002 → Canopy public RPC
 *   - Submit transaksi   POST /v1/tx
 *   - Query height       POST /v1/query/height
 *   - Query account      POST /v1/query/account
 *   - Query txs          POST /v1/query/txs-by-sender
 *   - Query failed txs   POST /v1/query/failed-txs
 *
 * Port 50003 → Canopy admin RPC (localhost only)
 *   - Buat key baru      POST /v1/admin/keystore-new-key
 *   - Ambil key          POST /v1/admin/keystore-get
 */

export const CONFIG = {
  // Canopy node public RPC — submit tx, query state
  RPC_URL:   process.env['RPC_URL']   ?? 'http://localhost:50002',

  // Canopy node admin RPC — keystore management
  ADMIN_URL: process.env['ADMIN_URL'] ?? 'http://localhost:50003',

  // Canopy network/chain IDs
  NETWORK_ID: BigInt(process.env['NETWORK_ID'] ?? '1'),
  CHAIN_ID:   BigInt(process.env['CHAIN_ID']   ?? '1'),

  // Default fee untuk gula_log tx (0 = gratis di dev mode)
  DEFAULT_FEE: BigInt(process.env['DEFAULT_FEE'] ?? '0'),

  // Gula Log feed server port (standalone HTTP feed)
  FEED_PORT: parseInt(process.env['FEED_PORT'] ?? '3000', 10),
};

export type Config = typeof CONFIG;
