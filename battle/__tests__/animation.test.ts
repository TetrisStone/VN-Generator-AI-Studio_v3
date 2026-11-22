// Unit tests for GLB battle animations: keyword auto-mapping, combat_idle vs idle,
// hit/attack deduplication, per-ability config, root-motion stripping, impact times,
// and BattleAnimator fallback resilience (sections 13.2–13.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BattleAnimator,
  DEFAULT_IMPACT_TIME,
  autoMapClipNames,
  clampImpactRatio,
  defaultAbilityApproach,
  resolveImpactTime,
  stripRootMotion,
} from '../animation';

test('autoMapClipNames maps realistic Mixamo/Blender clip names cleanly', () => {
  const mapped = autoMapClipNames([
    'Stand_Idle',
    'Mixamo_Walk',
    'Armature|Attack_01',
    'Heavy_Combo',
    'Guard',
    'Spell_Cast',
    'Hurt',
    'Stun',
    'Death',
    'Cheer',
  ]);

  assert.equal(mapped.idle, 'Stand_Idle');
  assert.equal(mapped.run, 'Mixamo_Walk');
  assert.equal(mapped.attack, 'Armature|Attack_01');
  assert.equal(mapped.attack_heavy, 'Heavy_Combo');
  assert.equal(mapped.block, 'Guard');
  assert.equal(mapped.cast, 'Spell_Cast');
  assert.equal(mapped.hit, 'Hurt');
  assert.equal(mapped.dizzy, 'Stun');
  assert.equal(mapped.defeat, 'Death');
  assert.equal(mapped.victory, 'Cheer');
});

test('autoMapClipNames separates idle from combat_idle on Elara and falls back cleanly on Lost Wulf', () => {
  const elara = autoMapClipNames([
    'elara_idle_adjusted_fit',
    'interact_adjusted_fit',
    'Elara_Interact_adjusted_fit',
    'Elara_Sword_Idle_adjusted_fit',
    'Elara_Sword_Dash_adjusted_fit',
    'Elara_Sword_Heavy_Combo_adjusted_fit',
    'Elara_Sword_Regular_C_adjusted_fit',
    'Elara_Death01_adjusted_fit',
    'elara_female_walk.001_adjusted_fit',
    'Elara_Hit_Knockback_adjusted_fit',
  ]);
  assert.equal(elara.idle, 'elara_idle_adjusted_fit');
  assert.equal(elara.combat_idle, 'Elara_Sword_Idle_adjusted_fit');
  assert.equal(elara.attack_heavy, 'Elara_Sword_Heavy_Combo_adjusted_fit');
  assert.equal(elara.defeat, 'Elara_Death01_adjusted_fit');
  assert.equal(elara.run, 'elara_female_walk.001_adjusted_fit');
  assert.equal(elara.hit, 'Elara_Hit_Knockback_adjusted_fit');

  const wolf = autoMapClipNames([
    'Battle Idle_adjusted_fit',
    'hit_knockback_adjusted_fit',
    'hit_chest_adjusted_fit',
    'Attack_adjusted_fit',
    'laytoidle_adjusted_fit',
    'melee_hook_adjusted_fit',
    'Roll_punch_adjusted_fit',
    'walk_formal_loop_adjusted_fit',
  ]);
  assert.equal(wolf.combat_idle, 'Battle Idle_adjusted_fit');
  // Falls back to combat_idle rather than picking unrelated substring "laytoidle"
  assert.equal(wolf.idle, 'Battle Idle_adjusted_fit');
  assert.equal(wolf.attack, 'Attack_adjusted_fit');
  assert.equal(wolf.hit, 'hit_knockback_adjusted_fit');
  assert.equal(wolf.run, 'walk_formal_loop_adjusted_fit');
});

test('autoMapClipNames evaluates hit after attack and never duplicates attack clips', () => {
  const mappedBoth = autoMapClipNames(['hit_1', 'Hit_React']);
  assert.equal(mappedBoth.attack, 'hit_1');
  assert.equal(mappedBoth.hit, 'Hit_React');

  const mappedSingle = autoMapClipNames(['hit_1']);
  assert.equal(mappedSingle.attack, 'hit_1');
  assert.equal(mappedSingle.hit, undefined);
});

test('autoMapClipNames honors idleClipName/runClipName and model3dClips overrides, ignoring missing names', () => {
  const clips = ['Stand', 'IdleCustom', 'Jog', 'WalkFast', 'Slash'];

  const legacy = autoMapClipNames(clips, {
    idleClipName: 'IdleCustom',
    runClipName: 'WalkFast',
  });
  assert.equal(legacy.idle, 'IdleCustom');
  assert.equal(legacy.run, 'WalkFast');

  const explicit = autoMapClipNames(clips, {
    idleClipName: 'IdleCustom',
    model3dClips: {
      idle: 'Stand',
      attack: 'Slash',
      victory: 'MissingClipName', // nonexistent -> ignored cleanly
    },
  });
  assert.equal(explicit.idle, 'Stand');
  assert.equal(explicit.attack, 'Slash');
  assert.equal(explicit.victory, undefined);
});

