// Battle system — stage 1 data model (pure, no React / Three.js)

export type Side = 'hero' | 'enemy';
export type CombatantStatus = 'active' | 'dizzy' | 'defeated';
export type StandardActionId = 'normal_hit' | 'heavy_hit' | 'block';
export type ActionId = StandardActionId | 'ability';
export type Outcome = 'ongoing' | 'victory' | 'defeat';
export type SparkMode = 'heal' | 'drain';

/** Resolved, complete stats of one combatant */
export interface ResolvedStats {
  maxHp: number;
  atk: number;
  def: number;
  ini: number;
  maxKraft: number; // 0 for heroes / Spark
  kraftResist: number; // 0..1
  abilityId?: string;
}

/** Grid position in the arena: row 0 = front (shared edge), lane 0..2 */
export interface GridPos {
  row: number;
  lane: number;
}

export interface Combatant {
  id: string;
  name: string;
  side: Side;
  isSpark: boolean;
  stats: ResolvedStats;
  hp: number;
  kraft: number;
  status: CombatantStatus;
  pos: GridPos;
  /** Incoming damage factor from block/guard (1 = none). Expires at own turn start */
  damageFactor: number;
  /** Additive ATK bonus (0.3 = +30 %). Expires at the end of the own turn */
  atkBuff: number;
  /** Monotonic order stamp when the combatant started to be dizzy (heroes) */
  dizzySince: number | null;
  /** Spark heal pulses received while dizzy */
  recovery: number;
  /** No-duplicate rule: action ids used in the current turn */
  usedActions: ActionId[];
  /** Enemy AI only: turns until the ability may be used again */
  abilityCooldown: number;
  /** Back reference to the dungeon placement (enemies) / character */
  placementId?: string;
  characterId?: string;
}

export interface BattleState {
  round: number;
  /** Side whose turn it currently is */
  turn: Side;
  /** Side that acts first in each round */
  initiative: Side;
  ap: number;
  combatants: Combatant[];
  outcome: Outcome;
  sparkMode: SparkMode | null;
  /** Seeded RNG state (mulberry32) */
  rngState: number;
  /** Counter used for dizzySince stamps */
  dizzyCounter: number;
}

export interface BattleAction {
  actorId: string;
  actionId: ActionId;
  /** Single target id (ignored for self / area targets) */
  targetId?: string;
}

export type BattleEvent =
  | { type: 'turn_start'; side: Side; round: number }
  | { type: 'turn_end'; side: Side }
  | { type: 'spark_phase'; mode: SparkMode }
  | { type: 'spark_heal'; targetId: string; recovery: number }
  | { type: 'revive'; id: string; hp: number }
  | { type: 'kraft'; targetId: string; amount: number; kraft: number }
  | { type: 'action'; actorId: string; actionId: ActionId; abilityId?: string; targetIds: string[]; animation: string }
  | { type: 'damage'; targetId: string; sourceId: string; amount: number; hp: number; blocked: boolean }
  | { type: 'coup_de_grace'; targetId: string; sourceId: string }
  | { type: 'heal'; targetId: string; amount: number; hp: number }
  | { type: 'block'; targetId: string; factor: number }
  | { type: 'buff'; targetId: string; percent: number }
  | { type: 'dizzy'; id: string }
  | { type: 'defeated'; id: string }
  | { type: 'ap'; ap: number }
  | { type: 'outcome'; outcome: Outcome };

export interface ActionResult {
  state: BattleState;
  events: BattleEvent[];
}

/** Input to create a combatant */
export interface CombatantInit {
  id: string;
  name: string;
  side: Side;
  isSpark?: boolean;
  stats: ResolvedStats;
  pos: GridPos;
  /** Enemies: starting Kraft (persisted between fights). Default maxKraft */
  kraft?: number;
  placementId?: string;
  characterId?: string;
}
