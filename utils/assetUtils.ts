import { AssetItem, Scene, WorldMap, Battle, Character } from '../types';

export const PRESET_ARCHETYPES = [
  { id: 'buerger', label: 'Bürger' },
  { id: 'adel', label: 'Adel' },
  { id: 'arm', label: 'Arm / Bedürftig' },
  { id: 'ritter', label: 'Ritter / Garde' },
  { id: 'magier', label: 'Magier / Seher' },
  { id: 'soeldner', label: 'Söldner / Outlaw' },
];

export function getArchetypeLabel(val?: string): string {
  if (!val || !val.trim()) return '';
  const trimmed = val.trim();
  const match = PRESET_ARCHETYPES.find(
    p => p.id.toLowerCase() === trimmed.toLowerCase() || p.label.toLowerCase() === trimmed.toLowerCase()
  );
  if (match) return match.label;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Checks whether an asset is currently assigned to / used by any scene, map, battle, or character.
 * Returns the assignment metadata if used, or undefined if unassigned.
 */
export function getEffectiveAssignment(
  asset: AssetItem,
  scenes: Scene[] = [],
  maps: WorldMap[] = [],
  battles: Battle[] = [],
  characters: Character[] = []
): AssetItem['assignedTo'] | undefined {
  const fileUrl = asset.fileUrl;
  const id = asset.id;

  // 1. Check direct usage in Scenes
  if (scenes.length > 0) {
    const matchedScene = scenes.find(
      s => s.backgroundSrc && (s.backgroundSrc === fileUrl || s.backgroundSrc === id)
    );
    if (matchedScene) {
      return {
        type: 'scene_bg',
        targetId: matchedScene.id,
        targetName: matchedScene.name || matchedScene.locationName || 'Unbenannte Szene'
      };
    }
  }

  // 2. Check direct usage in Maps
  if (maps.length > 0) {
    const matchedMap = maps.find(
      m => m.backgroundSrc && (m.backgroundSrc === fileUrl || m.backgroundSrc === id)
    );
    if (matchedMap) {
      return {
        type: 'map_bg',
        targetId: matchedMap.id,
        targetName: matchedMap.name || 'Unbenannte Karte'
      };
    }
  }

  // 3. Check direct usage in Battles
  if (battles.length > 0) {
    const matchedBattle = battles.find(
      b => b.backgroundSrc && (b.backgroundSrc === fileUrl || b.backgroundSrc === id)
    );
    if (matchedBattle) {
      return {
        type: 'battle_bg',
        targetId: matchedBattle.id,
        targetName: matchedBattle.name || 'Unbenannter Kampf'
      };
    }
  }

  // 4. Check direct usage in Characters
  if (characters.length > 0) {
    const matchedChar = characters.find(
      c =>
        (c.imageSrc && (c.imageSrc === fileUrl || c.imageSrc === id)) ||
        (c.mapSpriteSrc && (c.mapSpriteSrc === fileUrl || c.mapSpriteSrc === id))
    );
    if (matchedChar) {
      return {
        type: 'character_idle',
        targetId: matchedChar.id,
        targetName: matchedChar.name || 'Unbenannter Charakter'
      };
    }
  }

  // 5. If asset.assignedTo is set, check if the target entity still exists
  if (asset.assignedTo) {
    const { type, targetId } = asset.assignedTo;
    let targetExists = false;

    if (type === 'scene_bg' || (type as any) === 'scene') {
      targetExists = scenes.some(s => s.id === targetId);
    } else if (type === 'map_bg' || (type as any) === 'map') {
      targetExists = maps.some(m => m.id === targetId);
    } else if (type === 'battle_bg' || (type as any) === 'battle') {
      targetExists = battles.some(b => b.id === targetId);
    } else if (
      type === 'character_idle' ||
      type === 'character_map' ||
      (type as any) === 'character'
    ) {
      targetExists = characters.some(c => c.id === targetId);
    }

    if (targetExists) {
      return asset.assignedTo;
    }
  }

  // No active assignment found
  return undefined;
}
