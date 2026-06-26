/**
 * proto.ts
 *
 * Protobuf encoding untuk MessageGulaLog dan Transaction signing.
 *
 * Canopy transaction signing flow (dari docs resmi):
 *   1. Buat Transaction proto dengan signature = null
 *   2. sign_bytes = proto.encode(tx_tanpa_signature)
 *   3. signature  = BLS12-381.sign(sign_bytes, private_key)
 *   4. Attach signature, submit ke POST /v1/tx
 *
 * PENTING: sign proto bytes, BUKAN JSON.
 */

import { bls12_381 } from '@noble/curves/bls12-381.js';

// ── Manual protobuf encoding ──────────────────────────────────────────────────
// Kita encode manual karena tidak butuh runtime protobuf penuh —
// hanya perlu encode untuk signing (deterministic binary).

function varint(n: number | bigint): Uint8Array {
  const bytes: number[] = [];
  let v = typeof n === 'bigint' ? n : BigInt(Math.floor(Number(n)));
  while (v > 0x7fn) {
    bytes.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  bytes.push(Number(v & 0x7fn));
  return new Uint8Array(bytes);
}

function fieldTag(fieldNum: number, wireType: number): Uint8Array {
  return varint(fieldNum * 8 + wireType);
}

function encodeBytes(fieldNum: number, data: Uint8Array): Uint8Array {
  if (!data || data.length === 0) return new Uint8Array(0);
  const tag = fieldTag(fieldNum, 2);
  const len = varint(data.length);
  const out = new Uint8Array(tag.length + len.length + data.length);
  out.set(tag, 0);
  out.set(len, tag.length);
  out.set(data, tag.length + len.length);
  return out;
}

function encodeString(fieldNum: number, s: string): Uint8Array {
  if (!s) return new Uint8Array(0);
  return encodeBytes(fieldNum, new TextEncoder().encode(s));
}

function encodeVarintField(fieldNum: number, n: number | bigint): Uint8Array {
  const v = typeof n === 'bigint' ? n : BigInt(Math.floor(Number(n)));
  if (v === 0n) return new Uint8Array(0);
  const tag = fieldTag(fieldNum, 0);
  const val = varint(v);
  const out = new Uint8Array(tag.length + val.length);
  out.set(tag, 0);
  out.set(val, tag.length);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

// ── MessageGulaLog encoding ───────────────────────────────────────────────────

export interface GulaLogMsg {
  authorAddress: Uint8Array; // 20 bytes
  project:       string;
  message:       string;
  timestamp:     number;     // Unix epoch seconds
}

/**
 * Encode MessageGulaLog ke protobuf bytes.
 * type_url = "type.googleapis.com/types.MessageGulaLog"
 */
export function encodeMessageGulaLog(msg: GulaLogMsg): Uint8Array {
  return concat(
    encodeBytes(1, msg.authorAddress),  // author_address
    encodeString(2, msg.project),       // project
    encodeString(3, msg.message),       // message
    encodeVarintField(4, msg.timestamp) // timestamp
  );
}

// ── google.protobuf.Any encoding ─────────────────────────────────────────────

export function encodeAny(typeUrl: string, value: Uint8Array): Uint8Array {
  return concat(
    encodeString(1, typeUrl), // type_url  field 1
    encodeBytes(2, value)     // value     field 2
  );
}

// ── Transaction encoding (untuk sign bytes) ───────────────────────────────────

export interface TxFields {
  messageType:   string;
  msgAny:        Uint8Array;
  createdHeight: number;
  timeUs:        bigint;   // Unix microseconds
  fee:           bigint;
  memo:          string;
  networkId:     bigint;
  chainId:       bigint;
}

/**
 * Encode Transaction proto TANPA signature field.
 * Hasilnya dipakai sebagai sign_bytes.
 */
export function encodeTxForSigning(tx: TxFields): Uint8Array {
  return concat(
    encodeString(1, tx.messageType),    // message_type
    encodeBytes(2, tx.msgAny),          // msg (Any)
    // field 3 = signature — DIKOSONGKAN saat signing
    encodeVarintField(4, tx.createdHeight), // created_height
    encodeVarintField(5, tx.timeUs),        // time (microseconds)
    encodeVarintField(6, tx.fee),           // fee
    encodeString(7, tx.memo),              // memo
    encodeVarintField(8, tx.networkId),    // network_id
    encodeVarintField(9, tx.chainId),      // chain_id
  );
}

// ── BLS12-381 signing ─────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function hexToBase64(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64');
}

/**
 * Sign dengan BLS12-381 longSignatures (G2) — sama seperti Canopy node.
 * DST: BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_
 */
export function signBLS(privateKeyHex: string, message: Uint8Array): Uint8Array {
  const privKey = hexToBytes(privateKeyHex);
  const hashed  = bls12_381.longSignatures.hash(message);
  const sigPoint = bls12_381.longSignatures.sign(hashed, privKey);
  return bls12_381.longSignatures.Signature.toBytes(sigPoint);
}

// ── Build gula_log transaction untuk submit ───────────────────────────────────

export interface BuildGulaLogTxParams {
  authorAddress: string; // hex 20-byte
  publicKey:     string; // hex BLS public key
  privateKey:    string; // hex BLS private key
  project:       string;
  message:       string;
  timestamp:     number; // Unix epoch seconds
  fee:           bigint;
  currentHeight: number;
  networkId:     bigint;
  chainId:       bigint;
}

/**
 * Build, sign, dan return gula_log transaction siap submit ke POST /v1/tx.
 */
export function buildGulaLogTx(p: BuildGulaLogTxParams): object {
  const timeUs = BigInt(Date.now()) * 1000n; // microseconds

  // 1. Encode inner message
  const msgBytes = encodeMessageGulaLog({
    authorAddress: hexToBytes(p.authorAddress),
    project:       p.project,
    message:       p.message,
    timestamp:     p.timestamp,
  });

  // 2. Wrap dalam google.protobuf.Any
  const typeUrl = 'type.googleapis.com/types.MessageGulaLog';
  const anyBytes = encodeAny(typeUrl, msgBytes);

  // 3. Encode tx tanpa signature → sign bytes
  const signBytes = encodeTxForSigning({
    messageType:   'gula_log',
    msgAny:        anyBytes,
    createdHeight: p.currentHeight,
    timeUs,
    fee:           p.fee,
    memo:          '',
    networkId:     p.networkId,
    chainId:       p.chainId,
  });

  // 4. Sign dengan BLS12-381
  const sigBytes = signBLS(p.privateKey, signBytes);
  const pubBytes = hexToBytes(p.publicKey);

  // 5. Return JSON untuk POST /v1/tx
  // Untuk custom plugin tx types, Canopy pakai msgTypeUrl + msgBytes
  return {
    type:          'gula_log',
    msgTypeUrl:    typeUrl,
    msgBytes:      bytesToHex(msgBytes),
    signature: {
      publicKey: bytesToHex(pubBytes),
      signature: bytesToHex(sigBytes),
    },
    time:          Number(timeUs),
    createdHeight: p.currentHeight,
    fee:           Number(p.fee),
    memo:          '',
    networkID:     Number(p.networkId),
    chainID:       Number(p.chainId),
  };
}
