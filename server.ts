/**
 * server.ts
 *
 * HTTP feed server untuk Gula Log.
 * Berjalan di port 3000 (configurable via FEED_PORT).
 *
 * Routes:
 *   GET /health
 *   GET /v1/query/feed
 *   GET /v1/query/feed/:address
 *   GET /v1/query/profile/:address
 *   GET /v1/query/leaderboard
 *   GET /v1/query/stats
 */

import http from 'http';
import { GulaLogStore } from './state.js';
import { CONFIG } from './config.js';

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

function err(res: http.ServerResponse, status: number, msg: string): void {
  json(res, status, { error: msg });
}

function parseInt2(s: string | null, def: number, min = 1, max = 200): number {
  const n = parseInt(s ?? String(def), 10);
  return Math.min(max, Math.max(min, isNaN(n) ? def : n));
}

export function startServer(store: GulaLogStore): void {
  const server = http.createServer((req, res) => {
    const url    = new URL(req.url ?? '/', `http://localhost`);
    const path   = url.pathname;

    // ── /health ────────────────────────────────────────────────────────────
    if (path === '/health') {
      json(res, 200, {
        status:     'ok',
        app:        'gula-log',
        rpc:        CONFIG.RPC_URL,
        admin:      CONFIG.ADMIN_URL,
        totalLogs:  store.getTotalLogs(),
        totalUsers: store.getTotalUsers(),
        time:       Date.now(),
      });
      return;
    }

    // ── /v1/query/feed ─────────────────────────────────────────────────────
    if (path === '/v1/query/feed') {
      const page     = parseInt2(url.searchParams.get('page'), 1);
      const pageSize = parseInt2(url.searchParams.get('page_size'), 20, 1, 100);
      json(res, 200, { ...store.getFeed(page, pageSize), page, pageSize });
      return;
    }

    // ── /v1/query/feed/:address ────────────────────────────────────────────
    const feedMatch = path.match(/^\/v1\/query\/feed\/([0-9a-fA-F]{40})$/);
    if (feedMatch) {
      const address  = feedMatch[1]!.toLowerCase();
      const page     = parseInt2(url.searchParams.get('page'), 1);
      const pageSize = parseInt2(url.searchParams.get('page_size'), 20, 1, 100);
      json(res, 200, { ...store.getUserFeed(address, page, pageSize), page, pageSize });
      return;
    }

    // ── /v1/query/profile/:address ─────────────────────────────────────────
    const profileMatch = path.match(/^\/v1\/query\/profile\/([0-9a-fA-F]{40})$/);
    if (profileMatch) {
      const address = profileMatch[1]!.toLowerCase();
      const profile = store.getProfile(address);
      if (!profile) {
        json(res, 200, {
          address, totalLogs: 0, streak: 0, bestStreak: 0,
          reputation: 0, streakTier: 'starter', lastLogDate: null,
        });
        return;
      }
      json(res, 200, profile);
      return;
    }

    // ── /v1/query/leaderboard ──────────────────────────────────────────────
    if (path === '/v1/query/leaderboard') {
      const sortBy = url.searchParams.get('sort_by') ?? 'reputation';
      if (!['reputation', 'streak', 'total_logs'].includes(sortBy)) {
        err(res, 400, 'sort_by must be: reputation | streak | total_logs');
        return;
      }
      const limit = parseInt2(url.searchParams.get('limit'), 50, 1, 200);
      json(res, 200, {
        sortBy,
        entries:     store.getLeaderboard(sortBy as 'reputation' | 'streak' | 'total_logs', limit),
        generatedAt: Date.now(),
      });
      return;
    }

    // ── /v1/query/stats ────────────────────────────────────────────────────
    if (path === '/v1/query/stats') {
      json(res, 200, {
        totalLogs:  store.getTotalLogs(),
        totalUsers: store.getTotalUsers(),
        rpc:        CONFIG.RPC_URL,
        chainId:    Number(CONFIG.CHAIN_ID),
      });
      return;
    }

    err(res, 404, 'not found');
  });

  server.listen(CONFIG.FEED_PORT, () => {
    console.log(`[server] Gula Log feed server running on http://localhost:${CONFIG.FEED_PORT}`);
    console.log(`[server] Routes:`);
    console.log(`         GET /health`);
    console.log(`         GET /v1/query/feed[?page=1&page_size=20]`);
    console.log(`         GET /v1/query/feed/:address`);
    console.log(`         GET /v1/query/profile/:address`);
    console.log(`         GET /v1/query/leaderboard[?sort_by=reputation|streak|total_logs&limit=50]`);
    console.log(`         GET /v1/query/stats`);
  });

  server.on('error', (e) => console.error('[server] error:', e.message));
}
