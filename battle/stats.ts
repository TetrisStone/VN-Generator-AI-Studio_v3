// Resolves BattleStats of project characters to complete stats (section 6).
// Missing values fall back to the defaults; old CombatStats are NOT converted.
import { DEFAULT_ENEMY_STATS, DEFAULT_HERO_STATS, DEFAULT_SPARK_STATS } from './config';
import type { ResolvedStats } from './types';

export interface BattleStatsLike {
  maxHp?: number;
  atk?: number;
  def?: number;
  ini?: number;
  maxKraft?: number;
  kraftResist?: number;
  abilityId?: string;
}

const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);

export function resolveHeroStats(bs?: BattleStatsLike | null): ResolvedStats {
  return {
    maxHp: Math.max(1, num(bs?.maxHp, DEFAULT_HERO_STATS.maxHp)),
    atk: Math.max(0, num(bs?.atk, DEFAULT_HERO_STATS.atk)),
    def: Math.max(0, num(bs?.def, DEFAULT_HERO_STATS.def)),
    ini: Math.max(0, num(bs?.ini, DEFAULT_HERO_STATS.ini)),
    maxKraft: 0,
    kraftResist: 0,
    abilityId: bs?.abilityId || undefined,
  };
}

export function resolveSparkStats(bs?: BattleStatsLike | null): ResolvedStats {
  return {
    maxHp: Math.max(1, num(bs?.maxHp, DEFAULT_SPARK_STATS.maxHp)),
    atk: 0,
    def: Math.max(0, num(bs?.def, DEFAULT_SPARK_STATS.def)),
    ini: Math.max(0, num(bs?.ini, DEFAULT_SPARK_STATS.ini)),
    maxKraft: 0,
    kraftResist: 0,
  };
}

export function resolveEnemyStats(bs?: BattleStatsLike | null): ResolvedStats {
  return {
    maxHp: Math.max(1, num(bs?.maxHp, DEFAULT_ENEMY_STATS.maxHp)),
    atk: Math.max(0, num(bs?.atk, DEFAULT_ENEMY_STATS.atk)),
    def: Math.max(0, num(bs?.def, DEFAULT_ENEMY_STATS.def)),
    ini: Math.max(0, num(bs?.ini, DEFAULT_ENEMY_STATS.ini)),
    maxKraft: Math.max(0, num(bs?.maxKraft, DEFAULT_ENEMY_STATS.maxKraft)),
    kraftResist: Math.max(0, Math.min(1, num(bs?.kraftResist, DEFAULT_ENEMY_STATS.kraftResist))),
    abilityId: bs?.abilityId || undefined,
  };
}
