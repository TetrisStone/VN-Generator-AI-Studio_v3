import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Character, DungeonBaseGLB } from '../../types';
import { buildRoster, resolveLeaderModel } from '../roster';

function mkChar(overrides: Partial<Character> & { id: string; name: string }): Character {
  return {
    defaultDescription: '',
    rpgColor: '#ffffff',
    imageSrc: null,
    mapSpriteSrc: null,
    ...overrides,
  };
}

describe('buildRoster', () => {
  it('pushes side characters (Chronist) behind undefined/main characters and prioritizes 3D models (Peripè)', () => {
    const chars: Character[] = [
      mkChar({ id: 'chronist', name: 'Chronist', importance: 'side', alignment: 'neutral' }),
      mkChar({ id: 'kyra', name: 'Kyra' }),
      mkChar({ id: 'zombie', name: 'Zombie Cat', alignment: 'boese' }),
      mkChar({ id: 'lunett', name: 'Lunett' }),
      mkChar({ id: 'elara', name: 'Elara', model3dSrc: 'asset_elara' }),
      mkChar({ id: 'peripe', name: 'Peripè', alignment: 'neutral', model3dSrc: 'asset_peripe' }),
    ];

    const roster = buildRoster(chars);
    assert.deepEqual(
      roster.map(r => r.name),
      ['Elara', 'Peripè', 'Spark', 'Kyra']
    );
  });

  it('places explicit leaderCharacterId into Slot 0', () => {
    const chars: Character[] = [
      mkChar({ id: 'elara', name: 'Elara', importance: 'main', model3dSrc: 'asset_elara' }),
      mkChar({ id: 'kyra', name: 'Kyra', importance: 'main' }),
      mkChar({ id: 'peripe', name: 'Peripè', model3dSrc: 'asset_peripe' }),
    ];

    const roster = buildRoster(chars, { leaderCharacterId: 'peripe' });
    assert.equal(roster[0].name, 'Peripè');
    assert.equal(roster[1].name, 'Elara');
    assert.equal(roster[2].isSpark, true);
    assert.equal(roster[3].name, 'Kyra');
  });

  it('matches leaderFileName with diacritic tolerance (Peripe_complete.glb -> Peripè, Elara.glb -> Elara)', () => {
    const chars: Character[] = [
      mkChar({ id: 'chronist', name: 'Chronist', importance: 'side' }),
      mkChar({ id: 'kyra', name: 'Kyra' }),
      mkChar({ id: 'lunett', name: 'Lunett' }),
      mkChar({ id: 'elara', name: 'Elara', model3dSrc: 'asset_elara' }),
      mkChar({ id: 'peripe', name: 'Peripè', model3dSrc: 'asset_peripe' }),
    ];

    const byPeripeFile = buildRoster(chars, { leaderFileName: 'Peripe_complete.glb' });
    assert.equal(byPeripeFile[0].name, 'Peripè');
    assert.equal(byPeripeFile[1].name, 'Elara');

    const byElaraFile = buildRoster(chars, { leaderFileName: 'Elara.glb' });
    assert.equal(byElaraFile[0].name, 'Elara');
    assert.equal(byElaraFile[1].name, 'Peripè');
  });

  it('excludes evil characters from hero slots and routes isSpark to slot index 2', () => {
    const chars: Character[] = [
      mkChar({ id: 'bad', name: 'Korax', alignment: 'boese', model3dSrc: 'asset_korax' }),
      mkChar({ id: 'lumina', name: 'Lumina', isSpark: true }),
      mkChar({ id: 'peripe', name: 'Peripè', model3dSrc: 'asset_peripe' }),
    ];

    const roster = buildRoster(chars);
    assert.deepEqual(
      roster.map(r => r.name),
      ['Peripè', 'Held 2', 'Lumina', 'Held 3']
    );
    assert.equal(roster[2].isSpark, true);
  });
});

describe('resolveLeaderModel', () => {
  const elara: Character = mkChar({
    id: 'elara',
    name: 'Elara',
    importance: 'main',
    model3dSrc: 'asset_elara_complete',
    model3dScale: 1.1,
    model3dOffsetY: 0.05,
    model3dRotationY: 90,
    model3dClips: { idle: 'idle', combat_idle: 'combat_idle', run: 'run' },
  });

  const staleTestGlb: DungeonBaseGLB = {
    fileName: 'Elara_test_upload.glb',
    fileSize: 12345,
    assetId: 'asset_stale_dungeon_test',
    scale: 2.0,
    model3dClips: { idle: 'OldIdle' },
  };

  it('in playMode prefers the live project character model over a stale unbound dungeon test GLB', () => {
    const resolved = resolveLeaderModel([elara], staleTestGlb, { playMode: true });
    assert.ok(resolved);
    assert.equal(resolved.fromProjectCharacter, true);
    assert.equal(resolved.characterId, 'elara');
    assert.equal(resolved.assetRef, 'asset_elara_complete');
    assert.equal(resolved.useRawScale, false);
    assert.equal(resolved.scale, 1.1);
    assert.deepEqual(resolved.model3dClips, { idle: 'idle', combat_idle: 'combat_idle', run: 'run' });
  });

  it('in playMode resolves live project character even when storedBaseChar is null', () => {
    const resolved = resolveLeaderModel([elara], null, { playMode: true });
    assert.ok(resolved);
    assert.equal(resolved.fromProjectCharacter, true);
    assert.equal(resolved.assetRef, 'asset_elara_complete');
    assert.equal(resolved.fileName, 'Elara.glb');
  });

  it('in builder mode updates bound project character to its latest model3dSrc', () => {
    const boundOld: DungeonBaseGLB = {
      fileName: 'Elara.glb',
      characterId: 'elara',
      assetId: 'old_elara_asset',
    };
    const resolved = resolveLeaderModel([elara], boundOld, { playMode: false });
    assert.ok(resolved);
    assert.equal(resolved.fromProjectCharacter, true);
    assert.equal(resolved.assetRef, 'asset_elara_complete');
  });

  it('in builder mode preserves an unbound dungeon test GLB', () => {
    const resolved = resolveLeaderModel([elara], staleTestGlb, { playMode: false });
    assert.ok(resolved);
    assert.equal(resolved.fromProjectCharacter, false);
    assert.equal(resolved.assetRef, 'asset_stale_dungeon_test');
    assert.equal(resolved.fileName, 'Elara_test_upload.glb');
  });

  it('returns storedBaseChar fallback when no project character has a 3D model, or null when empty', () => {
    const no3d = mkChar({ id: 'kyra', name: 'Kyra' });
    const fallback = resolveLeaderModel([no3d], staleTestGlb, { playMode: true });
    assert.ok(fallback);
    assert.equal(fallback.fromProjectCharacter, false);
    assert.equal(fallback.assetRef, 'asset_stale_dungeon_test');

    assert.equal(resolveLeaderModel([no3d], null, { playMode: true }), null);
  });
});
