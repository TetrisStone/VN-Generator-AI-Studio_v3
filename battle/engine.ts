// Battle engine — pure, no React, no Three.js.
// Every mutating entry point takes a state and returns { state, events }.
// The input state is never modified (structuredClone).
import {
  ACTION_AP, AP_PER_TURN, BLOCK_FACTOR, DEF_CONSTANT, DIZZY_RECOVERY_HP, DIZZY_RECOVERY_PULSES,
  HEAVY_MULT, NORMAL_MULT, SPARK_DRAIN, VARIANCE, DEFAULT_ENEMY_COOLDOWN,
} from './config';
import { getAbility, type AbilityDef } from './abilities';
import { Rng } from './rng';
import type {
  ActionId, ActionResult, BattleAction, BattleEvent, BattleState, Combatant, CombatantInit, Outcome, Side,
} from './types';

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createCombatant(init: CombatantInit): Combatant {
  const isSpark = !!init.isSpark;
  const maxKraft = init.side === 'enemy' ? init.stats.maxKraft : 0;
  const kraft = init.side === 'enemy' ? Math.max(0, Math.min(maxKraft, init.kraft ?? maxKraft)) : 0;
  return {
    id: init.id,
    name: init.name,
    side: init.side,
    isSpark,
    stats: { ...init.stats, maxKraft },
    hp: init.stats.maxHp,
    kraft,
    // An enemy that enters with 0 Kraft (kept from a lost fight) is already dizzy
    status: init.side === 'enemy' && maxKraft > 0 && kraft <= 0 ? 'dizzy' : 'active',
    pos: { ...init.pos },
    damageFactor: 1,
    atkBuff: 0,
    dizzySince: null,
    recovery: 0,
    usedActions: [],
    abilityCooldown: 0,
    placementId: init.placementId,
    characterId: init.characterId,
  };
}