test('per-ability animation config supports custom clips and melee/ranged approaches', () => {
  assert.equal(defaultAbilityApproach('whirl'), 'melee');
  assert.equal(defaultAbilityApproach('mend'), 'ranged');

  const dash = new THREE.AnimationClip('Elara_Sword_Dash', 1.0, []);
  const cast = new THREE.AnimationClip('Cast_Default', 1.0, []);
  const anim = new BattleAnimator(new THREE.AnimationMixer(new THREE.Group()), [dash, cast], {
    characterName: 'Elara',
    model3dAbilityAnims: {
      whirl: { clip: 'Elara_Sword_Dash', impactTime: 0.7, approach: 'melee' },
      exhaust: { clip: 'MissingClip', approach: 'ranged' },
    },
  });

  assert.equal(anim.getAbilityClip('whirl'), dash);
  assert.equal(anim.getAbilityApproach('whirl'), 'melee');
  assert.equal(anim.getAbilityClip('exhaust'), undefined);
  assert.equal(anim.getAbilityApproach('exhaust'), 'ranged');
  assert.equal(clampImpactRatio(0.7), 0.7);
  assert.equal(clampImpactRatio(-1, 0.5), 0.05);
  anim.dispose();
});

test('stripRootMotion removes X/Z drift on root bones while preserving initial offset, Y bounce, and child tracks', () => {
  const rootBone = new THREE.Bone();
  rootBone.name = 'mixamorigHips';
  const childBone = new THREE.Bone();
  childBone.name = 'mixamorigSpine';
  rootBone.add(childBone);
  const rig = new THREE.Group();
  rig.add(rootBone);

  const rootPos = new THREE.VectorKeyframeTrack(
    'mixamorigHips.position',
    [0, 0.5, 1.0],
    [0.1, 0.9, -0.2, 1.8, 1.35, 2.4, 3.0, 0.9, 5.0]
  );
  const childPos = new THREE.VectorKeyframeTrack(
    'mixamorigSpine.position',
    [0, 0.5],
    [0, 0.4, 0, 0.25, 0.45, 0.15]
  );
  const rootRot = new THREE.QuaternionKeyframeTrack(
    'mixamorigHips.quaternion',
    [0, 0.5],
    [0, 0, 0, 1, 0, 0.5, 0, 0.866]
  );
  const origClip = new THREE.AnimationClip('Attack_01', 1.0, [rootPos, childPos, rootRot]);

  const stripped = stripRootMotion([origClip], rig);
  assert.equal(stripped.length, 1);
  assert.notEqual(stripped[0], origClip);

  // Idempotent on second pass
  const strippedTwice = stripRootMotion(stripped, rig);
  assert.equal(strippedTwice[0], stripped[0]);

  const strippedRoot = stripped[0].tracks[0];
  // Base X (0.1) and base Z (-0.2) preserved across all keyframes; Y values intact
  assert.ok(Math.abs(strippedRoot.values[0] - 0.1) < 1e-5);
  assert.ok(Math.abs(strippedRoot.values[1] - 0.9) < 1e-5);
  assert.ok(Math.abs(strippedRoot.values[2] - -0.2) < 1e-5);
  assert.ok(Math.abs(strippedRoot.values[3] - 0.1) < 1e-5);
  assert.ok(Math.abs(strippedRoot.values[4] - 1.35) < 1e-5);
  assert.ok(Math.abs(strippedRoot.values[5] - -0.2) < 1e-5);
  assert.ok(Math.abs(strippedRoot.values[6] - 0.1) < 1e-5);
  assert.ok(Math.abs(strippedRoot.values[7] - 0.9) < 1e-5);
  assert.ok(Math.abs(strippedRoot.values[8] - -0.2) < 1e-5);

  // Non-root bone track untouched
  const strippedChild = stripped[0].tracks[1];
  assert.ok(Math.abs(strippedChild.values[3] - 0.25) < 1e-5);
  assert.ok(Math.abs(strippedChild.values[5] - 0.15) < 1e-5);

  // Original clip remains unmodified
  assert.ok(Math.abs(origClip.tracks[0].values[3] - 1.8) < 1e-5);
});

test('resolveImpactTime returns 0.5 by default and clamps into [0.05, 0.95]', () => {
  assert.equal(resolveImpactTime('attack'), DEFAULT_IMPACT_TIME);
  assert.equal(resolveImpactTime('cast', { attack: 0.2 }), DEFAULT_IMPACT_TIME);
  assert.equal(resolveImpactTime('attack', { attack: 0.72 }), 0.72);
  assert.equal(resolveImpactTime('attack', { attack: -2 }), 0.05);
  assert.equal(resolveImpactTime('attack_heavy', { attack_heavy: 3 }), 0.95);
});

test('BattleAnimator logs missing clip once per character and handles empty/missing clips safely', async () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
  try {
    const dummyClip = new THREE.AnimationClip('Stand_Idle', 1.0, []);
    const root = new THREE.Group();
    const mixer = new THREE.AnimationMixer(root);
    const anim = new BattleAnimator(mixer, [dummyClip], { characterName: 'TestHeld' });

    assert.equal(anim.has('idle'), true);
    assert.equal(anim.has('attack'), false);

    assert.equal(anim.play('attack'), 0);
    assert.equal(anim.play('attack'), 0);
    const res = await anim.playOnceAndWait('attack');
    assert.deepEqual(res, { played: false, duration: 0, resolvedKey: null });

    const attackWarnings = warnings.filter((w) => w.includes('TestHeld') && w.includes('"attack"'));
    assert.equal(attackWarnings.length, 1);

    assert.ok(anim.runTimeScale(8) > 1);
    assert.ok(anim.runTimeScale(1) < 1);
    anim.dispose();
  } finally {
    console.warn = origWarn;
  }
});
