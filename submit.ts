/**
 * submit.ts
 *
 * CLI helper untuk submit gula_log transaction ke Canopy node.
 *
 * Usage:
 *   npx tsx src/submit.ts \
 *     --address  <hex-address> \
 *     --project  "nama-project" \
 *     --message  "catatan aktivitas hari ini" \
 *     [--rpc     http://localhost:50002] \
 *     [--admin   http://localhost:50003] \
 *     [--password ""]
 *
 * Flow:
 *   1. keystoreGet(:50003) → dapat publicKey + privateKey
 *   2. getHeight(:50002)   → dapat currentHeight
 *   3. buildGulaLogTx()    → build + sign dengan BLS12-381
 *   4. submitTx(:50002)    → POST /v1/tx
 *   5. waitForTx(:50002)   → poll sampai masuk blok
 */

import { CONFIG }                                from './config.js';
import { keystoreGet, submitTx, getHeight, waitForTx } from './rpc.js';
import { buildGulaLogTx }                         from './proto.js';

function arg(flag: string, def = ''): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? (process.argv[idx + 1] ?? def) : def;
}

async function main(): Promise<void> {
  const address  = arg('--address');
  const project  = arg('--project',  'my-project');
  const message  = arg('--message',  'daily build log');
  const password = arg('--password', '');
  const rpc      = arg('--rpc',   CONFIG.RPC_URL);
  const admin    = arg('--admin', CONFIG.ADMIN_URL);

  if (!address) {
    console.error('Usage: npx tsx src/submit.ts --address <hex> --project <name> --message <text>');
    process.exit(1);
  }

  console.log(`\n🌿 Gula Log — Submit Transaction`);
  console.log(`   RPC   : ${rpc}`);
  console.log(`   Admin : ${admin}`);
  console.log(`   Sender: ${address}`);
  console.log(`   Project: ${project}`);
  console.log(`   Message: ${message}\n`);

  // 1. Ambil keypair dari keystore (:50003)
  console.log('Step 1: Getting keypair from keystore...');
  const key = await keystoreGet(admin, address, password);
  console.log(`   ✓ publicKey: ${key.publicKey.slice(0, 16)}...`);

  // 2. Get current height (:50002)
  console.log('Step 2: Getting current block height...');
  const height = await getHeight(rpc);
  console.log(`   ✓ height: ${height}`);

  // 3. Build + sign tx
  console.log('Step 3: Building and signing gula_log transaction...');
  const tx = buildGulaLogTx({
    authorAddress: key.address,
    publicKey:     key.publicKey,
    privateKey:    key.privateKey,
    project,
    message,
    timestamp:     Math.floor(Date.now() / 1000),
    fee:           CONFIG.DEFAULT_FEE,
    currentHeight: height,
    networkId:     CONFIG.NETWORK_ID,
    chainId:       CONFIG.CHAIN_ID,
  });
  console.log(`   ✓ tx built and signed with BLS12-381`);

  // 4. Submit ke :50002
  console.log('Step 4: Submitting to Canopy node...');
  const txHash = await submitTx(rpc, tx as Parameters<typeof submitTx>[1]);
  console.log(`   ✓ tx submitted: ${txHash}`);

  // 5. Tunggu konfirmasi
  console.log('Step 5: Waiting for block inclusion (up to 60s)...');
  const included = await waitForTx(rpc, key.address, txHash, 60_000);
  if (included) {
    console.log(`   ✓ confirmed in block!\n`);
    console.log(`📊 Check profile: curl http://localhost:${CONFIG.FEED_PORT}/v1/query/profile/${key.address}`);
    console.log(`📰 Check feed:    curl http://localhost:${CONFIG.FEED_PORT}/v1/query/feed`);
  } else {
    console.warn(`   ⚠ tx not confirmed within 60s. Check: curl ${rpc}/v1/query/failed-txs`);
  }
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
