// Simple enemy AI (section 11). Deterministic for a given BattleState seed.
import { AI_HEAVY_CHANCE, AI_LOW_HP_BLOCK_CHANCE, AI_LOW_HP_RATIO, AI_WEAKEST_TARGET_CHANCE } from './config';
import { getAbility } from './abilities';
import { Rng } from './rng';
import { attackableTargets, getCombatant, needsSingleTarget, resolveTargets, validTargets } from './engine';
import type { BattleAction, BattleState, Combatant } from './types';

function chooseTarget(rng: Rng, pool: Combatant[]): Combatant | undefined {
  if (pool.length === 0) return undefined;
  // Spark preferred over dizzy heroes when both are attackable
  const spark = pool.find(c => c.isSpark);
  if (spark && pool.some(c => !c.isSpark && c.status === 'dizzy')) return spark;
  if (rng.chance(AI_WEAKEST_TARGET_CHANCE)) {
    return [...pool].sort((a, b) => a.hp - b.hp || a.id.localeCompare(b.id))[0];
  }
  return rng.pick(pool);
}

/**
 * Decides the single action of one active enemy. Returns the action and the
 * state with the advanced RNG (decision randomness is part of the seed).
 */
export function decideEnemyAction(input: BattleState, enemyId: string): { action: BattleAction | null; state: BattleState } {
  const me = getCombatant(input, enemyId);
  if (!me || me.status !== 'active' || me.side !== 'enemy') return { action: null, state: input };
  const rng = new Rng(input.rngState);
  const done = (action: BattleAction | null) => ({ action, state: { ...input, rngState: rng.state } });

  // 1. Low HP, no block active -> 30 % block
  if (me.hp < me.stats.maxHp * AI_LOW_HP_RATIO && me.damageFactor >= 1 && rng.chance(AI_LOW_HP_BLOCK_CHANCE)) {
    return done({ actorId: me.id, actionId: 'block' });
  }

  // 2. Ability ready
  const ab = getAbility(me.stats.abilityId);
  if (ab && me.abilityCooldown <= 0) {
    if (needsSingleTarget(me, 'ability')) {
      const pool = validTargets(input, me.id, 'ability');
      const offensive = ab.target === 'enemy';
      const t = offensive
        ? chooseTarget(rng, pool)
        : [...pool].sort((a, b) => a.hp / a.stats.maxHp - b.hp / b.stats.maxHp)[0];
      if (t) return done({ actorId: me.id, actionId: 'ability', targetId: t.id });
    } else if (resolveTargets(input, me, 'ability')) {
      return done({ actorId: me.id, actionId: 'ability' });
    }
  }

  // 3. Heavy (35 %) or normal hit (65 %)
  const actionId = rng.chance(AI_HEAVY_CHANCE) ? 'heavy_hit' : 'normal_hit';
  const t = chooseTarget(rng, attackableTargets(input, 'enemy'));
  if (!t) return done(null);
  return done({ actorId: me.id, actionId, targetId: t.id });
}
