import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction, attackableTargets, checkOutcome, computeDamage, createBattle, endTurn, enemyPersistence,
  getCombatant, hasAnyValidAction, previewDamage, runSparkPhase, startTurn, validateAction,
} from '../engine';
import { decideEnemyAction } from '../ai';
import { AP_PER_TURN, BLOCK_FACTOR, DIZZY_RECOVERY_HP } from '../config';
import { Rng } from '../rng';
import { enemy, hero, patch, spark, standardBattle } from './helpers';

const started = (s = standardBattle()) => startTurn(s).state;

// ---------------------------------------------------------------- damage
test('damage formula: atk 20 vs def 15 ≈ 15.4, heavy ≈ 33.8', () => {
  assert.equal(computeDamage(20, 15, 1, 1), 15);
  assert.equal(computeDamage(20, 15, 2.2, 1), 34);
  assert.equal(computeDamage(20, 15, 1, 0.9), 14);
  assert.equal(computeDamage(20, 15, 1, 1.1), 17);
  assert.equal(computeDamage(0, 30, 1, 1), 1, 'minimum damage is 1');
});

test('block halves damage before rounding', () => {
  assert.equal(computeDamage(20, 15, 1, 1, BLOCK_FACTOR), 8); // 15.38 * 0.5 = 7.69 -> 8
});

test('preview shows range and coup de grâce', () => {
  let s = started();
  assert.deepEqual(previewDamage(s, 'h1', 'e1', 1), { min: 14, max: 17, coupDeGrace: false });
  s = patch(s, 'e1', { status: 'dizzy' });
  assert.equal(previewDamage(s, 'h1', 'e1', 1)!.coupDeGrace, true);
});

test('blocked target takes half damage in the engine', () => {
  let s = started();
  s = patch(s, 'e1', { damageFactor: BLOCK_FACTOR });
  const r = applyAction(s, { actorId: 'h1', actionId: 'normal_hit', targetId: 'e1' });
  const dmg = r.events.find(e => e.type === 'damage');
  assert.ok(dmg && dmg.type === 'damage');
  assert.ok(dmg.amount >= 7 && dmg.amount <= 9, `got ${dmg.amount}`);
  assert.equal(dmg.blocked, true);
});

test('same seed -> same result (determinism)', () => {
  const a = applyAction(started(standardBattle('hero', 7)), { actorId: 'h1', actionId: 'heavy_hit', targetId: 'e2' });
  const b = applyAction(started(standardBattle('hero', 7)), { actorId: 'h1', actionId: 'heavy_hit', targetId: 'e2' });
  assert.deepEqual(a.events, b.events);
});

test('rng is seedable and in range', () => {
  const r = new Rng(1);
  for (let i = 0; i < 1000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
  }
  assert.equal(new Rng(99).next(), new Rng(99).next());
});

// ---------------------------------------------------------------- rules
test('no-duplicate rule: same action id only once per turn, different ones allowed', () => {
  let s = started();
  s = applyAction(s, { actorId: 'h1', actionId: 'normal_hit', targetId: 'e1' }).state;
  assert.match(validateAction(s, { actorId: 'h1', actionId: 'normal_hit', targetId: 'e2' })!, /schon eingesetzt/);
  assert.equal(validateAction(s, { actorId: 'h1', actionId: 'heavy_hit', targetId: 'e2' }), null);
  assert.equal(validateAction(s, { actorId: 'h2', actionId: 'normal_hit', targetId: 'e2' }), null);
});

test('no-duplicate locks reset at the next own turn', () => {
  let s = started();
  s = applyAction(s, { actorId: 'h1', actionId: 'normal_hit', targetId: 'e1' }).state;
  s = endTurn(s).state; // enemy turn
  s = endTurn(s).state; // hero turn again
  assert.equal(validateAction(s, { actorId: 'h1', actionId: 'normal_hit', targetId: 'e1' }), null);
});

