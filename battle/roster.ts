import type { AbilityAnimConfig, BattleClipKey, Character, DungeonBaseGLB } from '../types';
import { resolveHeroStats, resolveSparkStats } from './stats';
import type { ResolvedStats } from './types';

export interface RosterEntry {
  id: string;
  name: string;
  characterId?: string;
  isSpark: boolean;
  stats: ResolvedStats;
  color: number;
}

export interface BuildRosterOptions {
  leaderCharacterId?: string;
  leaderFileName?: string;
}

export interface ResolvedLeaderModel {
  assetRef: string;
  fileName: string;
  fileSize?: number;
  characterId?: string;
  fromProjectCharacter: boolean;
  scale?: number;
  useRawScale?: boolean;
  offsetY?: number;
  rotationY?: number;
  idleClipName?: string;
  runClipName?: string;
  model3dClips?: Partial<Record<BattleClipKey, string>>;
  model3dImpactTimes?: Partial<Record<BattleClipKey, number>>;
  model3dAbilityAnims?: Record<string, AbilityAnimConfig>;
}

const HERO_COLORS = [0x38bdf8, 0x34d399, 0xa78bfa];

const normalizeName = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const stripGlbExtension = (fileName: string): string =>
  fileName.replace(/\.(glb|gltf)$/i, '');

/**
 * Matches a character display name against a loaded GLB filename stem
 * (diacritic- and case-insensitive, e.g. "Peripè" matches "Peripe_complete.glb").
 */
export function matchesLeaderFileName(charName: string, fileName: string): boolean {
  const normName = normalizeName(charName);
  if (normName.length < 2) return false;
  const stem = normalizeName(stripGlbExtension(fileName));
  return (
    stem === normName ||
    stem.startsWith(`${normName}_`) ||
    stem.startsWith(`${normName}-`) ||
    stem.startsWith(`${normName} `) ||
    stem.includes(normName)
  );
}

function resolveLeaderId(candidates: Character[], options?: BuildRosterOptions): string | undefined {
  if (options?.leaderCharacterId) {
    const byId = candidates.find(c => c.id === options.leaderCharacterId);
    if (byId) return byId.id;
  }
  if (options?.leaderFileName) {
    const stem = normalizeName(stripGlbExtension(options.leaderFileName));
    const exact = candidates.find(c => normalizeName(c.name) === stem);
    if (exact) return exact.id;
    const partial = candidates.find(c => matchesLeaderFileName(c.name, options.leaderFileName!));
    if (partial) return partial.id;
  }
  return undefined;
}

/**
 * Party = first 3 non-Spark characters that are not evil, ranked so:
 * 1) the active dungeon leader (by characterId or GLB filename) takes Slot 0,
 * 2) side characters (importance === 'side') fall behind non-side characters,
 * 3) characters with a 3D model (model3dSrc) take priority over 2D-only characters,
 * 4) explicit main characters (importance === 'main') break ties.
 * Marching order: leader, hero 2, Spark, hero 3.
 */
export function buildRoster(characters: Character[], options?: BuildRosterOptions): RosterEntry[] {
  const candidates = characters.filter(c => !c.isSpark && c.alignment !== 'boese');
  const leaderId = resolveLeaderId(candidates, options);

  const rankOf = (c: Character): [number, number, number, number] => [
    c.id === leaderId ? 0 : 1,
    c.importance !== 'side' ? 0 : 1,
    c.model3dSrc ? 0 : 1,
    c.importance === 'main' ? 0 : 1,
  ];

  candidates.sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return ra[i] - rb[i];
    }
    return 0;
  });

  const heroes: RosterEntry[] = [];
  for (let k = 0; k < 3; k++) {
    const c = candidates[k];
    heroes.push(c
      ? { id: `hero_${c.id}`, name: c.name, characterId: c.id, isSpark: false, stats: resolveHeroStats(c.battleStats), color: HERO_COLORS[k] }
      : { id: `hero_default_${k + 1}`, name: `Held ${k + 1}`, isSpark: false, stats: resolveHeroStats(), color: HERO_COLORS[k] });
  }
  const sc = characters.find(c => c.isSpark);
  const spark: RosterEntry = sc
    ? { id: `spark_${sc.id}`, name: sc.name, characterId: sc.id, isSpark: true, stats: resolveSparkStats(sc.battleStats), color: 0xfbbf24 }
    : { id: 'spark_default', name: 'Spark', isSpark: true, stats: resolveSparkStats(), color: 0xfbbf24 };
  return [heroes[0], heroes[1], spark, heroes[2]];
}

