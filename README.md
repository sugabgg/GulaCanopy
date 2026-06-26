# Gula Log

SocialFi on-chain build activity logging pada Canopy Network.
Log aktivitas build harian on-chain, bangun streak, dan naikkan reputasi.

## Arsitektur

```
Canopy Node
  :50002  Public RPC  ─── submit gula_log tx / query height / txs-by-sender
  :50003  Admin RPC   ─── keystore-new-key / keystore-get

Gula Log App
  Indexer  ─── poll :50002 setiap 3s, decode gula_log txs, update state
  Server   ─── HTTP feed/profile/leaderboard di :3000
```

## Quick Start

```bash
# Install
npm install

# Copy env
cp .env.example .env

# Jalankan (dev mode, hot reload)
npm run dev
```

## Submit Log

```bash
# 1. Buat key baru via admin RPC
curl -X POST http://localhost:50003/v1/admin/keystore-new-key \
  -H "Content-Type: application/json" \
  -d '{"nickname":"saya","password":""}'
# Returns: "abcd1234...hex-address..."

# 2. Submit gula_log transaction
npx tsx src/submit.ts \
  --address <hex-address> \
  --project "nama-project" \
  --message "aktivitas hari ini"
```

## Query Feed

```bash
# Health
curl http://localhost:3000/health

# Global feed (semua log terbaru)
curl "http://localhost:3000/v1/query/feed"
curl "http://localhost:3000/v1/query/feed?page=1&page_size=20"

# Feed per user
curl "http://localhost:3000/v1/query/feed/<address>"

# Profile (streak, reputation, tier)
curl "http://localhost:3000/v1/query/profile/<address>"

# Leaderboard
curl "http://localhost:3000/v1/query/leaderboard?sort_by=streak"
curl "http://localhost:3000/v1/query/leaderboard?sort_by=reputation"
curl "http://localhost:3000/v1/query/leaderboard?sort_by=total_logs&limit=10"

# Stats
curl "http://localhost:3000/v1/query/stats"
```

## Integration Test

```bash
# Terminal 1: jalankan app
npm run dev

# Terminal 2: jalankan test
npm test
```

## Streak & Reputation

| Streak | Tier |
|--------|------|
| 1–6 hari | `starter` |
| 7–29 hari | `consistent_builder` |
| 30–99 hari | `serious_builder` |
| 100+ hari | `legend` |

| Event | Poin |
|-------|------|
| Setiap log | +1 |
| Streak 7 hari | +5 |
| Streak 30 hari | +15 |
| Streak 100 hari | +50 |

Log di hari yang sama bersifat idempotent — streak tidak berubah.

## Env Variables

| Variable | Default | Keterangan |
|----------|---------|------------|
| `RPC_URL` | `http://localhost:50002` | Canopy public RPC |
| `ADMIN_URL` | `http://localhost:50003` | Canopy admin RPC |
| `CHAIN_ID` | `1` | Canopy chain ID |
| `NETWORK_ID` | `1` | Canopy network ID |
| `DEFAULT_FEE` | `0` | Fee per tx (uCNPY) |
| `FEED_PORT` | `3000` | Port feed server |
