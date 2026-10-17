import { Character, CharacterImportance, CharacterAlignment } from '../types';

export type CharacterGroupKey = 'main_gut' | 'main_boese' | 'side_gut' | 'side_boese' | 'neutral';

export interface CharacterGroupDef {
  id: CharacterGroupKey;
  label: string;
  shortLabel: string;
  badgeBg: string;
  badgeBorder: string;
  textColor: string;
  icon: string;
}

export const CHARACTER_GROUPS: CharacterGroupDef[] = [
  {
    id: 'main_gut',
    label: 'Hauptcharaktere (Gut)',
    shortLabel: 'Haupt Gut',
    badgeBg: 'bg-emerald-950/80',
    badgeBorder: 'border-emerald-700/60',
    textColor: 'text-emerald-300',
    icon: '🌟',
  },
  {
    id: 'main_boese',
    label: 'Hauptcharaktere (Böse)',
    shortLabel: 'Haupt Böse',
    badgeBg: 'bg-rose-950/80',
    badgeBorder: 'border-rose-700/60',
    textColor: 'text-rose-300',
    icon: '💀',
  },
  {
    id: 'side_gut',
    label: 'Nebencharaktere (Gut)',
    shortLabel: 'Neben Gut',
    badgeBg: 'bg-cyan-950/80',
    badgeBorder: 'border-cyan-700/60',
    textColor: 'text-cyan-300',
    icon: '🛡️',
  },
  {
    id: 'side_boese',
    label: 'Nebencharaktere (Böse)',
    shortLabel: 'Neben Böse',
    badgeBg: 'bg-amber-950/80',
    badgeBorder: 'border-amber-700/60',
    textColor: 'text-amber-300',
    icon: '🗡️',
  },
  {
    id: 'neutral',
    label: 'Neutral / Sonstige',
    shortLabel: 'Neutral',
    badgeBg: 'bg-gray-800',
    badgeBorder: 'border-gray-700',
    textColor: 'text-gray-300',
    icon: '⚖️',
  },
];

export function getCharacterGroupKey(character: Partial<Character>): CharacterGroupKey {
  const importance: CharacterImportance = character.importance || 'main';
  const alignment: CharacterAlignment = character.alignment || 'gut';

  if (alignment === 'neutral') return 'neutral';

  if (importance === 'main') {
    return alignment === 'boese' ? 'main_boese' : 'main_gut';
  } else {
    return alignment === 'boese' ? 'side_boese' : 'side_gut';
  }
}

export function getCharacterGroup(character: Partial<Character>): CharacterGroupDef {
  const key = getCharacterGroupKey(character);
  return CHARACTER_GROUPS.find(g => g.id === key) || CHARACTER_GROUPS[4];
}