/** Creates a battle. The first turn is NOT started yet — call startTurn(). */
export function createBattle(inits: CombatantInit[], initiative: Side, seed: number): BattleState {
  return {
    round: 1,
    turn: initiative,
    initiative,
    ap: 0,
    combatants: inits.map(createCombatant),
    outcome: 'ongoing',
    sparkMode: null,
    rngState: seed >>> 0,
    dizzyCounter: 0,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getCombatant = (s: BattleState, id: string) => s.combatants.find(c => c.id === id);
export const heroesOf = (s: BattleState) => s.combatants.filter(c => c.side === 'hero' && !c.isSpark);
export const sparkOf = (s: BattleState) => s.combatants.find(c => c.side === 'hero' && c.isSpark);
export const enemiesOf = (s: BattleState) => s.combatants.filter(c => c.side === 'enemy');

export function actionApCost(actor: Combatant, actionId: ActionId): number {
  if (actionId === 'ability') return getAbility(actor.stats.abilityId)?.apCost ?? Infinity;
  return ACTION_AP[actionId];
}

export function canAct(c: Combatant): boolean {
  return c.status === 'active' && !c.isSpark;
}

/**
 * Section 9.3 — who may be attacked (offensive single target).
 * Players: every enemy that is not defeated (dizzy -> coup de grâce).
 * Enemies: active heroes; dizzy heroes and Spark only when no hero is active.
 */
export function attackableTargets(s: BattleState, attackerSide: Side): Combatant[] {
  if (attackerSide === 'hero') return enemiesOf(s).filter(e => e.status !== 'defeated');
  const heroes = heroesOf(s);
  const active = heroes.filter(h => h.status === 'active');
  if (active.length > 0) return active;
  const out = heroes.filter(h => h.status === 'dizzy');
  const spark = sparkOf(s);
  if (spark && spark.hp > 0) out.push(spark);
  return out;
}

function frontRowOf(list: Combatant[]): Combatant[] {
  if (list.length === 0) return [];
  const minRow = Math.min(...list.map(c => c.pos.row));
  return list.filter(c => c.pos.row === minRow);
}

/** Targets an action resolves to. `targetId` selects the single target. */
export function resolveTargets(s: BattleState, actor: Combatant, actionId: ActionId, targetId?: string): Combatant[] | null {
  const foeSide: Side = actor.side === 'hero' ? 'enemy' : 'hero';
  const allies = s.combatants.filter(c => c.side === actor.side && c.status === 'active');
  const pickOne = (pool: Combatant[]) => {
    const t = pool.find(c => c.id === targetId);
    return t ? [t] : null;
  };
  if (actionId === 'normal_hit' || actionId === 'heavy_hit') return pickOne(attackableTargets(s, actor.side));
  if (actionId === 'block') return [actor];
  const ab = getAbility(actor.stats.abilityId);
  if (!ab) return null;
  switch (ab.target) {
    case 'enemy':
      return pickOne(attackableTargets(s, actor.side));
    case 'all_enemies_front_row': {
      const r = frontRowOf(attackableTargets(s, actor.side));
      return r.length ? r : null;
    }
    case 'all_enemies': {
      const r = attackableTargets(s, actor.side);
      return r.length ? r : null;
    }
    case 'ally':
      return pickOne(allies);
    case 'self':
      return [actor];
    case 'all_allies': {
      const r = allies.filter(c => !c.isSpark);
      return r.length ? r : null;
    }
  }
  void foeSide;
  return null;
}

/** Whether the action needs the player to click a single target */
export function needsSingleTarget(actor: Combatant, actionId: ActionId): boolean {
  if (actionId === 'normal_hit' || actionId === 'heavy_hit') return true;
  if (actionId === 'block') return false;
  const ab = getAbility(actor.stats.abilityId);
  return !!ab && (ab.target === 'enemy' || ab.target === 'ally');
}

/** Candidate targets for the UI / AI (single-target actions: clickable ids) */
export function validTargets(s: BattleState, actorId: string, actionId: ActionId): Combatant[] {
  const actor = getCombatant(s, actorId);
  if (!actor) return [];
  if (actionId === 'normal_hit' || actionId === 'heavy_hit') return attackableTargets(s, actor.side);
  if (actionId === 'block') return [actor];
  const ab = getAbility(actor.stats.abilityId);
  if (!ab) return [];
  if (ab.target === 'enemy') return attackableTargets(s, actor.side);
  if (ab.target === 'ally') return s.combatants.filter(c => c.side === actor.side && c.status === 'active');
  return resolveTargets(s, actor, actionId) ?? [];
}

/** Returns null if the action is allowed, otherwise a human readable reason */
export function validateAction(s: BattleState, action: BattleAction): string | null {
  if (s.outcome !== 'ongoing') return 'Der Kampf ist vorbei.';
  const actor = getCombatant(s, action.actorId);
  if (!actor) return 'Unbekannte Figur.';
  if (actor.isSpark) return 'Spark kann keine Aktionen ausführen.';
  if (actor.side !== s.turn) return 'Diese Seite ist nicht am Zug.';
  if (actor.status !== 'active') return 'Wankende oder besiegte Figuren können nicht handeln.';
  if (actor.usedActions.includes(action.actionId)) return 'Diese Aktion wurde in diesem Zug schon eingesetzt.';
  if (actor.side === 'enemy' && actor.usedActions.length > 0) return 'Gegner führen nur eine Aktion pro Zug aus.';
  if (action.actionId === 'ability' && !getAbility(actor.stats.abilityId)) return 'Keine Fähigkeit vorhanden.';
  if (actor.side === 'hero' && actionApCost(actor, action.actionId) > s.ap) return 'Nicht genug AP.';
  if (!resolveTargets(s, actor, action.actionId, action.targetId)) return 'Ungültiges Ziel.';
  return null;
}

export const ALL_ACTION_IDS: ActionId[] = ['normal_hit', 'heavy_hit', 'block', 'ability'];

/** null = the action can be chosen now (some valid target exists); otherwise the reason */
export function actionUnavailableReason(s: BattleState, actorId: string, actionId: ActionId): string | null {
  const actor = getCombatant(s, actorId);
  if (!actor) return 'Unbekannte Figur.';
  if (s.outcome !== 'ongoing') return 'Der Kampf ist vorbei.';
  if (actor.isSpark) return 'Spark kann keine Aktionen ausführen.';
  if (actor.side !== s.turn) return 'Nicht am Zug.';
  if (actor.status !== 'active') return actor.status === 'dizzy' ? 'Wankt.' : 'Besiegt.';
  if (actionId === 'ability' && !getAbility(actor.stats.abilityId)) return 'Keine Fähigkeit.';
  if (actor.usedActions.includes(actionId)) return 'In diesem Zug schon eingesetzt.';
  if (actor.side === 'hero' && actionApCost(actor, actionId) > s.ap) return 'Nicht genug AP.';
  const pool = needsSingleTarget(actor, actionId) ? validTargets(s, actor.id, actionId) : resolveTargets(s, actor, actionId) ?? [];
  if (pool.length === 0) return 'Kein gültiges Ziel.';
  return null;
}

export function actorHasOptions(s: BattleState, actorId: string): boolean {
  return ALL_ACTION_IDS.some(a => actionUnavailableReason(s, actorId, a) === null);
}

/** Whether the current player turn still has any valid action */
export function hasAnyValidAction(s: BattleState): boolean {
  if (s.outcome !== 'ongoing' || s.turn !== 'hero') return false;
  return heroesOf(s).some(c => canAct(c) && actorHasOptions(s, c.id));
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

export function baseDamage(attacker: Combatant, target: Combatant, multiplier: number): number {
  const atk = attacker.stats.atk * (1 + attacker.atkBuff);
  return (atk * multiplier * DEF_CONSTANT) / (DEF_CONSTANT + target.stats.def);
}

/** Pure damage formula (section 7) — exported for tests */
export function computeDamage(atk: number, def: number, multiplier: number, roll: number, blockFactor = 1): number {
  const base = (atk * multiplier * DEF_CONSTANT) / (DEF_CONSTANT + def);
  return Math.max(1, Math.round(base * roll * blockFactor));
}

export interface DamagePreview {
  min: number;
  max: number;
  coupDeGrace: boolean;
}

export function previewDamage(s: BattleState, attackerId: string, targetId: string, multiplier: number): DamagePreview | null {
  const a = getCombatant(s, attackerId);
  const t = getCombatant(s, targetId);
  if (!a || !t) return null;
  if (t.status === 'dizzy') return { min: 0, max: 0, coupDeGrace: true };
  const base = baseDamage(a, t, multiplier) * t.damageFactor;
  return {
    min: Math.max(1, Math.round(base * (1 - VARIANCE))),
    max: Math.max(1, Math.round(base * (1 + VARIANCE))),
    coupDeGrace: false,
  };
}

/** Damage multiplier of an action (null = no damage) */
export function actionMultiplier(actor: Combatant, actionId: ActionId): number | null {
  if (actionId === 'normal_hit') return NORMAL_MULT;
  if (actionId === 'heavy_hit') return HEAVY_MULT;
  if (actionId === 'ability') {
    const eff = getAbility(actor.stats.abilityId)?.effects.find(e => e.type === 'damage');
    return eff && eff.type === 'damage' ? eff.multiplier : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal mutators (operate on a cloned state)
// ---------------------------------------------------------------------------

function setDizzy(s: BattleState, c: Combatant, ev: BattleEvent[]) {
  if (c.isSpark || c.status !== 'active') return;
  c.status = 'dizzy';
  c.dizzySince = s.dizzyCounter++;
  c.recovery = 0;
  c.damageFactor = 1;
  ev.push({ type: 'dizzy', id: c.id });
}

function setDefeated(c: Combatant, ev: BattleEvent[]) {
  c.status = 'defeated';
  c.hp = 0;
  c.damageFactor = 1;
  c.atkBuff = 0;
  c.dizzySince = null;
  c.recovery = 0;
  ev.push({ type: 'defeated', id: c.id });
}

function dealDamage(s: BattleState, rng: Rng, src: Combatant, t: Combatant, mult: number, ev: BattleEvent[]) {
  if (t.status === 'defeated') return;
  if (t.status === 'dizzy') {
    ev.push({ type: 'coup_de_grace', targetId: t.id, sourceId: src.id });
    setDefeated(t, ev);
    return;
  }
  const roll = rng.range(1 - VARIANCE, 1 + VARIANCE);
  const blocked = t.damageFactor < 1;
  const amount = Math.max(1, Math.round(baseDamage(src, t, mult) * roll * t.damageFactor));
  t.hp = Math.max(0, t.hp - amount);
  ev.push({ type: 'damage', targetId: t.id, sourceId: src.id, amount, hp: t.hp, blocked });
  if (t.hp <= 0) {
    if (t.isSpark) return; // Spark never wankt — defeat is detected by checkOutcome
    setDizzy(s, t, ev);
  }
}

function drainKraft(s: BattleState, t: Combatant, amount: number, ev: BattleEvent[]) {
  if (t.side !== 'enemy' || t.status !== 'active' || t.stats.maxKraft <= 0) return;
  const real = Math.max(0, Math.round(amount * (1 - t.stats.kraftResist)));
  t.kraft = Math.max(0, t.kraft - real);
  ev.push({ type: 'kraft', targetId: t.id, amount: real, kraft: t.kraft });
  if (t.kraft <= 0) setDizzy(s, t, ev);
}

function applyAbility(s: BattleState, rng: Rng, actor: Combatant, ab: AbilityDef, targets: Combatant[], ev: BattleEvent[]) {
  for (const t of targets) {
    for (const eff of ab.effects) {
      switch (eff.type) {
        case 'damage':
          dealDamage(s, rng, actor, t, eff.multiplier, ev);
          break;
        case 'heal':
          if (t.status === 'active') {
            const before = t.hp;
            t.hp = Math.min(t.stats.maxHp, t.hp + Math.round((t.stats.maxHp * eff.percentMaxHp) / 100));
            ev.push({ type: 'heal', targetId: t.id, amount: t.hp - before, hp: t.hp });
          }
          break;
        case 'guard':
          if (t.status === 'active') {
            t.damageFactor = Math.min(t.damageFactor, eff.factor);
            ev.push({ type: 'block', targetId: t.id, factor: t.damageFactor });
          }
          break;
        case 'kraft_drain':
          drainKraft(s, t, eff.amount, ev);
          break;
        case 'atk_buff':
          if (t.status === 'active') {
            t.atkBuff += eff.percent / 100;
            ev.push({ type: 'buff', targetId: t.id, percent: eff.percent });
          }
          break;
      }
    }
  }
}

function finish(s: BattleState, ev: BattleEvent[]): ActionResult {
  const o = checkOutcome(s);
  if (o !== 'ongoing' && s.outcome === 'ongoing') {
    s.outcome = o;
    ev.push({ type: 'outcome', outcome: o });
  }
  return { state: s, events: ev };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Section 12: victory = all enemies defeated; defeat = Spark at 0 HP or all heroes defeated */
export function checkOutcome(s: BattleState): Outcome {
  const spark = sparkOf(s);
  if (spark && spark.hp <= 0) return 'defeat';
  const heroes = heroesOf(s);
  if (heroes.length > 0 && heroes.every(h => h.status === 'defeated')) return 'defeat';
  if (heroes.length === 0 && !spark) return 'defeat';
  if (enemiesOf(s).every(e => e.status === 'defeated')) return 'victory';
  return 'ongoing';
}

/**
 * Section 10. Heal mode if any hero is dizzy (defeated heroes don't count),
 * otherwise drain mode. No Spark (or Spark at 0 HP) -> no phase.
 */
export function runSparkPhase(input: BattleState): ActionResult {
  const s = structuredClone(input);
  const ev: BattleEvent[] = [];
  const spark = sparkOf(s);
  if (!spark || spark.hp <= 0 || s.outcome !== 'ongoing') {
    s.sparkMode = null;
    return { state: s, events: ev };
  }
  const dizzy = heroesOf(s).filter(h => h.status === 'dizzy');
  if (dizzy.length > 0) {
    s.sparkMode = 'heal';
    ev.push({ type: 'spark_phase', mode: 'heal' });
    const t = [...dizzy].sort((a, b) => (a.dizzySince ?? 0) - (b.dizzySince ?? 0))[0];
    t.recovery += 1;
    ev.push({ type: 'spark_heal', targetId: t.id, recovery: t.recovery });
    if (t.recovery >= DIZZY_RECOVERY_PULSES) {
      t.status = 'active';
      t.hp = Math.max(1, Math.round(t.stats.maxHp * DIZZY_RECOVERY_HP));
      t.recovery = 0;
      t.dizzySince = null;
      ev.push({ type: 'revive', id: t.id, hp: t.hp });
    }
  } else {
    s.sparkMode = 'drain';
    ev.push({ type: 'spark_phase', mode: 'drain' });
    for (const e of enemiesOf(s)) {
      if (e.status === 'active') drainKraft(s, e, SPARK_DRAIN, ev);
    }
  }
  return finish(s, ev);
}

/** Starts the turn of `state.turn` (section 9.1) */
export function startTurn(input: BattleState): ActionResult {
  let s = structuredClone(input);
  const ev: BattleEvent[] = [{ type: 'turn_start', side: s.turn, round: s.round }];
  if (s.outcome !== 'ongoing') return { state: s, events: ev };
  if (s.turn === 'hero') {
    const sp = runSparkPhase(s);
    s = sp.state;
    ev.push(...sp.events);
    if (s.outcome !== 'ongoing') return { state: s, events: ev };
    s.ap = AP_PER_TURN;
    ev.push({ type: 'ap', ap: s.ap });
  } else {
    s.ap = 0;
  }
  for (const c of s.combatants) {
    if (c.side !== s.turn) continue;
    c.damageFactor = 1;
    c.usedActions = [];
    if (c.side === 'enemy' && c.abilityCooldown > 0) c.abilityCooldown -= 1;
  }
  return finish(s, ev);
}

/**
 * Ends the current turn: unused AP expire, ATK buffs end, the other side
 * starts (a new round begins when the initiative side is up again).
 */
export function endTurn(input: BattleState): ActionResult {
  const s = structuredClone(input);
  const ev: BattleEvent[] = [{ type: 'turn_end', side: s.turn }];
  for (const c of s.combatants) if (c.side === s.turn) c.atkBuff = 0;
  s.ap = 0;
  if (s.outcome !== 'ongoing') return { state: s, events: ev };
  s.turn = s.turn === 'hero' ? 'enemy' : 'hero';
  if (s.turn === s.initiative) s.round += 1;
  const st = startTurn(s);
  return { state: st.state, events: [...ev, ...st.events] };
}

/** Executes one action immediately (section 8). Throws on invalid actions. */
export function applyAction(input: BattleState, action: BattleAction): ActionResult {
  const err = validateAction(input, action);
  if (err) throw new Error(err);
  const s = structuredClone(input);
  const rng = new Rng(s.rngState);
  const ev: BattleEvent[] = [];
  const actor = getCombatant(s, action.actorId)!;
  const targets = resolveTargets(s, actor, action.actionId, action.targetId)!;
  const ab = action.actionId === 'ability' ? getAbility(actor.stats.abilityId) : undefined;

  if (actor.side === 'hero') {
    s.ap -= actionApCost(actor, action.actionId);
  }
  actor.usedActions.push(action.actionId);
  ev.push({
    type: 'action',
    actorId: actor.id,
    actionId: action.actionId,
    abilityId: ab?.id,
    targetIds: targets.map(t => t.id),
    animation: ab ? ab.animation : action.actionId === 'heavy_hit' ? 'attack_heavy' : action.actionId === 'block' ? 'block' : 'attack',
  });

  if (action.actionId === 'normal_hit') dealDamage(s, rng, actor, targets[0], NORMAL_MULT, ev);
  else if (action.actionId === 'heavy_hit') dealDamage(s, rng, actor, targets[0], HEAVY_MULT, ev);
  else if (action.actionId === 'block') {
    actor.damageFactor = Math.min(actor.damageFactor, BLOCK_FACTOR);
    ev.push({ type: 'block', targetId: actor.id, factor: actor.damageFactor });
  } else if (ab) {
    applyAbility(s, rng, actor, ab, targets, ev);
    if (actor.side === 'enemy') actor.abilityCooldown = ab.enemyCooldown ?? DEFAULT_ENEMY_COOLDOWN;
  }

  s.rngState = rng.state;
  if (actor.side === 'hero') ev.push({ type: 'ap', ap: s.ap });
  return finish(s, ev);
}

/** Enemy turn order: front row first, lane 0 -> 2 (section 9.1) */
export function enemyTurnOrder(s: BattleState): string[] {
  return enemiesOf(s)
    .filter(e => e.status === 'active')
    .sort((a, b) => a.pos.row - b.pos.row || a.pos.lane - b.pos.lane)
    .map(e => e.id);
}

/** Per-placement persistence after a fight (section 12) */
export function enemyPersistence(s: BattleState): Record<string, { kraft: number; defeated: boolean }> {
  const out: Record<string, { kraft: number; defeated: boolean }> = {};
  for (const e of enemiesOf(s)) {
    if (!e.placementId) continue;
    out[e.placementId] = { kraft: e.kraft, defeated: e.status === 'defeated' };
  }
  return out;
}

/** Draws a float from the state RNG (for the AI); returns the new state */
export function drawRandom(s: BattleState): { value: number; state: BattleState } {
  const rng = new Rng(s.rngState);
  const value = rng.next();
  return { value, state: { ...s, rngState: rng.state } };
}