test('AP: deducted per action, cannot go negative, unused AP expire', () => {
  let s = started();
  assert.equal(s.ap, AP_PER_TURN);
  s = applyAction(s, { actorId: 'h1', actionId: 'heavy_hit', targetId: 'e1' }).state;
  assert.equal(s.ap, 3);
  s = applyAction(s, { actorId: 'h2', actionId: 'heavy_hit', targetId: 'e1' }).state;
  assert.equal(s.ap, 1);
  assert.match(validateAction(s, { actorId: 'h3', actionId: 'heavy_hit', targetId: 'e2' })!, /AP/);
  s = endTurn(s).state;
  assert.equal(s.ap, 0, 'unused AP expire at turn end');
  s = endTurn(s).state;
  assert.equal(s.ap, AP_PER_TURN, 'no carry-over');
});

test('turn ends automatically when no valid action is left', () => {
  let s = started();
  for (const id of ['h1', 'h2']) s = applyAction(s, { actorId: id, actionId: 'heavy_hit', targetId: 'e3' }).state;
  s = applyAction(s, { actorId: 'h3', actionId: 'normal_hit', targetId: 'e2' }).state;
  assert.equal(s.ap, 0);
  assert.equal(hasAnyValidAction(s), false);
});

test('Spark cannot act, dizzy figures cannot act', () => {
  let s = started();
  assert.match(validateAction(s, { actorId: 'spark', actionId: 'normal_hit', targetId: 'e1' })!, /Spark/);
  s = patch(s, 'h1', { status: 'dizzy' });
  assert.ok(validateAction(s, { actorId: 'h1', actionId: 'normal_hit', targetId: 'e1' }));
});

test('block lasts until the start of the next own turn', () => {
  let s = started();
  s = applyAction(s, { actorId: 'h1', actionId: 'block' }).state;
  assert.equal(getCombatant(s, 'h1')!.damageFactor, BLOCK_FACTOR);
  s = endTurn(s).state; // enemy turn: still blocking
  assert.equal(getCombatant(s, 'h1')!.damageFactor, BLOCK_FACTOR);
  s = endTurn(s).state; // own turn starts: expires
  assert.equal(getCombatant(s, 'h1')!.damageFactor, 1);
});

// ---------------------------------------------------------------- dizzy
test('hero at 0 HP becomes dizzy; next hit defeats (coup de grâce, no damage)', () => {
  let s = endTurn(started()).state; // enemy turn
  s = patch(s, 'h1', { hp: 1 });
  s = applyAction(s, { actorId: 'e1', actionId: 'normal_hit', targetId: 'h1' }).state;
  assert.equal(getCombatant(s, 'h1')!.status, 'dizzy');
  // others active -> dizzy hero is not attackable (9.3)
  assert.ok(!attackableTargets(s, 'enemy').some(c => c.id === 'h1'));
});

test('enemy at 0 Kraft becomes dizzy; player coup de grâce defeats without damage event', () => {
  let s = started();
  s = patch(s, 'e1', { kraft: 0, status: 'dizzy' });
  const r = applyAction(s, { actorId: 'h1', actionId: 'normal_hit', targetId: 'e1' });
  assert.ok(r.events.some(e => e.type === 'coup_de_grace'));
  assert.ok(!r.events.some(e => e.type === 'damage'));
  assert.equal(getCombatant(r.state, 'e1')!.status, 'defeated');
});

test('enemy at 0 HP becomes dizzy, dizzy enemies do not recover', () => {
  let s = started();
  s = patch(s, 'e1', { hp: 1 });
  s = applyAction(s, { actorId: 'h1', actionId: 'normal_hit', targetId: 'e1' }).state;
  assert.equal(getCombatant(s, 'e1')!.status, 'dizzy');
  s = endTurn(endTurn(s).state).state;
  assert.equal(getCombatant(s, 'e1')!.status, 'dizzy');
});

// ---------------------------------------------------------------- spark
test('Spark drain mode: every active enemy loses 20 × (1 − resist) Kraft', () => {
  const s0 = createBattle([hero('h1', 0), spark(), enemy('e1', 0), enemy('boss', 1, { kraftResist: 0.5 })], 'hero', 1);
  const r = runSparkPhase(s0);
  assert.equal(r.state.sparkMode, 'drain');
  assert.equal(getCombatant(r.state, 'e1')!.kraft, 80);
  assert.equal(getCombatant(r.state, 'boss')!.kraft, 90);
});

