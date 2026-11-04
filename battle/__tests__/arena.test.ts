import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkOfTile, gridToLocal, gridToWorldTile, localOf, localToGrid, placeSide, selectArena, type Chunk } from '../arena';
import { bresenhamLine, chooseRespawnTile, detectEncounter, hasLineOfSight, selectEnemyGroup } from '../detection';

const fitsSet = (list: Array<[number, number]>) => {
  const s = new Set(list.map(([x, z]) => `${x},${z}`));
  return (c: Chunk) => s.has(`${c.cx},${c.cz}`);
};
const noWarn = () => {};

// ---------------------------------------------------------------- coordinates
test('chunk / local index convention matches doorApproachTile (cellX*3 + {-1,0,1})', () => {
  assert.deepEqual(chunkOfTile({ col: -1, row: 1 }), { cx: 0, cz: 0 });
  assert.deepEqual(chunkOfTile({ col: 2, row: -2 }), { cx: 1, cz: -1 });
  assert.deepEqual(chunkOfTile({ col: 4, row: 0 }), { cx: 1, cz: 0 });
  assert.deepEqual(localOf({ col: 2, row: 4 }, { cx: 1, cz: 1 }), { i: 0, j: 2 });
});

test('localToGrid / gridToLocal are inverse for every direction', () => {
  const dirs = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
  for (const d of dirs) for (const side of ['hero', 'enemy'] as const)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      assert.deepEqual(gridToLocal(side, localToGrid(side, i, j, d), d), { i, j });
    }
});

test('row 0 of both sides touches the shared edge, lanes are opposite', () => {
  const arena = selectArena({ leaderTile: { col: 0, row: 0 }, enemyTile: { col: 4, row: 0 }, fits: () => true });
  assert.deepEqual(arena.d, { x: 1, z: 0 });
  const h = gridToWorldTile(arena, 'hero', { row: 0, lane: 2 });
  const e = gridToWorldTile(arena, 'enemy', { row: 0, lane: 2 });
  assert.equal(e.col - h.col, 1, 'front tiles are adjacent across the edge');
  assert.equal(h.row, e.row, 'same lane = directly opposite');
});

// ---------------------------------------------------------------- arena selection
test('arena: direct B = A + d', () => {
  const a = selectArena({ leaderTile: { col: 0, row: 0 }, enemyTile: { col: 0, row: 3 }, fits: fitsSet([[0, 0], [0, 1]]) });
  assert.deepEqual([a.a, a.b, a.d, a.method], [{ cx: 0, cz: 0 }, { cx: 0, cz: 1 }, { x: 0, z: 1 }, 'direct']);
});

test('arena: tie on axes -> axis of last movement', () => {
  const a = selectArena({ leaderTile: { col: 0, row: 0 }, enemyTile: { col: 3, row: 3 }, lastMoveDir: { x: 1, z: 0 }, fits: () => true });
  assert.deepEqual(a.d, { x: 1, z: 0 });
  const b = selectArena({ leaderTile: { col: 0, row: 0 }, enemyTile: { col: 3, row: 3 }, lastMoveDir: { x: 0, z: -1 }, fits: () => true });
  assert.deepEqual(b.d, { x: 0, z: 1 });
});

test('arena: v = 0 -> movement direction of the leader', () => {
  const a = selectArena({ leaderTile: { col: 0, row: 0 }, enemyTile: { col: 0, row: 0 }, lastMoveDir: { x: -1, z: 0 }, fits: () => true });
  assert.deepEqual(a.d, { x: -1, z: 0 });
});

test('arena: other axis when direct fails and v != 0 there', () => {
  const a = selectArena({ leaderTile: { col: 0, row: 0 }, enemyTile: { col: 4, row: 2 }, fits: fitsSet([[0, 0], [0, 1]]) });
  assert.equal(a.method, 'other_axis');
  assert.deepEqual(a.b, { cx: 0, cz: 1 });
});

