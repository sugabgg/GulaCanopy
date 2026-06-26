/**
 * indexer.ts
 *
 * Poll Canopy node (port 50002) untuk gula_log transactions.
 * Decode msgBytes dan masukkan ke GulaLogStore.
 *
 * Flow:
 *   1. GET /v1/query/height → dapat latest height
 *   2. POST /v1/query/txs-by-height untuk setiap blok baru
 *   3. Filter tx.type === "gula_log"
 *   4. Decode msgBytes → GulaLogEntry
 *   5. store.addLog(entry)
 */

import { getTxsBySender, getHeight } from './rpc.js';
import { GulaLogStore, type GulaLogEntry } from './state.js';
import { CONFIG } from './config.js';

const POLL_INTERVAL_MS   = 3_000;
const MAX_BLOCKS_PER_TICK = 20;

// ── Protobuf decoder untuk MessageGulaLog ─────────────────────────────────────
// Decode binary protobuf tanpa runtime library

function decodeVarint(buf: Buffer, offset: number): [number, number] {
  let result = 0, shift = 0;
  while (offset < buf.length) {
    const byte = buf[offset++]!;
    result |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7;
  }
  return [result, offset];
}

interface DecodedGulaLog {
  authorAddress: string; // hex
  project:       string;
  message:       string;
  timestamp:     number;
}

function decodeMessageGulaLog(hexBytes: string): DecodedGulaLog | null {
  try {
    const buf = Buffer.from(hexBytes, 'hex');
    let offset = 0;
    let authorAddress = '';
    let project = '';
    let message = '';
    let timestamp = 0;

    while (offset < buf.length) {
      const [tag, o1] = decodeVarint(buf, offset); offset = o1;
      const field    = tag >>> 3;
      const wireType = tag & 0x7;

      if (wireType === 2) {
        // length-delimited
        const [len, o2] = decodeVarint(buf, offset); offset = o2;
        const slice = buf.slice(offset, offset + len); offset += len;
        if (field === 1) authorAddress = slice.toString('hex');         // author_address
        else if (field === 2) project  = slice.toString('utf8');        // project
        else if (field === 3) message  = slice.toString('utf8');        // message
      } else if (wireType === 0) {
        const [val, o2] = decodeVarint(buf, offset); offset = o2;
        if (field === 4) timestamp = val;                               // timestamp
      } else break;
    }

    if (!authorAddress || !project || !message || !timestamp) return null;
    return { authorAddress, project, message, timestamp };
  } catch {
    return null;
  }
}

// ── Indexer ───────────────────────────────────────────────────────────────────

export class Indexer {
  private lastHeight    = 0;
  private running       = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly store: GulaLogStore) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[indexer] starting — polling', CONFIG.RPC_URL, 'every', POLL_INTERVAL_MS, 'ms');
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    console.log('[indexer] stopped');
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick(), POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    try {
      const latestHeight = await getHeight(CONFIG.RPC_URL);

      if (this.lastHeight === 0) {
        // First run — start from current height (don't replay history)
        this.lastHeight = latestHeight;
        console.log(`[indexer] starting from height ${latestHeight}`);
      } else if (latestHeight > this.lastHeight) {
        const from = this.lastHeight + 1;
        const to   = Math.min(latestHeight, from + MAX_BLOCKS_PER_TICK - 1);

        for (let h = from; h <= to; h++) {
          await this.indexHeight(h);
        }
        this.lastHeight = to;
      }
    } catch (err) {
      console.error('[indexer] tick error:', (err as Error).message);
    } finally {
      this.schedule();
    }
  }

  private async indexHeight(height: number): Promise<void> {
    // Canopy exposes txs-by-sender per address; for a global feed we use
    // events-by-chain which is available at /v1/query/events-by-chain.
    // For the RPC-only mode, we index by querying known senders OR
    // by scanning the events endpoint for gula_log events.
    try {
      const res = await fetch(`${CONFIG.RPC_URL}/v1/query/txs-by-height`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ height, page: 1, perPage: 100 }),
      });
      if (!res.ok) return;

      const data = await res.json() as {
        results?: Array<{
          txHash:      string;
          sender:      string;
          messageType: string;
          msgBytes?:   string;
          height:      number;
        }>;
      };

      for (const tx of data.results ?? []) {
        if (tx.messageType !== 'gula_log') continue;
        if (!tx.msgBytes) continue;

        const decoded = decodeMessageGulaLog(tx.msgBytes);
        if (!decoded) {
          console.warn(`[indexer] failed to decode gula_log tx ${tx.txHash}`);
          continue;
        }

        const entry: GulaLogEntry = {
          txHash:    tx.txHash,
          sender:    tx.sender,
          project:   decoded.project,
          message:   decoded.message,
          timestamp: decoded.timestamp,
          height:    tx.height,
          indexedAt: Date.now(),
        };

        this.store.addLog(entry);
        console.log(`[indexer] ✓ gula_log height=${height} sender=${tx.sender} project="${decoded.project}"`);
      }
    } catch (err) {
      console.error(`[indexer] error at height ${height}:`, (err as Error).message);
    }
  }

  /**
   * Index semua historical logs dari satu address.
   * Dipanggil saat user query profile yang belum ada di store.
   */
  async indexSender(address: string): Promise<void> {
    let page = 1;
    while (true) {
      const res = await getTxsBySender(CONFIG.RPC_URL, address, page, 50);
      for (const tx of res.results) {
        if (tx.messageType !== 'gula_log') continue;
        const raw = tx as unknown as { msgBytes?: string };
        if (!raw.msgBytes) continue;
        const decoded = decodeMessageGulaLog(raw.msgBytes);
        if (!decoded) continue;
        this.store.addLog({
          txHash:    tx.txHash,
          sender:    tx.sender,
          project:   decoded.project,
          message:   decoded.message,
          timestamp: decoded.timestamp,
          height:    tx.height,
          indexedAt: Date.now(),
        });
      }
      if (res.results.length < 50) break;
      page++;
    }
  }
}
