// GLB battle animation resolution, per-ability clip config, root-motion stripping,
// crossfade playback, impact timing, and sequential event queue (sections 13.1–13.5, 14.1).
import * as THREE from 'three';
import type { AbilityAnimConfig, BattleClipKey } from '../types';

export type { AbilityAnimConfig, BattleClipKey };

export const BATTLE_CLIP_KEYS: BattleClipKey[] = [
  'idle',
  'combat_idle',
  'run',
  'attack',
  'attack_heavy',
  'block',
  'cast',
  'hit',
  'dizzy',
  'defeat',
  'victory',
];

export const IMPACT_CLIP_KEYS: BattleClipKey[] = ['attack', 'attack_heavy', 'cast'];

export const LOOPING_CLIP_KEYS = new Set<BattleClipKey>([
  'idle',
  'combat_idle',
  'run',
  'dizzy',
  'block',
]);

export const DEFAULT_IMPACT_TIME = 0.5;
export const CROSSFADE_SECONDS = 0.18;

export const BATTLE_CLIP_LABELS_DE: Record<BattleClipKey, string> = {
  idle: 'Ruhe – Erkundung (idle)',
  combat_idle: 'Kampf-Ruhe (combat_idle)',
  run: 'Laufen (run)',
  attack: 'Normaler Hit (attack)',
  attack_heavy: 'Starker Hit (attack_heavy)',
  block: 'Block (block)',
  cast: 'Fähigkeit / Zauber (cast)',
  hit: 'Treffer (hit)',
  dizzy: 'Wanken (dizzy)',
  defeat: 'Besiegt (defeat)',
  victory: 'Sieg (victory)',
};

const CLIP_KEYWORDS: Record<BattleClipKey, string[]> = {
  combat_idle: ['battle_idle', 'battle idle', 'combat_idle', 'combat idle', 'sword_idle', 'fight_idle'],
  idle: ['idle', 'stand'],
  run: ['run', 'walk'],
  attack_heavy: ['heavy', 'power', 'attack_2', 'combo'],
  attack: ['attack', 'slash', 'punch', 'strike', 'hit_1'],
  block: ['block', 'guard', 'defend'],
  cast: ['cast', 'spell', 'magic', 'skill'],
  // Evaluated after attack / attack_heavy so the same clip is never assigned twice
  hit: ['hit', 'hurt', 'damage', 'impact'],
  dizzy: ['dizzy', 'stun', 'daze'],
  defeat: ['death', 'die', 'defeat', 'dead'],
  victory: ['victory', 'cheer', 'win'],
};

const AUTO_DETECT_ORDER: BattleClipKey[] = [
  'combat_idle',
  'idle',
  'run',
  'attack_heavy',
  'attack',
  'block',
  'cast',
  'hit',
  'dizzy',
  'defeat',
  'victory',
];

const ROOT_NAME_RE = /(?:^|[:|/_])(mixamorig\d*:?)?(hips|root|pelvis|bip01|rootmotion)(?:$|[:|/_])/i;
const REFERENCE_RUN_SPEED = 4.5;

export interface ClipMappingOptions {
  model3dClips?: Partial<Record<BattleClipKey, string>>;
  idleClipName?: string;
  runClipName?: string;
}

