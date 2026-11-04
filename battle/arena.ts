// Pure functions: arena chunk selection (section 3) and tile placement (section 4).
//
// Coordinate convention (verified against DungeonTestView.refreshWalkableTiles
// and doorApproachTile): chunk cellX owns world sub-tiles cellX*3 + {-1,0,1}.
//   cellX = floor((col + 1) / 3),  local i = col - cellX*3 + 1  (0..2)
// Same for row / cellZ / j.
import type { GridPos, Side } from './types';
import type { Tile } from './detection';

export interface Chunk {
  cx: number;
  cz: number;
}
export interface Dir {
  x: number;
  z: number;
}

export type ArenaMethod = 'direct' | 'other_axis' | 'retreat' | 'any_neighbor' | 'forced';

export interface Arena {
  /** Hero chunk */
  a: Chunk;
  /** Enemy chunk */
  b: Chunk;
  /** Unit direction A -> B */
  d: Dir;
  method: ArenaMethod;
}

export function chunkOfTile(t: Tile): Chunk {
  return { cx: Math.floor((t.col + 1) / 3), cz: Math.floor((t.row + 1) / 3) };
}

/** Local indices of a world tile relative to a chunk (may be outside 0..2) */
export function localOf(t: Tile, c: Chunk): { i: number; j: number } {
  return { i: t.col - c.cx * 3 + 1, j: t.row - c.cz * 3 + 1 };
}

export function worldTileOf(c: Chunk, i: number, j: number): Tile {
  return { col: c.cx * 3 + i - 1, row: c.cz * 3 + j - 1 };
}

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const add = (c: Chunk, d: Dir): Chunk => ({ cx: c.cx + d.x, cz: c.cz + d.z });
const sub = (c: Chunk, d: Dir): Chunk => ({ cx: c.cx - d.x, cz: c.cz - d.z });

export interface ArenaInput {
  leaderTile: Tile;
  enemyTile: Tile;
  /** Last movement direction of the leader (unit vector), default (0,1) */
  lastMoveDir?: Dir | null;
  /** Arena suitability: floor chunk of the current section with all 9 sub-tiles walkable */
  fits: (c: Chunk) => boolean;
  /** Optional logger for the forced fallback */
  warn?: (msg: string) => void;
}

function normalizedMove(m?: Dir | null): Dir {
  if (!m || (m.x === 0 && m.z === 0)) return { x: 0, z: 1 };
  if (Math.abs(m.x) >= Math.abs(m.z)) return { x: sign(m.x), z: 0 };
  return { x: 0, z: sign(m.z) };
}

/** Dominant axis of v (tie -> axis of last movement, v = 0 -> last movement) */
export function primaryDirection(v: Dir, lastMove?: Dir | null): Dir {
  const ax = Math.abs(v.x);
  const az = Math.abs(v.z);
  if (ax === 0 && az === 0) return normalizedMove(lastMove);
  if (ax > az) return { x: sign(v.x), z: 0 };
  if (az > ax) return { x: 0, z: sign(v.z) };
  const m = normalizedMove(lastMove);
  return m.x !== 0 ? { x: sign(v.x), z: 0 } : { x: 0, z: sign(v.z) };
}

const chunkCenterTile = (c: Chunk): Tile => ({ col: c.cx * 3, row: c.cz * 3 });

export function selectArena(input: ArenaInput): Arena {
  const { leaderTile, enemyTile, lastMoveDir, fits } = input;
  const A = chunkOfTile(leaderTile);
  const v: Dir = { x: enemyTile.col - leaderTile.col, z: enemyTile.row - leaderTile.row };
  const d = primaryDirection(v, lastMoveDir);
  const pairOk = (a: Chunk, b: Chunk) => fits(a) && fits(b);

  // 1. B = A + d
  if (pairOk(A, add(A, d))) return { a: A, b: add(A, d), d, method: 'direct' };

  // 2. Other axis, if v is non-zero there
  const other: Dir = d.x !== 0 ? { x: 0, z: sign(v.z) } : { x: sign(v.x), z: 0 };
  if ((other.x !== 0 || other.z !== 0) && pairOk(A, add(A, other))) {
    return { a: A, b: add(A, other), d: other, method: 'other_axis' };
  }

  // 3. Retreat one chunk: A' = A - d, B' = A
  if (pairOk(sub(A, d), A)) return { a: sub(A, d), b: A, d, method: 'retreat' };

  // 4. Any suitable neighbour pair containing A; B closest to the enemy
  const dirs: Dir[] = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
  let best: Arena | null = null;
  let bestDist = Infinity;
  for (const e of dirs) {
    const pairs: Array<[Chunk, Chunk]> = [[A, add(A, e)], [sub(A, e), A]];
    for (const [a, b] of pairs) {
      if (!pairOk(a, b)) continue;
      const c = chunkCenterTile(b);
      const dist = Math.hypot(c.col - enemyTile.col, c.row - enemyTile.row);
      if (dist < bestDist - 1e-9) {
        bestDist = dist;
        best = { a, b, d: e, method: 'any_neighbor' };
      }
    }
  }
  if (best) return best;

  // 5. Forced: a fight must never fail on the arena setup
  (input.warn ?? ((m: string) => console.warn(m)))(
    `[battle] Keine taugliche Arena gefunden – Grids werden erzwungen auf (${A.cx},${A.cz}) / (${A.cx + d.x},${A.cz + d.z}).`
  );
  return { a: A, b: add(A, d), d, method: 'forced' };
}

