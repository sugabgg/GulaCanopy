/**
 * state.ts
 *
 * Local state indexer untuk Gula Log.
 *
 * Karena gula_log adalah custom tx type, Canopy node tidak tahu cara
 * decode MessageGulaLog. Yang node tahu: tx sudah di-include di blok.
 *
 * Cara kerjanya:
 *   1. Poll /v1/query/txs-by-sender atau /v1/query/events-by-chain
 *   2. Decode msgBytes dari setiap gula_log tx yang ditemukan
 *   3. Simpan di in-memory store (bisa diganti DB untuk production)
 *   4. Serve via HTTP feed/profile/leaderboard endpoints
 *
 * On-chain state (di FSM KV store) dikelola oleh plugin socket —
 * untuk standalone RPC-only mode ini, kita index dari tx history.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type StreakTier =
  | 'starter'
  | 'consistent_builder'
  | 'serious_builder'
  | 'legend';

export interface GulaLogEntry {
  txHash:    string;
  sender:    string;  // hex address
  project:   string;
  message:   string;
  timestamp: number;  // Unix epoch seconds
  height:    number;
  indexedAt: number;  // Unix epoch ms
}

export interface UserProfile {
  address:     string;
  totalLogs:   number;
  streak:      number;
  bestStreak:  number;
  reputation:  number;
  streakTier:  StreakTier;
  lastLogDate: string | null; // "YYYY-MM-DD"
  firstSeen:   number;        // Unix epoch ms
  lastSeen:    number;        // Unix epoch ms
}

// ── Engines ───────────────────────────────────────────────────────────────────

const MILESTONE_BONUS: Record<number, number> = { 7: 5, 30: 15, 100: 50 };
const MILESTONE_DAYS  = new Set([1, 7, 30, 100]);

export function tierFor(streak: number): StreakTier {
  if (streak >= 100) return 'legend';
  if (streak >= 30)  return 'serious_builder';
  if (streak >= 7)   return 'consistent_builder';
  return 'starter';
}

export function computeStreak(
  currentStreak: number,
  lastLogDate:   string | null,
  logDate:       string,
): { newStreak: number; milestoneReached: boolean } {
  if (!lastLogDate) return { newStreak: 1, milestoneReached: MILESTONE_DAYS.has(1) };
  const diff = daysBetween(lastLogDate, logDate);
  let newStreak: number;
  if (diff === 0)      newStreak = currentStreak;         // same day — idempotent
  else if (diff === 1) newStreak = currentStreak + 1;     // consecutive
  else                 newStreak = 1;                     // broken
  return {
    newStreak,
    milestoneReached: newStreak !== currentStreak && MILESTONE_DAYS.has(newStreak),
  };
}

export function computeRepDelta(newStreak: number, milestoneReached: boolean): number {
  return 1 + (milestoneReached ? (MILESTONE_BONUS[newStreak] ?? 0) : 0);
}

export function toDateString(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

// ── In-memory Store ───────────────────────────────────────────────────────────

export class GulaLogStore {
  private logs:     Map<string, GulaLogEntry>  = new Map(); // txHash → entry
  private profiles: Map<string, UserProfile>   = new Map(); // address → profile
  private feed:     GulaLogEntry[]             = [];        // newest first

  // ── Write ───────────────────────────────────────────────────────────────────

  addLog(entry: GulaLogEntry): void {
    if (this.logs.has(entry.txHash)) return; // idempotent

    this.logs.set(entry.txHash, entry);

    // Insert ke feed (newest first)
    const idx = this.feed.findIndex(e => e.height < entry.height ||
      (e.height === entry.height && e.indexedAt < entry.indexedAt));
    if (idx === -1) this.feed.push(entry);
    else this.feed.splice(idx, 0, entry);

    // Update profile
    this.updateProfile(entry);
  }

  private updateProfile(entry: GulaLogEntry): void {
    const existing = this.profiles.get(entry.sender);
    const logDate  = toDateString(entry.timestamp);
    const now      = Date.now();

    if (!existing) {
      const { newStreak, milestoneReached } = computeStreak(0, null, logDate);
      const repDelta = computeRepDelta(newStreak, milestoneReached);
      this.profiles.set(entry.sender, {
        address:     entry.sender,
        totalLogs:   1,
        streak:      newStreak,
        bestStreak:  newStreak,
        reputation:  repDelta,
        streakTier:  tierFor(newStreak),
        lastLogDate: logDate,
        firstSeen:   now,
        lastSeen:    now,
      });
      return;
    }

    // Same tx already counted (idempotent via logs map above)
    const { newStreak, milestoneReached } = computeStreak(
      existing.streak,
      existing.lastLogDate,
      logDate,
    );
    const repDelta = computeRepDelta(newStreak, milestoneReached);

    this.profiles.set(entry.sender, {
      ...existing,
      totalLogs:   existing.totalLogs + 1,
      streak:      newStreak,
      bestStreak:  Math.max(existing.bestStreak, newStreak),
      reputation:  existing.reputation + repDelta,
      streakTier:  tierFor(newStreak),
      lastLogDate: logDate,
      lastSeen:    now,
    });
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  getFeed(page = 1, pageSize = 20): { items: GulaLogEntry[]; total: number; hasMore: boolean } {
    const offset = (page - 1) * pageSize;
    return {
      items:   this.feed.slice(offset, offset + pageSize),
      total:   this.feed.length,
      hasMore: offset + pageSize < this.feed.length,
    };
  }

  getUserFeed(address: string, page = 1, pageSize = 20): { items: GulaLogEntry[]; total: number; hasMore: boolean } {
    const userLogs = this.feed.filter(e => e.sender === address.toLowerCase());
    const offset = (page - 1) * pageSize;
    return {
      items:   userLogs.slice(offset, offset + pageSize),
      total:   userLogs.length,
      hasMore: offset + pageSize < userLogs.length,
    };
  }

  getProfile(address: string): UserProfile | null {
    return this.profiles.get(address.toLowerCase()) ?? null;
  }

  getLeaderboard(
    sortBy:  'reputation' | 'streak' | 'total_logs' = 'reputation',
    limit  = 50,
  ): Array<UserProfile & { rank: number }> {
    const key = sortBy === 'total_logs' ? 'totalLogs' : sortBy;
    const sorted = [...this.profiles.values()]
      .sort((a, b) => (b[key as keyof UserProfile] as number) - (a[key as keyof UserProfile] as number))
      .slice(0, limit);
    return sorted.map((p, i) => ({ ...p, rank: i + 1 }));
  }

  getTotalLogs(): number { return this.logs.size; }
  getTotalUsers(): number { return this.profiles.size; }
}
