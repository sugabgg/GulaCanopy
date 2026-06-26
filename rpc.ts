/**
 * rpc.ts
 *
 * HTTP client untuk Canopy Network RPC.
 * Semua komunikasi ke node lewat sini — port 50002 dan 50003.
 */

// ── Generic HTTP helpers ──────────────────────────────────────────────────────

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${text}`);
  return JSON.parse(text) as T;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${text}`);
  return JSON.parse(text) as T;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KeyGroup {
  address:    string; // hex 20-byte
  publicKey:  string; // hex 48-byte BLS public key
  privateKey: string; // hex 32-byte private key
}

export interface TxSignature {
  publicKey: string; // hex
  signature: string; // hex
}

export interface SubmitTxRequest {
  type:          string;
  msg?:          unknown;     // untuk tx tipe "send" yang sudah terdaftar
  msgTypeUrl?:   string;      // untuk plugin custom tx types
  msgBytes?:     string;      // hex-encoded proto bytes untuk custom types
  signature:     TxSignature;
  time:          number;      // Unix microseconds
  createdHeight: number;
  fee:           number;
  memo:          string;
  networkID:     number;
  chainID:       number;
}

export interface TxRecord {
  txHash:      string;
  height:      number;
  sender:      string;
  messageType: string;
}

export interface AccountInfo {
  address:       string;
  amount:        number;
  totalAmount:   number;
}

// ── Port 50002 — Public RPC ───────────────────────────────────────────────────

/**
 * Submit transaksi ke Canopy node.
 * Returns tx hash (hex string).
 */
export async function submitTx(rpcUrl: string, tx: SubmitTxRequest): Promise<string> {
  return post<string>(`${rpcUrl}/v1/tx`, tx);
}

/**
 * Dapatkan block height terbaru.
 */
export async function getHeight(rpcUrl: string): Promise<number> {
  const res = await post<{ height: number }>(`${rpcUrl}/v1/query/height`, {});
  return res.height;
}

/**
 * Dapatkan info akun (balance, dll).
 */
export async function getAccount(rpcUrl: string, address: string, height = 0): Promise<AccountInfo | null> {
  try {
    return await post<AccountInfo>(`${rpcUrl}/v1/query/account`, { address, height });
  } catch {
    return null;
  }
}

/**
 * Dapatkan list transaksi yang dikirim oleh address tertentu.
 * Dipakai untuk poll apakah tx sudah masuk blok.
 */
export async function getTxsBySender(
  rpcUrl:   string,
  address:  string,
  page    = 1,
  perPage = 50,
): Promise<{ results: TxRecord[]; totalCount: number }> {
  return post(`${rpcUrl}/v1/query/txs-by-sender`, { address, page, perPage });
}

/**
 * Dapatkan list transaksi yang gagal untuk address tertentu.
 */
export async function getFailedTxs(
  rpcUrl:  string,
  address: string,
  perPage = 20,
): Promise<{ results: TxRecord[]; totalCount: number }> {
  return post(`${rpcUrl}/v1/query/failed-txs`, { address, perPage });
}

/**
 * Tunggu sampai tx masuk blok (poll txs-by-sender).
 * Returns true jika ditemukan, false jika timeout.
 */
export async function waitForTx(
  rpcUrl:    string,
  sender:    string,
  txHash:    string,
  timeoutMs: number = 60_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await getTxsBySender(rpcUrl, sender, 1, 50);
      if (res.results.some(tx => tx.txHash === txHash)) return true;
    } catch { /* retry */ }
    await sleep(2000);
  }
  return false;
}

/**
 * Cek apakah tx ada di failed list.
 */
export async function isTxFailed(rpcUrl: string, address: string): Promise<boolean> {
  const res = await getFailedTxs(rpcUrl, address);
  return res.totalCount > 0;
}

// ── Port 50003 — Admin RPC ────────────────────────────────────────────────────

/**
 * Buat keypair baru di keystore Canopy node.
 * Returns address (hex string).
 *
 * POST http://localhost:50003/v1/admin/keystore-new-key
 */
export async function keystoreNewKey(
  adminUrl: string,
  nickname: string,
  password: string = '',
): Promise<string> {
  return post<string>(`${adminUrl}/v1/admin/keystore-new-key`, { nickname, password });
}

/**
 * Ambil keypair dari keystore (address + publicKey + privateKey).
 *
 * POST http://localhost:50003/v1/admin/keystore-get
 */
export async function keystoreGet(
  adminUrl:         string,
  addressOrNickname: string,
  password:         string = '',
): Promise<KeyGroup> {
  // API menerima address atau nickname
  const isAddress = /^[0-9a-fA-F]{40}$/.test(addressOrNickname);
  const body = isAddress
    ? { address: addressOrNickname, password }
    : { nickname: addressOrNickname, password };
  return post<KeyGroup>(`${adminUrl}/v1/admin/keystore-get`, body);
}

// ── Utility ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
