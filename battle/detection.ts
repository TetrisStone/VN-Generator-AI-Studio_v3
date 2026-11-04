// Pure functions: initiative range, line of sight, initiative decision,
// enemy group selection and defeat respawn tile (sections 2 + 12).
import { ENEMY_GROUP_RADIUS, MAX_ENEMIES } from './config';
import type { Side } from './types';

export interface Tile {
  col: number;
  row: number;
}

/** Walkability predicate, already scoped to the current section */
export type WalkableFn = (col: number, row: number) => boolean;

export interface EnemyCandidate extends Tile {
  id: string;
  ini: number;
  groupId?: string;
}

export function tileDist(a: Tile, b: Tile): number {
  return Math.hypot(a.col - b.col, a.row - b.row);
}

/** All tiles on the Bresenham line from a to b (both inclusive) */
export function bresenhamLine(a: Tile, b: Tile): Tile[] {
  const out: Tile[] = [];
  let x0 = a.col;
  let y0 = a.row;
  const x1 = b.col;
  const y1 = b.row;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  // guard against non-integer input
  for (let guard = 0; guard < 10000; guard++) {
    out.push({ col: x0, row: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}

export function hasLineOfSight(a: Tile, b: Tile, walkable: WalkableFn): boolean {
  return bresenhamLine(a, b).every(t => walkable(t.col, t.row));
}

export function heroesSeeEnemy(leader: Tile, leaderIni: number, enemy: Tile, walkable: WalkableFn): boolean {
  return tileDist(leader, enemy) <= leaderIni && hasLineOfSight(leader, enemy, walkable);
}

/** Distance is measured to the NEAREST party member (ambush from behind) */
export function enemySeesHeroes(enemy: Tile, enemyIni: number, members: Tile[], walkable: WalkableFn): boolean {
  if (members.length === 0) return false;
  let nearest = members[0];
  let best = Infinity;
  for (const m of members) {
    const d = tileDist(enemy, m);
    if (d < best) {
      best = d;
      nearest = m;
    }
  }
  return best <= enemyIni && hasLineOfSight(enemy, nearest, walkable);
}

export interface EncounterInput {
  leader: Tile;
  leaderIni: number;
  /** All party members incl. leader and Spark */
  members: Tile[];
  /** Only enemies of the current section that are not defeated */
  enemies: EnemyCandidate[];
  walkable: WalkableFn;
}

export interface Encounter {
  triggerId: string;
  initiative: Side;
  kind: 'first_strike' | 'ambush';
}

/** Section 2.2/2.3. Returns null when nobody sees anybody. */
export function detectEncounter(input: EncounterInput): Encounter | null {
  const { leader, leaderIni, members, enemies, walkable } = input;
  const seenByHeroes: EnemyCandidate[] = [];
  const seeingHeroes: EnemyCandidate[] = [];
  for (const e of enemies) {
    if (heroesSeeEnemy(leader, leaderIni, e, walkable)) seenByHeroes.push(e);
    if (enemySeesHeroes(e, e.ini, members, walkable)) seeingHeroes.push(e);
  }
  if (seenByHeroes.length === 0 && seeingHeroes.length === 0) return null;

  const nearest = (list: EnemyCandidate[]) =>
    [...list].sort((a, b) => tileDist(leader, a) - tileDist(leader, b) || a.id.localeCompare(b.id))[0];

  if (seeingHeroes.length === 0) {
    return { triggerId: nearest(seenByHeroes).id, initiative: 'hero', kind: 'first_strike' };
  }
  if (seenByHeroes.length === 0) {
    return { triggerId: nearest(seeingHeroes).id, initiative: 'enemy', kind: 'ambush' };
  }
  // Both sides see each other in the same step: higher INI wins, ties -> players
  const union = [...new Map([...seenByHeroes, ...seeingHeroes].map(e => [e.id, e])).values()];
  const trigger = nearest(union);
  const heroesWin = leaderIni >= trigger.ini;
  return {
    triggerId: trigger.id,
    initiative: heroesWin ? 'hero' : 'enemy',
    kind: heroesWin ? 'first_strike' : 'ambush',
  };
}

/**
 * Section 2.4: participating enemies. `pool` = enemies of the same section
 * that are not defeated. Result is sorted nearest-to-trigger first and
 * capped at MAX_ENEMIES (the trigger is always included).
 */
export function selectEnemyGroup(trigger: EnemyCandidate, pool: EnemyCandidate[]): EnemyCandidate[] {
  const all = pool.some(p => p.id === trigger.id) ? pool : [trigger, ...pool];
  const members = trigger.groupId
    ? all.filter(e => e.groupId === trigger.groupId)
    : all.filter(e => e.id === trigger.id || tileDist(e, trigger) <= ENEMY_GROUP_RADIUS);
  return members
    .sort((a, b) => tileDist(a, trigger) - tileDist(b, trigger) || a.id.localeCompare(b.id))
    .slice(0, MAX_ENEMIES);
}

/**
 * Section 12 (defeat): the most recent breadcrumb outside the sight range of
 * all involved enemies; otherwise the oldest tile of the trail.
 * `trail` is ordered oldest -> newest.
 */
export function chooseRespawnTile(trail: Tile[], enemies: Array<Tile & { ini: number }>): Tile | null {
  if (trail.length === 0) return null;
  for (let k = trail.length - 1; k >= 0; k--) {
    const t = trail[k];
    if (enemies.every(e => tileDist(t, e) > e.ini)) return t;
  }
  return trail[0];
}