test('arena: other axis skipped when v = 0 there, retreat instead', () => {
  const a = selectArena({ leaderTile: { col: 0, row: 0 }, enemyTile: { col: 4, row: 0 }, fits: fitsSet([[0, 0], [-1, 0], [0, 1]]) });
  assert.equal(a.method, 'retreat');
  assert.deepEqual([a.a, a.b], [{ cx: -1, cz: 0 }, { cx: 0, cz: 0 }]);
});

test('arena: any neighbour pair, B closest to the enemy', () => {
  // direct (1,0) / other axis (0,1) / retreat (-1,0) all fail; candidates: A+(0,-1) and A-(0,1)=(0,-1) as A'
  const a = selectArena({ leaderTile: { col: 0, row: 0 }, enemyTile: { col: 5, row: 1 }, fits: fitsSet([[0, 0], [0, -1]]) });
  assert.equal(a.method, 'any_neighbor');
  assert.deepEqual(a.b, { cx: 0, cz: 0 }, 'B = A is closer to the enemy than (0,-1)');
});

test('arena: forced fallback never fails and warns', () => {
  let warned = '';
  const a = selectArena({ leaderTile: { col: 0, row: 0 }, enemyTile: { col: 0, row: -4 }, fits: () => false, warn: m => (warned = m) });
  assert.equal(a.method, 'forced');
  assert.deepEqual(a.b, { cx: 0, cz: -1 });
  assert.ok(warned.length > 0);
});

// ---------------------------------------------------------------- placement
test('placement: follows the walking order (front walker stands in front)', () => {
  const arena = selectArena({ leaderTile: { col: 1, row: 0 }, enemyTile: { col: 4, row: 0 }, fits: () => true, warn: noWarn });
  const res = placeSide([
    { id: 'leader', col: 1, row: 0 },
    { id: 'f1', col: 0, row: 0 },
    { id: 'f2', col: -1, row: 0 },
  ], 'hero', arena);
  assert.deepEqual(res.get('leader'), { row: 0, lane: 1 });
  assert.deepEqual(res.get('f1'), { row: 1, lane: 1 });
  assert.deepEqual(res.get('f2'), { row: 2, lane: 1 });
});

test('placement: out-of-chunk tiles are clamped', () => {
  const arena = selectArena({ leaderTile: { col: 1, row: 0 }, enemyTile: { col: 4, row: 0 }, fits: () => true, warn: noWarn });
  const res = placeSide([{ id: 'x', col: -5, row: 9 }], 'hero', arena);
  assert.deepEqual(res.get('x'), { row: 2, lane: 2 });
});

test('placement collisions: hero -> same lane, further back on ties', () => {
  const arena = selectArena({ leaderTile: { col: 1, row: 0 }, enemyTile: { col: 4, row: 0 }, fits: () => true, warn: noWarn });
  const res = placeSide([
    { id: 'a', col: 0, row: 0 }, // row 1 lane 1
    { id: 'b', col: 0, row: 0 }, // collides -> row 2 lane 1 (same lane, further back)
    { id: 'c', col: 0, row: 0 }, // collides -> row 0 lane 1 (same lane, dist 1)
    { id: 'd', col: 0, row: 0 }, // -> dist 1 other lanes: (1,0) / (1,2) -> lane 0 first
  ], 'hero', arena);
  assert.deepEqual(res.get('a'), { row: 1, lane: 1 });
  assert.deepEqual(res.get('b'), { row: 2, lane: 1 });
  assert.deepEqual(res.get('c'), { row: 0, lane: 1 });
  assert.deepEqual(res.get('d'), { row: 1, lane: 0 });
});

test('placement collisions: enemy -> same lane, further front on ties', () => {
  const arena = selectArena({ leaderTile: { col: 1, row: 0 }, enemyTile: { col: 4, row: 0 }, fits: () => true, warn: noWarn });
  const res = placeSide([
    { id: 'a', col: 3, row: 0 }, // B local i=1 -> row 1
    { id: 'b', col: 3, row: 0 }, // -> row 0 lane 1 (front wins tie)
  ], 'enemy', arena);
  assert.deepEqual(res.get('a'), { row: 1, lane: 1 });
  assert.deepEqual(res.get('b'), { row: 0, lane: 1 });
});

