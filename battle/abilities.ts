// Ability library — abilities are data, not code (section 8.3)

export type AbilityTarget = 'enemy' | 'all_enemies_front_row' | 'all_enemies' | 'ally' | 'self' | 'all_allies';

export type AbilityEffect =
  | { type: 'damage'; multiplier: number }
  | { type: 'heal'; percentMaxHp: number } // active allies only
  | { type: 'guard'; factor: number } // like block, on an ally
  | { type: 'kraft_drain'; amount: number }
  | { type: 'atk_buff'; percent: number }; // until end of turn

export interface AbilityDef {
  id: string;
  name: string;
  description: string;
  apCost: number;
  target: AbilityTarget;
  effects: AbilityEffect[];
  animation: string;
  enemyCooldown?: number;
}

export const ABILITIES: AbilityDef[] = [
  {
    id: 'whirl',
    name: 'Wirbelschlag',
    description: 'Trifft die gesamte vordere Gegnerreihe (Schaden ×1,2).',
    apCost: 3,
    target: 'all_enemies_front_row',
    effects: [{ type: 'damage', multiplier: 1.2 }],
    animation: 'cast',
  },
  {
    id: 'mend',
    name: 'Heilende Hand',
    description: 'Heilt einen aktiven Verbündeten um 35 % seiner max. LP.',
    apCost: 2,
    target: 'ally',
    effects: [{ type: 'heal', percentMaxHp: 35 }],
    animation: 'cast',
  },
  {
    id: 'shieldwall',
    name: 'Schildwall',
    description: 'Ein Verbündeter blockt (eingehender Schaden ×0,5).',
    apCost: 2,
    target: 'ally',
    effects: [{ type: 'guard', factor: 0.5 }],
    animation: 'cast',
  },
  {
    id: 'exhaust',
    name: 'Zermürben',
    description: 'Schaden ×1,0 und 25 Kraft Abzug.',
    apCost: 2,
    target: 'enemy',
    effects: [{ type: 'damage', multiplier: 1.0 }, { type: 'kraft_drain', amount: 25 }],
    animation: 'cast',
  },
  {
    id: 'warcry',
    name: 'Kriegsruf',
    description: 'Alle Verbündeten erhalten +30 % ATK bis Zugende.',
    apCost: 2,
    target: 'all_allies',
    effects: [{ type: 'atk_buff', percent: 30 }],
    animation: 'cast',
  },
];

export function getAbility(id: string | undefined | null): AbilityDef | undefined {
  if (!id) return undefined;
  return ABILITIES.find(a => a.id === id);
}
