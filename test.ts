/**
 * test.ts — Integration test Gula Log
 * Run: npx tsx src/test.ts
 *
 * Requires:
 *   - Canopy node on port 50002 + 50003
 *   - Gula Log feed server on port 3000 (npm run dev)
 */

import { CONFIG }                          from './config.js';
import { keystoreNewKey, keystoreGet,
         submitTx, getHeight, waitForTx }  from './rpc.js';
import { buildGulaLogTx }                  from './proto.js';

const FEED = `http://localhost:${CONFIG.FEED_PORT}`;

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} returned ${r.status}`);
  return r.json() as Promise<T>;
}

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`   OK  ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function pollProfile(address: string, minLogs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const p = await getJSON<Record<string, unknown>>(`${FEED}/v1/query/profile/${address}`);
    if ((p['totalLogs'] as number) >= minLogs) return p;
    await sleep(1000);
  }
  throw new Error(`profile did not reach totalLogs>=${minLogs} within 20s`);
}

async function main(): Promise<void> {
  console.log('\n Gula Log Integration Test');
  console.log('RPC    :', CONFIG.RPC_URL, '(port 50002)');
  console.log('Admin  :', CONFIG.ADMIN_URL, '(port 50003)');
  console.log('Feed   :', FEED, '\n');

  // Step 0: health
  console.log('Step 0  health check');
  const h = await getJSON<{status:string}>(`${FEED}/health`);
  ok(h.status === 'ok', 'feed server healthy');

  // Step 1: buat akun via :50003
  console.log('\nStep 1  create account via admin RPC :50003');
  const nick    = `tester_${Date.now()}`;
  const address = await keystoreNewKey(CONFIG.ADMIN_URL, nick, '');
  console.log('   address:', address);
  ok(address.length === 40, 'address 40-char hex');

  const key = await keystoreGet(CONFIG.ADMIN_URL, address, '');
  ok(!!key.publicKey,  'got publicKey');
  ok(!!key.privateKey, 'got privateKey');

  // Step 2: get height via :50002
  console.log('\nStep 2  get height via public RPC :50002');
  const height = await getHeight(CONFIG.RPC_URL);
  console.log('   height:', height);
  ok(height > 0, 'height > 0');

  // Step 3: build + sign + submit gula_log tx
  console.log('\nStep 3  build sign submit gula_log tx');
  const tx1 = buildGulaLogTx({
    authorAddress: key.address,
    publicKey:     key.publicKey,
    privateKey:    key.privateKey,
    project:       'gula-log',
    message:       'shipped the streak engine - day 1 on-chain',
    timestamp:     Math.floor(Date.now() / 1000),
    fee:           CONFIG.DEFAULT_FEE,
    currentHeight: height,
    networkId:     CONFIG.NETWORK_ID,
    chainId:       CONFIG.CHAIN_ID,
  });

  const txHash1 = await submitTx(CONFIG.RPC_URL, tx1 as Parameters<typeof submitTx>[1]);
  console.log('   txHash:', txHash1);
  ok(txHash1.length > 0, 'got tx hash');

  // Step 4: tunggu block inclusion
  console.log('\nStep 4  waiting for block inclusion (up to 60s)');
  const confirmed1 = await waitForTx(CONFIG.RPC_URL, address, txHash1, 60_000);
  ok(confirmed1, 'tx1 confirmed in block');

  // Step 5: assert profile
  console.log('\nStep 5  assert profile via feed server :3000');
  const p1 = await pollProfile(address, 1);
  ok(p1['totalLogs'] === 1,       `totalLogs=1 (got ${p1['totalLogs']})`);
  ok(p1['streak']    === 1,       `streak=1 (got ${p1['streak']})`);
  ok((p1['reputation'] as number) >= 1, `reputation>=1 (got ${p1['reputation']})`);
  ok(p1['streakTier'] === 'starter', `tier=starter (got ${p1['streakTier']})`);

  // Step 6: tx kedua same day - streak harus tetap 1
  console.log('\nStep 6  submit 2nd tx same day (streak idempotent)');
  const height2 = await getHeight(CONFIG.RPC_URL);
  const tx2     = buildGulaLogTx({
    authorAddress: key.address,
    publicKey:     key.publicKey,
    privateKey:    key.privateKey,
    project:       'gula-log',
    message:       'second log same day',
    timestamp:     Math.floor(Date.now() / 1000),
    fee:           CONFIG.DEFAULT_FEE,
    currentHeight: height2,
    networkId:     CONFIG.NETWORK_ID,
    chainId:       CONFIG.CHAIN_ID,
  });
  const txHash2     = await submitTx(CONFIG.RPC_URL, tx2 as Parameters<typeof submitTx>[1]);
  const confirmed2  = await waitForTx(CONFIG.RPC_URL, address, txHash2, 60_000);
  ok(confirmed2, 'tx2 confirmed in block');

  const p2 = await pollProfile(address, 2);
  ok(p2['totalLogs'] === 2, `totalLogs=2 (got ${p2['totalLogs']})`);
  ok(p2['streak']    === 1, `streak still 1 same-day idempotent (got ${p2['streak']})`);

  // Step 7: feed
  console.log('\nStep 7  query feed');
  const feed = await getJSON<{total:number}>(`${FEED}/v1/query/feed`);
  ok(feed.total >= 2, `global feed total>=${feed.total}`);

  const uf = await getJSON<{total:number}>(`${FEED}/v1/query/feed/${address}`);
  ok(uf.total >= 2, `user feed total>=2 (got ${uf.total})`);

  // Step 8: leaderboard
  console.log('\nStep 8  query leaderboard');
  const lb = await getJSON<{entries:Array<{address:string}>}>(
    `${FEED}/v1/query/leaderboard?sort_by=reputation&limit=50`
  );
  ok(lb.entries.some(e => e.address === address), 'address in leaderboard');

  console.log('\nAll tests passed!\n');
  console.log('curl ' + FEED + '/v1/query/feed');
  console.log('curl ' + FEED + '/v1/query/profile/' + address);
  console.log('curl ' + FEED + '/v1/query/leaderboard?sort_by=streak');
}

main().catch(e => { console.error('Test failed:', (e as Error).message); process.exit(1); });