test('Spark drain to 0 Kraft makes the enemy dizzy', () => {
  const s0 = createBattle([hero('h1', 0), spark(), enemy('e1', 0, {}, 0, 15), enemy('e2', 1)], 'hero', 1);
  const r = runSparkPhase(s0);
  assert.equal(getCombatant(r.state, 'e1')!.status, 'dizzy');
});

test('Spark heal mode: no drain, longest dizzy hero recovers after 2 phases with 30 % HP', () => {
  let s = started();
  s = { ...s, dizzyCounter: 2 };
  s = patch(s, 'h2', { status: 'dizzy', hp: 0, dizzySince: 0 });
  s = patch(s, 'h3', { status: 'dizzy', hp: 0, dizzySince: 1 });
  const kraftBefore = getCombatant(s, 'e1')!.kraft;
  let r = runSparkPhase(s);
  assert.equal(r.state.sparkMode, 'heal');
  assert.equal(getCombatant(r.state, 'h2')!.recovery, 1);
  assert.equal(getCombatant(r.state, 'h3')!.recovery, 0);
  assert.equal(getCombatant(r.state, 'e1')!.kraft, kraftBefore, 'no drain in heal mode');
  r = runSparkPhase(r.state);
  const h2 = getCombatant(r.state, 'h2')!;
  assert.equal(h2.status, 'active');
  assert.equal(h2.hp, Math.round(100 * DIZZY_RECOVERY_HP));
});

test('defeated heroes do not block the drain mode', () => {
  let s = started();
  s = patch(s, 'h1', { status: 'defeated', hp: 0 });
  assert.equal(runSparkPhase(s).state.sparkMode, 'drain');
});

test('Spark phase runs at the start of each player turn', () => {
  const s = startTurn(standardBattle()).state;
  assert.equal(getCombatant(s, 'e1')!.kraft, 80);
});

// ---------------------------------------------------------------- targets
test('target rules: enemies only hit active heroes while any hero is active', () => {
  let s = endTurn(started()).state;
  s = patch(s, 'h1', { status: 'dizzy', hp: 0 });
  const ids = attackableTargets(s, 'enemy').map(c => c.id).sort();
  assert.deepEqual(ids, ['h2', 'h3']);
});

test('target rules: no active hero -> dizzy heroes and Spark; AI prefers Spark', () => {
  let s = endTurn(started()).state;
  s = patch(s, 'h1', { status: 'dizzy', hp: 0 });
  s = patch(s, 'h2', { status: 'defeated', hp: 0 });
  s = patch(s, 'h3', { status: 'defeated', hp: 0 });
  const ids = attackableTargets(s, 'enemy').map(c => c.id).sort();
  assert.deepEqual(ids, ['h1', 'spark']);
  for (let seed = 0; seed < 20; seed++) {
    const d = decideEnemyAction({ ...s, rngState: seed }, 'e1');
    if (d.action?.targetId) assert.equal(d.action.targetId, 'spark');
  }
});

test('target rules: players may attack dizzy enemies but not defeated ones', () => {
  let s = started();
  s = patch(s, 'e1', { status: 'dizzy' });
  s = patch(s, 'e2', { status: 'defeated' });
  const ids = attackableTargets(s, 'hero').map(c => c.id).sort();
  assert.deepEqual(ids, ['e1', 'e3']);
});

// ---------------------------------------------------------------- outcome
test('victory when all enemies defeated (dizzy enemies need a coup de grâce)', () => {
  let s = started();
  s = patch(s, 'e1', { status: 'defeated' });
  s = patch(s, 'e2', { status: 'defeated' });
  s = patch(s, 'e3', { status: 'dizzy' });
  assert.equal(checkOutcome(s), 'ongoing');
  const r = applyAction(s, { actorId: 'h1', actionId: 'normal_hit', targetId: 'e3' });
  assert.equal(r.state.outcome, 'victory');
  assert.ok(r.events.some(e => e.type === 'outcome' && e.outcome === 'victory'));
});

