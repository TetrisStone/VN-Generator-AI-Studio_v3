// Simulates N battles (default 1000) of 3 standard heroes + Spark against
// 3 standard enemies. Player decisions are random (but valid); the enemy uses
// the real AI. Prints the average number of rounds.
//
//   npx tsx scripts/simulateBattles.ts [count] [seed]
import { applyAction, createBattle, endTurn, enemyTurnOrder, hasAnyValidAction, heroesOf, needsSingleTarget, resolveTargets, startTurn, validTargets, validateAction } from '../battle/engine';
import { decideEnemyAction } from '../battle/ai';
import { resolveEnemyStats, resolveHeroStats, resolveSparkStats } from '../battle/stats';
import { Rng } from '../battle/rng';
import type { ActionId, BattleAction, BattleState, CombatantInit, Side } from '../battle/types';

const COUNT = Number(process.argv[2] ?? 1000);
const BASE_SEED = Number(process.argv[3] ?? 12345);
const MAX_ROUNDS = 50;

function setup(seed: number, initiative: Side): BattleState {
  const inits: CombatantInit[] = [
    { id: 'h1', name: 'Held 1', side: 'hero', stats: resolveHeroStats(), pos: { row: 0, lane: 0 } },
    { id: 'h2', name: 'Held 2', side: 'hero', stats: resolveHeroStats(), pos: { row: 0, lane: 1 } },
    { id: 'h3', name: 'Held 3', side: 'hero', stats: resolveHeroStats(), pos: { row: 1, lane: 1 } },
    { id: 'spark', name: 'Spark', side: 'hero', isSpark: true, stats: resolveSparkStats(), pos: { row: 2, lane: 1 } },
    { id: 'e1', name: 'Gegner 1', side: 'enemy', stats: resolveEnemyStats(), pos: { row: 0, lane: 0 } },
    { id: 'e2', name: 'Gegner 2', side: 'enemy', stats: resolveEnemyStats(), pos: { row: 0, lane: 1 } },
    { id: 'e3', name: 'Gegner 3', side: 'enemy', stats: resolveEnemyStats(), pos: { row: 1, lane: 2 } },
  ];
  return startTurn(createBattle(inits, initiative, seed)).state;
}

/** All currently valid player actions */
function playerOptions(s: BattleState): BattleAction[] {
  const out: BattleAction[] = [];
  const ids: ActionId[] = ['normal_hit', 'heavy_hit', 'block', 'ability'];
  for (const h of heroesOf(s)) {
    for (const a of ids) {
      if (needsSingleTarget(h, a)) {
        for (const t of validTargets(s, h.id, a)) {
          const act = { actorId: h.id, actionId: a, targetId: t.id };
          if (!validateAction(s, act)) out.push(act);
        }
      } else if (resolveTargets(s, h, a)) {
        const act = { actorId: h.id, actionId: a };
        if (!validateAction(s, act)) out.push(act);
      }
    }
  }
  return out;
}

function runOne(seed: number): { rounds: number; outcome: string } {
  const pick = new Rng(seed ^ 0x9e3779b9);
  let s = setup(seed, pick.chance(0.5) ? 'hero' : 'enemy');
  while (s.outcome === 'ongoing' && s.round <= MAX_ROUNDS) {
    if (s.turn === 'hero') {
      while (s.outcome === 'ongoing' && hasAnyValidAction(s)) {
        const opts = playerOptions(s);
        // Random but not suicidal: blocks only rarely
        const attacks = opts.filter(o => o.actionId !== 'block');
        const pool = attacks.length > 0 && pick.chance(0.9) ? attacks : opts;
        s = applyAction(s, pick.pick(pool)).state;
      }
    } else {
      for (const id of enemyTurnOrder(s)) {
        if (s.outcome !== 'ongoing') break;
        const d = decideEnemyAction(s, id);
        s = d.state;
        if (d.action && !validateAction(s, d.action)) s = applyAction(s, d.action).state;
      }
    }
    if (s.outcome !== 'ongoing') break;
    s = endTurn(s).state;
  }
  return { rounds: s.round, outcome: s.outcome };
}

const results = Array.from({ length: COUNT }, (_, k) => runOne(BASE_SEED + k));
const rounds = results.map(r => r.rounds).sort((a, b) => a - b);
const avg = rounds.reduce((a, b) => a + b, 0) / rounds.length;
const count = (o: string) => results.filter(r => r.outcome === o).length;
const pct = (n: number) => `${((n / COUNT) * 100).toFixed(1)} %`;

console.log(`Simulierte Kämpfe:  ${COUNT} (3 Standard-Helden + Spark vs. 3 Standard-Gegner)`);
console.log(`Ø Runden:           ${avg.toFixed(2)}`);
console.log(`Median / Min / Max: ${rounds[Math.floor(rounds.length / 2)]} / ${rounds[0]} / ${rounds[rounds.length - 1]}`);
console.log(`Siege / Niederl.:   ${pct(count('victory'))} / ${pct(count('defeat'))}${count('ongoing') ? ` (abgebrochen: ${count('ongoing')})` : ''}`);
const ok = avg >= 3 && avg <= 5;
console.log(ok ? 'Ziel 3–5 Runden:    erreicht' : 'Ziel 3–5 Runden:    VERFEHLT');
process.exitCode = ok ? 0 : 1;