function fromProjectCharacter(c: Character, base?: DungeonBaseGLB | null): ResolvedLeaderModel {
  return {
    assetRef: c.model3dSrc!,
    fileName: `${c.name}.glb`,
    fileSize: 0,
    characterId: c.id,
    fromProjectCharacter: true,
    scale: c.model3dScale ?? base?.scale ?? 1.0,
    useRawScale: false,
    offsetY: c.model3dOffsetY ?? base?.offsetY ?? 0.0,
    rotationY: c.model3dRotationY ?? base?.rotationY ?? 0.0,
    model3dClips: c.model3dClips ?? base?.model3dClips,
    model3dImpactTimes: c.model3dImpactTimes ?? base?.model3dImpactTimes,
    model3dAbilityAnims: c.model3dAbilityAnims ?? base?.model3dAbilityAnims,
    idleClipName: c.model3dClips?.idle ?? base?.idleClipName,
    runClipName: c.model3dClips?.run ?? base?.runClipName,
  };
}

/**
 * Resolves the playable leader GLB for DungeonTestView:
 * 1. If storedBaseChar is explicitly bound to a project character with model3dSrc, always use its live model3dSrc.
 * 2. In playMode, resolve the leader via buildRoster() and prefer that character's live model3dSrc over stale test uploads.
 * 3. Otherwise fall back to storedBaseChar's uploaded GLB if present.
 */
export function resolveLeaderModel(
  characters: Character[],
  storedBaseChar: DungeonBaseGLB | null | undefined,
  options?: { playMode?: boolean }
): ResolvedLeaderModel | null {
  if (storedBaseChar?.characterId) {
    const bound = characters.find(c => c.id === storedBaseChar.characterId);
    if (bound?.model3dSrc) {
      return fromProjectCharacter(bound, storedBaseChar);
    }
  }

  if (options?.playMode) {
    const leader = buildRoster(characters, {
      leaderCharacterId: storedBaseChar?.characterId,
      leaderFileName: storedBaseChar?.fileName,
    })[0];
    const leaderChar = leader?.characterId
      ? characters.find(c => c.id === leader.characterId)
      : undefined;
    if (leaderChar?.model3dSrc) {
      return fromProjectCharacter(leaderChar);
    }
  }

  const fallbackRef = storedBaseChar?.assetId || storedBaseChar?.dataBase64;
  if (storedBaseChar && fallbackRef) {
    return {
      assetRef: fallbackRef,
      fileName: storedBaseChar.fileName || 'custom_model.glb',
      fileSize: storedBaseChar.fileSize,
      characterId: storedBaseChar.characterId,
      fromProjectCharacter: false,
      scale: storedBaseChar.scale,
      useRawScale: storedBaseChar.useRawScale,
      offsetY: storedBaseChar.offsetY,
      rotationY: storedBaseChar.rotationY,
      idleClipName: storedBaseChar.model3dClips?.idle || storedBaseChar.idleClipName,
      runClipName: storedBaseChar.model3dClips?.run || storedBaseChar.runClipName,
      model3dClips: storedBaseChar.model3dClips,
      model3dImpactTimes: storedBaseChar.model3dImpactTimes,
      model3dAbilityAnims: storedBaseChar.model3dAbilityAnims,
    };
  }

  return null;
}
