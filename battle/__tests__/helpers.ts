import { createBattle } from '../engine';
import { resolveEnemyStats, resolveHeroStats, resolveSparkStats } from '../stats';
import type { BattleState, CombatantInit, Side } from '../types';

export function hero(id: string, lane: number, over: Partial<CombatantInit['stats']> = {}, row = 0): CombatantInit {
  return { id, name: id, side: 'hero', stats: { ...resolveHeroStats(), ...over }, pos: { row, lane } };
}
export function spark(id = 'spark'): CombatantInit {
  return { id, name: 'Spark', side: 'hero', isSpark: true, stats: resolveSparkStats(), pos: { row: 2, lane: 1 } };
}
export function enemy(id: string, lane: number, over: Partial<CombatantInit['stats']> = {}, row = 0, kraft?: number): CombatantInit {
  return { id, name: id, side: 'enemy', stats: { ...resolveEnemyStats(), ...over }, pos: { row, lane }, kraft, placementId: id };
}

/** Standard party: 3 heroes + Spark vs. 3 enemies */
export function standardBattle(initiative: Side = 'hero', seed = 42): BattleState {
  return createBattle(
    [hero('h1', 0), hero('h2', 1), hero('h3', 2), spark(), enemy('e1', 0), enemy('e2', 1), enemy('e3', 2)],
    initiative,
    seed
  );
}

export function patch(s: BattleState, id: string, p: Partial<BattleState['combatants'][number]>): BattleState {
  return { ...s, combatants: s.combatants.map(c => (c.id === id ? { ...c, ...p } : c)) };
}