function splitClipTokens(clipName: string): string[] {
  return clipName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function matchesToken(clipName: string, kw: string): boolean {
  const tokens = splitClipTokens(clipName);
  const kwLower = kw.toLowerCase();
  return tokens.includes(kwLower);
}

/**
 * Resolves GLB clip names per BattleClipKey (section 13.2):
 * 1. Explicit per-character / per-GLB `model3dClips` overrides
 * 2. Legacy/dungeon `idleClipName` / `runClipName` overrides
 * 3. Case-insensitive keyword auto-detection (`combat_idle` before `idle`;
 *    `hit` after `attack` without duplicating attack clips)
 */
export function autoMapClipNames(
  clipNames: string[],
  opts: ClipMappingOptions = {}
): Partial<Record<BattleClipKey, string>> {
  const out: Partial<Record<BattleClipKey, string>> = {};
  if (clipNames.length === 0) return out;
  const available = new Set(clipNames);

  // 1. Explicit clip overrides
  if (opts.model3dClips) {
    for (const key of BATTLE_CLIP_KEYS) {
      const explicit = opts.model3dClips[key];
      if (explicit && available.has(explicit)) out[key] = explicit;
    }
  }

  // 2. Existing idleClipName / runClipName settings take precedence over auto-detection
  if (!out.idle && opts.idleClipName && available.has(opts.idleClipName)) {
    out.idle = opts.idleClipName;
  }
  if (!out.run && opts.runClipName && available.has(opts.runClipName)) {
    out.run = opts.runClipName;
  }

  const lowerNames = clipNames.map((name) => ({ name, lower: name.toLowerCase() }));

  // 3. Keyword search (case-insensitive, first match wins)
  for (const key of AUTO_DETECT_ORDER) {
    if (out[key]) continue;

    const blockedForHit =
      key === 'hit'
        ? new Set([out.attack, out.attack_heavy].filter((v): v is string => !!v))
        : null;
    const blockedForAttack =
      key === 'attack' && out.attack_heavy ? new Set([out.attack_heavy]) : null;
    const blockedForIdle =
      key === 'idle' && out.combat_idle ? new Set([out.combat_idle]) : null;

    const isAllowed = (name: string) => {
      if (blockedForHit?.has(name)) return false;
      if (blockedForAttack?.has(name)) return false;
      if (blockedForIdle?.has(name)) return false;
      return true;
    };

    const exact = lowerNames.find((c) => c.lower === key && isAllowed(c.name));
    if (exact) {
      out[key] = exact.name;
      continue;
    }

    if (key === 'idle') {
      // Prefer standalone non-combat idle token (`_idle_`), else fall back to combat_idle, then substring
      for (const kw of CLIP_KEYWORDS.idle) {
        const tokenMatch = lowerNames.find((c) => isAllowed(c.name) && matchesToken(c.name, kw));
        if (tokenMatch) {
          out.idle = tokenMatch.name;
          break;
        }
      }
      if (!out.idle && out.combat_idle) {
        out.idle = out.combat_idle;
      }
      if (!out.idle) {
        for (const kw of CLIP_KEYWORDS.idle) {
          const subMatch = lowerNames.find((c) => isAllowed(c.name) && c.lower.includes(kw));
          if (subMatch) {
            out.idle = subMatch.name;
            break;
          }
        }
      }
      continue;
    }

    for (const kw of CLIP_KEYWORDS[key]) {
      const match = lowerNames.find((c) => c.lower.includes(kw) && isAllowed(c.name));
      if (match) {
        out[key] = match.name;
        break;
      }
    }
  }

  return out;
}

/** Clamps configured impactTime into [0.05, 0.95], defaulting to 0.5 (section 13.2). */
export function resolveImpactTime(
  key: BattleClipKey,
  impactTimes?: Partial<Record<BattleClipKey, number>>
): number {
  const raw = impactTimes?.[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_IMPACT_TIME;
  return Math.max(0.05, Math.min(0.95, raw));
}

export function clampImpactRatio(raw?: number, fallback = DEFAULT_IMPACT_TIME): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.max(0.05, Math.min(0.95, raw));
}

/** Default approach mode per ability ID (`whirl` runs to chunk edge; spells stay in place). */
export function defaultAbilityApproach(abilityId?: string): 'melee' | 'ranged' {
  return abilityId === 'whirl' ? 'melee' : 'ranged';
}

function collectRootBoneNames(rootObject?: THREE.Object3D): Set<string> {
  const names = new Set<string>();
  if (!rootObject) return names;
  rootObject.traverse((obj: any) => {
    if (obj.isBone && !obj.parent?.isBone && obj.name) {
      names.add(obj.name);
      // Include direct armature container if it carries root translation tracks
      if (obj.parent?.name && obj.parent !== rootObject) {
        names.add(obj.parent.name);
      }
    } else if (obj.name && /^(armature|root|hips|pelvis|bip01)/i.test(obj.name)) {
      names.add(obj.name);
    }
  });
  return names;
}

/**
 * Removes X/Z root-motion drift from root-bone `.position` tracks while leaving
 * vertical Y motion and all non-root bone tracks intact (section 13.3).
 */
export function stripRootMotion(
  clips: THREE.AnimationClip[],
  rootObject?: THREE.Object3D
): THREE.AnimationClip[] {
  const rootNames = collectRootBoneNames(rootObject);
  return clips.map((clip) => {
    if ((clip as any).__rootMotionStripped) return clip;
    const cloned = clip.clone();
    for (const track of cloned.tracks) {
      let nodeName = '';
      let propertyName = '';
      try {
        const parsed = THREE.PropertyBinding.parseTrackName(track.name);
        nodeName = parsed.nodeName || '';
        propertyName = parsed.propertyName || '';
      } catch {
        const dotIdx = track.name.lastIndexOf('.');
        if (dotIdx > 0) {
          nodeName = track.name.slice(0, dotIdx);
          propertyName = track.name.slice(dotIdx + 1);
        }
      }
      if (propertyName !== 'position') continue;
      const isRoot =
        (nodeName && rootNames.has(nodeName)) || ROOT_NAME_RE.test(nodeName);
      if (!isRoot || track.values.length < 3) continue;

      const values = new Float32Array(track.values);
      const baseX = values[0];
      const baseZ = values[2];
      for (let i = 0; i < values.length; i += 3) {
        values[i] = baseX;
        values[i + 2] = baseZ;
      }
      track.values = values;
    }
    (cloned as any).__rootMotionStripped = true;
    return cloned;
  });
}

// ---------------------------------------------------------------------------
// Per-instance material helpers (hit red flash + defeat opacity fade)
// ---------------------------------------------------------------------------

interface StoredOrigMat {
  opacity: number;
  transparent: boolean;
  emissiveHex?: number;
  emissiveIntensity?: number;
}

function saveOrigMat(mat: any): StoredOrigMat {
  if (!mat.userData) mat.userData = {};
  if (!mat.userData.__battleOrig) {
    mat.userData.__battleOrig = {
      opacity: typeof mat.opacity === 'number' ? mat.opacity : 1,
      transparent: !!mat.transparent,
      emissiveHex: mat.emissive?.isColor ? mat.emissive.getHex() : undefined,
      emissiveIntensity: typeof mat.emissiveIntensity === 'number' ? mat.emissiveIntensity : undefined,
    } satisfies StoredOrigMat;
  }
  return mat.userData.__battleOrig as StoredOrigMat;
}

/** Clones mesh materials once per figure instance so fades/flashes stay local. */
export function ensureUniqueMaterials(root: THREE.Object3D): void {
  root.traverse((obj: any) => {
    if (!obj.isMesh || !obj.material || obj.userData?.__battleMatsCloned) return;
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map((m: THREE.Material) => {
        const cloned = m ? m.clone() : m;
        if (cloned) saveOrigMat(cloned);
        return cloned;
      });
    } else {
      obj.material = obj.material.clone();
      saveOrigMat(obj.material);
    }
    if (!obj.userData) obj.userData = {};
    obj.userData.__battleMatsCloned = true;
  });
}

