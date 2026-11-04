// Battle system — stage 1 constants. All tuning values live here.

export const AP_PER_TURN = 5;
export const NORMAL_MULT = 1.0;
export const HEAVY_MULT = 2.2;
export const BLOCK_FACTOR = 0.5;
export const DEF_CONSTANT = 50;
export const VARIANCE = 0.1;
export const SPARK_DRAIN = 20;
export const DIZZY_RECOVERY_PULSES = 2;
export const DIZZY_RECOVERY_HP = 0.3;
export const MAX_ENEMIES = 6;
export const ENEMY_GROUP_RADIUS = 4;

/** Default ability cooldown (enemy AI only), in enemy turns */
export const DEFAULT_ENEMY_COOLDOWN = 3;
/** Enemy AI tuning (section 11) */
export const AI_LOW_HP_RATIO = 0.3;
export const AI_LOW_HP_BLOCK_CHANCE = 0.3;
export const AI_HEAVY_CHANCE = 0.35;
export const AI_WEAKEST_TARGET_CHANCE = 0.5;

/** Breadcrumb trail length of the leader (defeat respawn) */
export const BREADCRUMB_LENGTH = 20;

export const ACTION_AP: Record<'normal_hit' | 'heavy_hit' | 'block', number> = {
  normal_hit: 1,
  heavy_hit: 2,
  block: 1,
};

/** Default stats (section 6) — used whenever values are missing */
export const DEFAULT_HERO_STATS = { maxHp: 100, atk: 20, def: 20, ini: 4 } as const;
export const DEFAULT_SPARK_STATS = { maxHp: 80, atk: 0, def: 30, ini: 0 } as const;
export const DEFAULT_ENEMY_STATS = { maxHp: 80, atk: 16, def: 15, ini: 3, maxKraft: 100, kraftResist: 0 } as const;