// ---------------------------------------------------------------------------
// Placement (section 4)
// ---------------------------------------------------------------------------

const clamp02 = (n: number) => Math.max(0, Math.min(2, n));

/** Table 4.1: local (i, j) -> (row, lane) */
export function localToGrid(side: Side, i: number, j: number, d: Dir): GridPos {
  const hero = side === 'hero';
  if (d.x === 1) return { row: hero ? 2 - i : i, lane: j };
  if (d.x === -1) return { row: hero ? i : 2 - i, lane: j };
  if (d.z === 1) return { row: hero ? 2 - j : j, lane: i };
  return { row: hero ? j : 2 - j, lane: i }; // d.z === -1
}

/** Inverse of localToGrid */
export function gridToLocal(side: Side, pos: GridPos, d: Dir): { i: number; j: number } {
  const hero = side === 'hero';
  const { row, lane } = pos;
  if (d.x === 1) return { i: hero ? 2 - row : row, j: lane };
  if (d.x === -1) return { i: hero ? row : 2 - row, j: lane };
  if (d.z === 1) return { i: lane, j: hero ? 2 - row : row };
  return { i: lane, j: hero ? row : 2 - row };
}

/** World tile of a grid position */
export function gridToWorldTile(arena: Arena, side: Side, pos: GridPos): Tile {
  const { i, j } = gridToLocal(side, pos, arena.d);
  return worldTileOf(side === 'hero' ? arena.a : arena.b, i, j);
}

export interface PlacementEntry extends Tile {
  id: string;
}

/**
 * Places entries (already in processing order) on the 3x3 grid of their side.
 * Collisions: nearest free tile by Manhattan distance in (row, lane); ties ->
 * same lane, then further back (heroes) / further front (enemies).
 */
export function placeSide(entries: PlacementEntry[], side: Side, arena: Arena): Map<string, GridPos> {
  const chunk = side === 'hero' ? arena.a : arena.b;
  const taken = new Set<string>();
  const result = new Map<string, GridPos>();
  const key = (p: GridPos) => `${p.row},${p.lane}`;
  for (const e of entries) {
    const loc = localOf(e, chunk);
    const want = localToGrid(side, clamp02(loc.i), clamp02(loc.j), arena.d);
    let chosen: GridPos | null = null;
    if (!taken.has(key(want))) {
      chosen = want;
    } else {
      const free: GridPos[] = [];
      for (let row = 0; row < 3; row++) for (let lane = 0; lane < 3; lane++) {
        if (!taken.has(`${row},${lane}`)) free.push({ row, lane });
      }
      free.sort((p, q) => {
        const dp = Math.abs(p.row - want.row) + Math.abs(p.lane - want.lane);
        const dq = Math.abs(q.row - want.row) + Math.abs(q.lane - want.lane);
        if (dp !== dq) return dp - dq;
        const sp = p.lane === want.lane ? 0 : 1;
        const sq = q.lane === want.lane ? 0 : 1;
        if (sp !== sq) return sp - sq;
        if (p.row !== q.row) return side === 'hero' ? q.row - p.row : p.row - q.row;
        return p.lane - q.lane;
      });
      chosen = free[0] ?? null;
    }
    if (!chosen) continue; // > 9 figures: cannot happen (max 4 heroes / 6 enemies)
    taken.add(key(chosen));
    result.set(e.id, chosen);
  }
  return result;
}