test('placement: unique tiles for 6 enemies on the same spot', () => {
  const arena = selectArena({ leaderTile: { col: 1, row: 0 }, enemyTile: { col: 4, row: 0 }, fits: () => true, warn: noWarn });
  const res = placeSide(Array.from({ length: 6 }, (_, k) => ({ id: `e${k}`, col: 3, row: 0 })), 'enemy', arena);
  const keys = new Set([...res.values()].map(p => `${p.row},${p.lane}`));
  assert.equal(keys.size, 6);
});

// ---------------------------------------------------------------- detection
test('bresenham line endpoints and line of sight', () => {
  const line = bresenhamLine({ col: 0, row: 0 }, { col: 3, row: 1 });
  assert.deepEqual(line[0], { col: 0, row: 0 });
  assert.deepEqual(line[line.length - 1], { col: 3, row: 1 });
  const walk = (c: number, r: number) => !(c === 1 && r === 0);
  assert.equal(hasLineOfSight({ col: 0, row: 0 }, { col: 3, row: 0 }, walk), false);
  assert.equal(hasLineOfSight({ col: 0, row: 1 }, { col: 3, row: 1 }, walk), true);
});

test('detection: first strike / ambush / tie resolution', () => {
  const walk = () => true;
  const base = { leader: { col: 0, row: 0 }, members: [{ col: 0, row: 0 }, { col: 0, row: -1 }], walkable: walk };
  // Hero INI 4 sees enemy at dist 4; enemy INI 3 doesn't
  assert.deepEqual(detectEncounter({ ...base, leaderIni: 4, enemies: [{ id: 'e', col: 4, row: 0, ini: 3 }] }),
    { triggerId: 'e', initiative: 'hero', kind: 'first_strike' });
  // Enemy behind the party sees the last member (ambush from behind)
  assert.deepEqual(detectEncounter({ ...base, leaderIni: 2, enemies: [{ id: 'e', col: 0, row: -4, ini: 3 }] }),
    { triggerId: 'e', initiative: 'enemy', kind: 'ambush' });
  // Both see -> higher INI wins, tie -> players
  assert.equal(detectEncounter({ ...base, leaderIni: 3, enemies: [{ id: 'e', col: 2, row: 0, ini: 5 }] })!.initiative, 'enemy');
  assert.equal(detectEncounter({ ...base, leaderIni: 5, enemies: [{ id: 'e', col: 2, row: 0, ini: 5 }] })!.initiative, 'hero');
  assert.equal(detectEncounter({ ...base, leaderIni: 4, enemies: [{ id: 'e', col: 9, row: 0, ini: 3 }] }), null);
});

test('enemy group: groupId vs radius, capped at 6, nearest first', () => {
  const pool = [
    { id: 't', col: 0, row: 0, ini: 3 },
    { id: 'near', col: 2, row: 0, ini: 3 },
    { id: 'far', col: 9, row: 0, ini: 3 },
  ];
  assert.deepEqual(selectEnemyGroup(pool[0], pool).map(e => e.id), ['t', 'near']);
  const g = pool.map(p => ({ ...p, groupId: p.id === 'near' ? undefined : 'g' }));
  assert.deepEqual(selectEnemyGroup(g[0], g).map(e => e.id), ['t', 'far']);
  const many = Array.from({ length: 9 }, (_, k) => ({ id: `e${k}`, col: k % 3, row: Math.floor(k / 3), ini: 3 }));
  assert.equal(selectEnemyGroup(many[0], many).length, 6);
});

test('respawn: newest breadcrumb outside all sight ranges, else oldest', () => {
  const trail = [{ col: -10, row: 0 }, { col: -6, row: 0 }, { col: -2, row: 0 }, { col: 0, row: 0 }];
  assert.deepEqual(chooseRespawnTile(trail, [{ col: 2, row: 0, ini: 4 }]), { col: -6, row: 0 });
  assert.deepEqual(chooseRespawnTile(trail, [{ col: 2, row: 0, ini: 50 }]), { col: -10, row: 0 });
});