export function setObjectOpacity(root: THREE.Object3D, factor: number): void {
  const clamped = Math.max(0, Math.min(1, factor));
  root.traverse((obj: any) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      const orig = saveOrigMat(mat);
      if (clamped < 0.999) {
        mat.transparent = true;
        mat.opacity = orig.opacity * clamped;
      } else {
        mat.transparent = orig.transparent;
        mat.opacity = orig.opacity;
      }
      mat.needsUpdate = true;
    }
  });
}

export function setObjectRedEmissive(root: THREE.Object3D, intensity: number): void {
  root.traverse((obj: any) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat?.emissive?.isColor) continue;
      const orig = saveOrigMat(mat);
      if (intensity > 0.001) {
        mat.emissive.setHex(0xff2222);
        if (typeof mat.emissiveIntensity === 'number') mat.emissiveIntensity = intensity;
      } else {
        mat.emissive.setHex(orig.emissiveHex ?? 0x000000);
        if (typeof mat.emissiveIntensity === 'number') {
          mat.emissiveIntensity = orig.emissiveIntensity ?? 1;
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// BattleAnimator & Sequential Event Queue
// ---------------------------------------------------------------------------

export interface BattleAnimatorOptions extends ClipMappingOptions {
  characterName?: string;
  model3dImpactTimes?: Partial<Record<BattleClipKey, number>>;
  model3dAbilityAnims?: Record<string, AbilityAnimConfig>;
  idle?: string;
  run?: string;
  current?: THREE.AnimationAction | null;
  onChange?: (action: THREE.AnimationAction | null) => void;
}

export interface PlayOnceOptions {
  timeScale?: number;
  fade?: number;
  clampWhenFinished?: boolean;
  onImpact?: () => Promise<void> | void;
  fallbackKeys?: Array<{ key: BattleClipKey; timeScale?: number }>;
}

export interface PlayOnceResult {
  played: boolean;
  duration: number;
  resolvedKey: BattleClipKey | null;
}

export class BattleAnimator {
  mixer: THREE.AnimationMixer | null;
  clips: THREE.AnimationClip[];
  current: THREE.AnimationAction | null;
  readonly clipMap: Partial<Record<BattleClipKey, string>>;

  private characterName: string;
  private impactTimes: Partial<Record<BattleClipKey, number>>;
  private abilityAnims: Record<string, AbilityAnimConfig>;
  private onChange?: (action: THREE.AnimationAction | null) => void;
  private missingWarned = new Set<BattleClipKey>();
  private activeCleanups = new Set<() => void>();
  private disposed = false;

  constructor(
    mixer: THREE.AnimationMixer | null,
    clips: THREE.AnimationClip[],
    opts: BattleAnimatorOptions = {}
  ) {
    this.mixer = mixer;
    this.clips = clips;
    this.current = opts.current ?? null;
    this.characterName = opts.characterName || 'Figur';
    this.impactTimes = opts.model3dImpactTimes || {};
    this.abilityAnims = opts.model3dAbilityAnims || {};
    this.onChange = opts.onChange;
    this.clipMap = autoMapClipNames(
      clips.map((c) => c.name),
      {
        model3dClips: opts.model3dClips,
        idleClipName: opts.idle ?? opts.idleClipName,
        runClipName: opts.run ?? opts.runClipName,
      }
    );
  }

  private warnMissingOnce(key: BattleClipKey): void {
    if (this.missingWarned.has(key)) return;
    this.missingWarned.add(key);
    if (this.clips.length > 0 || !this.mixer) {
      console.warn(`[battle/animation] Fehlender Clip "${key}" für ${this.characterName} – Fallback aktiv.`);
    }
  }

  getClip(key: BattleClipKey): THREE.AnimationClip | undefined {
    const mappedName = this.clipMap[key];
    if (!mappedName) return undefined;
    return this.clips.find((c) => c.name === mappedName);
  }

  has(key: BattleClipKey): boolean {
    return !!this.mixer && !!this.getClip(key);
  }

  getImpactTime(key: BattleClipKey): number {
    return resolveImpactTime(key, this.impactTimes);
  }

  getAbilityApproach(abilityId?: string): 'melee' | 'ranged' {
    if (abilityId && this.abilityAnims[abilityId]?.approach) {
      return this.abilityAnims[abilityId].approach!;
    }
    return defaultAbilityApproach(abilityId);
  }

  getAbilityClip(abilityId?: string): THREE.AnimationClip | undefined {
    const clipName = abilityId ? this.abilityAnims[abilityId]?.clip : undefined;
    if (!clipName) return undefined;
    return this.clips.find((c) => c.name === clipName);
  }

  /** Scales run animation playback proportionally to movement speed (section 13.3). */
  runTimeScale(moveSpeed: number): number {
    if (!Number.isFinite(moveSpeed) || moveSpeed <= 0) return 1;
    return Math.max(0.65, Math.min(2.2, moveSpeed / REFERENCE_RUN_SPEED));
  }

  private playRawClip(
    clip: THREE.AnimationClip,
    opts: {
      once: boolean;
      timeScale?: number;
      fade?: number;
      clampWhenFinished?: boolean;
    }
  ): { action: THREE.AnimationAction; duration: number } | null {
    if (this.disposed || !this.mixer) return null;
    const timeScale = Math.max(0.05, opts.timeScale ?? 1);
    const fade = opts.fade ?? CROSSFADE_SECONDS;
    const clamp = opts.clampWhenFinished ?? opts.once;

    const action = this.mixer.clipAction(clip);
    action.enabled = true;
    action.reset();
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    if (opts.once) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = clamp;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    }

    if (this.current && this.current !== action) {
      this.current.crossFadeTo(action, fade, false);
      action.play();
    } else {
      action.fadeIn(fade).play();
    }
    this.current = action;
    this.onChange?.(action);
    return { action, duration: clip.duration / timeScale };
  }

  /**
   * Plays a clip with smooth crossfade (`0.15–0.2 s`).
   * Returns duration (in seconds after `timeScale`), or `0` if missing.
   */
  play(
    key: BattleClipKey,
    opts: {
      once?: boolean;
      timeScale?: number;
      fade?: number;
      clampWhenFinished?: boolean;
    } = {}
  ): number {
    try {
      if (this.disposed || !this.mixer) {
        this.warnMissingOnce(key);
        return 0;
      }
      const clip = this.getClip(key);
      if (!clip) {
        this.warnMissingOnce(key);
        return 0;
      }
      const once = opts.once ?? !LOOPING_CLIP_KEYS.has(key);
      const res = this.playRawClip(clip, {
        once,
        timeScale: opts.timeScale,
        fade: opts.fade,
        clampWhenFinished: opts.clampWhenFinished ?? once,
      });
      return res?.duration ?? 0;
    } catch (err) {
      console.warn(`[battle/animation] Fehler beim Abspielen von "${key}":`, err);
      return 0;
    }
  }

  private async playClipActionAndWait(
    clip: THREE.AnimationClip,
    impactRatio: number,
    opts: {
      timeScale?: number;
      fade?: number;
      clampWhenFinished?: boolean;
      onImpact?: () => Promise<void> | void;
    }
  ): Promise<number> {
    const mixer = this.mixer;
    if (this.disposed || !mixer) return 0;

    const played = this.playRawClip(clip, {
      once: true,
      timeScale: opts.timeScale,
      fade: opts.fade,
      clampWhenFinished: opts.clampWhenFinished ?? true,
    });
    if (!played || played.duration <= 0) return 0;

    const { action, duration } = played;
    const impactMs = Math.max(0, Math.round(duration * impactRatio * 1000));
    const timeoutMs = Math.max(150, Math.ceil((duration + 0.5) * 1000));

    let impactDone = false;
    let impactPromise: Promise<void> | null = null;
    const triggerImpact = () => {
      if (impactDone || this.disposed) return;
      impactDone = true;
      if (!opts.onImpact) return;
      impactPromise = Promise.resolve(opts.onImpact()).catch((err) => {
        console.warn('[battle/animation] onImpact failed:', err);
      });
    };

    await new Promise<void>((resolve) => {
      let settled = false;
      let impactTimer: ReturnType<typeof setTimeout> | null = null;
      let safetyTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (impactTimer !== null) clearTimeout(impactTimer);
        if (safetyTimer !== null) clearTimeout(safetyTimer);
        mixer.removeEventListener('finished', onFinished);
        this.activeCleanups.delete(abortAndResolve);
      };

      const finishNow = () => {
        if (settled) return;
        settled = true;
        cleanup();
        triggerImpact();
        resolve();
      };

      const abortAndResolve = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const onFinished = (ev: { action?: THREE.AnimationAction }) => {
        if (ev?.action === action) finishNow();
      };

      this.activeCleanups.add(abortAndResolve);
      mixer.addEventListener('finished', onFinished);
      if (opts.onImpact) {
        impactTimer = setTimeout(triggerImpact, impactMs);
      }
      safetyTimer = setTimeout(finishNow, timeoutMs);
    });

    if (impactPromise) await impactPromise;
    return duration;
  }

  /**
   * Plays a one-shot clip, invokes `onImpact` at `duration * impactTime`, and waits
   * for `AnimationMixer` `'finished'` event bounded by safety timeout `duration + 0.5 s`.
   */
  async playOnceAndWait(
    key: BattleClipKey,
    opts: PlayOnceOptions = {}
  ): Promise<PlayOnceResult> {
    if (this.disposed || !this.mixer) {
      this.warnMissingOnce(key);
      return { played: false, duration: 0, resolvedKey: null };
    }

    let resolvedKey: BattleClipKey | null = this.getClip(key) ? key : null;
    let timeScale = opts.timeScale ?? 1;
    if (!resolvedKey) {
      this.warnMissingOnce(key);
      if (opts.fallbackKeys) {
        for (const fb of opts.fallbackKeys) {
          if (this.getClip(fb.key)) {
            resolvedKey = fb.key;
            if (fb.timeScale !== undefined) timeScale = fb.timeScale;
            break;
          }
        }
      }
    }
    if (!resolvedKey) {
      return { played: false, duration: 0, resolvedKey: null };
    }

    const clip = this.getClip(resolvedKey)!;
    const duration = await this.playClipActionAndWait(
      clip,
      this.getImpactTime(resolvedKey),
      {
        timeScale,
        fade: opts.fade,
        clampWhenFinished: opts.clampWhenFinished ?? true,
        onImpact: opts.onImpact,
      }
    );
    if (duration <= 0) {
      return { played: false, duration: 0, resolvedKey: null };
    }
    return { played: true, duration, resolvedKey };
  }

  /**
   * Plays a specific ability's configured clip (with its own impactTime), or falls
   * back to `'cast'` -> `'attack'` if no ability-specific clip is assigned.
   */
  async playAbilityOnceAndWait(
    abilityId: string | undefined,
    opts: { onImpact?: () => Promise<void> | void; fade?: number } = {}
  ): Promise<PlayOnceResult> {
    if (!this.disposed && this.mixer && abilityId) {
      const cfg = this.abilityAnims[abilityId];
      const clip = this.getAbilityClip(abilityId);
      if (clip) {
        const ratio = clampImpactRatio(cfg?.impactTime, this.getImpactTime('cast'));
        const duration = await this.playClipActionAndWait(clip, ratio, {
          fade: opts.fade,
          clampWhenFinished: true,
          onImpact: opts.onImpact,
        });
        if (duration > 0) {
          return { played: true, duration, resolvedKey: 'cast' };
        }
      }
    }
    return this.playOnceAndWait('cast', {
      fade: opts.fade,
      fallbackKeys: [{ key: 'attack' }],
      onImpact: opts.onImpact,
    });
  }

  /** Cancels any active playOnceAndWait listeners/timers without disabling future playback. */
  cancelPending(): void {
    for (const cancel of [...this.activeCleanups]) cancel();
    this.activeCleanups.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelPending();
  }
}

/**
 * Serializes asynchronous battle animation/event steps so actions never overlap
 * and pending waits unwind cleanly when the scene unmounts.
 */
export class BattleEventQueue {
  private tail: Promise<void> = Promise.resolve();
  private cleared = false;

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.cleared) return Promise.resolve(undefined as T);
    const run = this.tail.then(() => (this.cleared ? (undefined as T) : task()));
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  clear(): void {
    this.cleared = true;
  }
}