test('defeat when Spark falls to 0 HP', () => {
  let s = endTurn(started()).state;
  for (const h of ['h1', 'h2', 'h3']) s = patch(s, h, { status: 'dizzy', hp: 0 });
  s = patch(s, 'spark', { hp: 1 });
  const r = applyAction(s, { actorId: 'e1', actionId: 'normal_hit', targetId: 'spark' });
  assert.equal(r.state.outcome, 'defeat');
  assert.equal(getCombatant(r.state, 'spark')!.status, 'active', 'Spark never wankt');
});

test('defeat when all heroes are defeated', () => {
  let s = started();
  for (const h of ['h1', 'h2', 'h3']) s = patch(s, h, { status: 'defeated', hp: 0 });
  assert.equal(checkOutcome(s), 'defeat');
});

test('Kraft is kept after a defeat; a 0-Kraft enemy starts dizzy', () => {
  let s = started(); // drain: e1 at 80
  s = patch(s, 'e1', { hp: 10 });
  const persist = enemyPersistence(s);
  assert.equal(persist.e1.kraft, 80);
  assert.equal(persist.e1.defeated, false);
  // Next fight: full HP, kept Kraft
  const s2 = createBattle([hero('h1', 0), spark(), enemy('e1', 0, {}, 0, persist.e1.kraft)], 'hero', 3);
  assert.equal(getCombatant(s2, 'e1')!.hp, 80);
  assert.equal(getCombatant(s2, 'e1')!.kraft, 80);
  const s3 = createBattle([hero('h1', 0), spark(), enemy('e1', 0, {}, 0, 0)], 'hero', 3);
  assert.equal(getCombatant(s3, 'e1')!.status, 'dizzy');
});

// ---------------------------------------------------------------- abilities
test('abilities: whirl hits the whole front row, mend heals, warcry buffs until turn end', () => {
  const s0 = createBattle(
    [hero('h1', 0, { abilityId: 'whirl' }), hero('h2', 1, { abilityId: 'mend' }), hero('h3', 2, { abilityId: 'warcry' }), spark(),
     enemy('e1', 0), enemy('e2', 1), enemy('e3', 2, {}, 1)],
    'hero', 5);
  let s = startTurn(s0).state;
  let r = applyAction(s, { actorId: 'h1', actionId: 'ability' });
  const hit = r.events.filter(e => e.type === 'damage').map(e => (e as any).targetId).sort();
  assert.deepEqual(hit, ['e1', 'e2']);
  assert.equal(r.state.ap, 2);
  s = patch(r.state, 'h1', { hp: 40 });
  r = applyAction(s, { actorId: 'h2', actionId: 'ability', targetId: 'h1' });
  assert.equal(getCombatant(r.state, 'h1')!.hp, 75);
  s = endTurn(r.state).state;
  s = endTurn(s).state;
  r = applyAction(s, { actorId: 'h3', actionId: 'ability' });
  assert.ok(Math.abs(getCombatant(r.state, 'h1')!.atkBuff - 0.3) < 1e-9);
  s = endTurn(r.state).state;
  assert.equal(getCombatant(s, 'h1')!.atkBuff, 0);
});

test('abilities: exhaust drains 25 Kraft, shieldwall guards an ally', () => {
  const s0 = createBattle([hero('h1', 0, { abilityId: 'exhaust' }), hero('h2', 1, { abilityId: 'shieldwall' }), spark(), enemy('e1', 0)], 'hero', 5);
  let s = startTurn(s0).state; // drain -> 80
  s = applyAction(s, { actorId: 'h1', actionId: 'ability', targetId: 'e1' }).state;
  assert.equal(getCombatant(s, 'e1')!.kraft, 55);
  s = applyAction(s, { actorId: 'h2', actionId: 'ability', targetId: 'h1' }).state;
  assert.equal(getCombatant(s, 'h1')!.damageFactor, 0.5);
});

test('applyAction does not mutate the input state', () => {
  const s = started();
  const snap = JSON.stringify(s);
  applyAction(s, { actorId: 'h1', actionId: 'normal_hit', targetId: 'e1' });
  assert.equal(JSON.stringify(s), snap);
});
