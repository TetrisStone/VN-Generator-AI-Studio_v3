// Unified 3D GLB Animation Mapper (Character Editor + Dungeon Builder Modal):
// extracts GLB clip names, auto-maps BattleClipKeys (incl. combat_idle),
// supports per-ability clip + impactTime + melee/ranged approach, and live 3D preview.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Film, Play, RotateCcw, Loader2, Zap, X, Swords, Sparkles, Activity } from 'lucide-react';
import type { AbilityAnimConfig, BattleClipKey, Character } from '../../types';
import { createGLTFLoader, loadGlbArrayBuffer } from '../../utils/gltfLoader';
import { ABILITIES } from '../../battle/abilities';
import {
  DEFAULT_IMPACT_TIME,
  LOOPING_CLIP_KEYS,
  autoMapClipNames,
  clampImpactRatio,
  computeCharacterBounds,
  defaultAbilityApproach,
  isCombatClipKey,
  resolveImpactTime,
  setBattleWeaponsVisible,
  stripRootMotion,
} from '../../battle/animation';

export interface AnimationConfigPatch {
  model3dClips?: Partial<Record<BattleClipKey, string>>;
  model3dImpactTimes?: Partial<Record<BattleClipKey, number>>;
  model3dAbilityAnims?: Record<string, AbilityAnimConfig>;
}

export interface Model3dAnimationEditorProps {
  modelSrc: string;
  title?: string;
  rotationY?: number;
  clips?: Partial<Record<BattleClipKey, string>>;
  impactTimes?: Partial<Record<BattleClipKey, number>>;
  abilityAnims?: Record<string, AbilityAnimConfig>;
  onChange: (patch: AnimationConfigPatch) => void;
}

const ATTACK_KEYS: BattleClipKey[] = ['attack', 'attack_heavy'];
const STATE_KEYS: BattleClipKey[] = ['idle', 'combat_idle', 'run', 'block', 'hit', 'dizzy', 'defeat', 'victory'];

const SHORT_LABELS: Record<BattleClipKey, { title: string; hint: string }> = {
  idle: { title: 'Ruhe (Erkundung)', hint: 'Außerhalb des Kampfes im Dungeon' },
  combat_idle: { title: 'Kampf-Ruhe', hint: 'Bereit-Pose während eines Kampfes (sonst wie Ruhe)' },
  run: { title: 'Laufen', hint: 'Bei Bewegung im Dungeon und zum Gegner' },
  attack: { title: 'Normaler Hit', hint: 'Standard-Nahkampfangriff (1 AP)' },
  attack_heavy: { title: 'Starker Hit', hint: 'Schwerer Angriff (2 AP)' },
  block: { title: 'Block / Schutz', hint: 'Schleife, solange Block/Schildwall aktiv ist' },
  cast: { title: 'Standard-Zauber (Fallback)', hint: 'Wenn für eine Fähigkeit unten kein eigener Clip gewählt ist' },
  hit: { title: 'Trefferreaktion', hint: 'Wenn diese Figur Schaden erleidet' },
  dizzy: { title: 'Wanken (Dizzy)', hint: 'Endlosschleife bei 0 LP/Kraft vor dem Gnadenstoß' },
  defeat: { title: 'Besiegt', hint: 'Spielt einmal ab, hält den letzten Frame, blendet aus' },
  victory: { title: 'Sieg', hint: 'Spielt bei gewonnenem Kampf für aktive Helden ab' },
};

function disposeSceneResources(obj: THREE.Object3D): void {
  obj.traverse((child: any) => {
    if (child.geometry?.dispose) child.geometry.dispose();
    const mats = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.map?.dispose) mat.map.dispose();
      if (mat.normalMap?.dispose) mat.normalMap.dispose();
      if (mat.roughnessMap?.dispose) mat.roughnessMap.dispose();
      if (mat.dispose) mat.dispose();
    }
  });
}

export const Model3dAnimationEditor: React.FC<Model3dAnimationEditorProps> = ({
  modelSrc,
  title,
  rotationY = 0,
  clips: clipsOverride,
  impactTimes,
  abilityAnims,
  onChange,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const loadedModelRef = useRef<THREE.Group | null>(null);
  const clipsByNameRef = useRef<Map<string, THREE.AnimationClip>>(new Map());
  const activeActionRef = useRef<THREE.AnimationAction | null>(null);
  const impactTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashOffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishCleanupRef = useRef<(() => void) | null>(null);

  const [glbClips, setGlbClips] = useState<Array<{ name: string; duration: number }>>([]);
  const [hasBattleWeapon, setHasBattleWeapon] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState<string>('idle');
  const [impactFlash, setImpactFlash] = useState(false);

  const autoMap = useMemo(
    () => autoMapClipNames(glbClips.map((c) => c.name)),
    [glbClips]
  );

  const effectiveMap = useMemo(
    () => autoMapClipNames(glbClips.map((c) => c.name), { model3dClips: clipsOverride }),
    [glbClips, clipsOverride]
  );

  const clipDurations = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of glbClips) m.set(c.name, c.duration);
    return m;
  }, [glbClips]);

  const stopPreviewTimers = () => {
    if (impactTimerRef.current !== null) {
      clearTimeout(impactTimerRef.current);
      impactTimerRef.current = null;
    }
    if (flashOffTimerRef.current !== null) {
      clearTimeout(flashOffTimerRef.current);
      flashOffTimerRef.current = null;
    }
    finishCleanupRef.current?.();
    finishCleanupRef.current = null;
  };

  const playClipPreview = (
    label: string,
    clipName: string | undefined,
    opts: { looping?: boolean; holdLastFrame?: boolean; impactRatio?: number; inBattle?: boolean } = {}
  ) => {
    stopPreviewTimers();
    setPreviewLabel(label);
    setImpactFlash(false);
    if (opts.inBattle !== undefined) {
      setBattleWeaponsVisible(loadedModelRef.current, opts.inBattle);
    }

    const mixer = mixerRef.current;
    if (!mixer || !clipName) return;
    const clip = clipsByNameRef.current.get(clipName);
    if (!clip) return;

    const looping = opts.looping ?? false;
    const action = mixer.clipAction(clip);
    action.enabled = true;
    action.reset();
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    if (looping) {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    } else {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    if (activeActionRef.current && activeActionRef.current !== action) {
      activeActionRef.current.crossFadeTo(action, 0.18, false);
    } else {
      action.fadeIn(0.18);
    }
    action.play();
    activeActionRef.current = action;

    if (opts.impactRatio !== undefined && clip.duration > 0) {
      impactTimerRef.current = setTimeout(() => {
        setImpactFlash(true);
        flashOffTimerRef.current = setTimeout(() => setImpactFlash(false), 400);
      }, Math.round(clip.duration * opts.impactRatio * 1000));
    }

    if (!looping && !opts.holdLastFrame) {
      const restName = effectiveMap.combat_idle || effectiveMap.idle;
      const restClip = restName ? clipsByNameRef.current.get(restName) : undefined;
      const onFinished = (ev: { action?: THREE.AnimationAction }) => {
        if (ev?.action !== action) return;
        mixer.removeEventListener('finished', onFinished);
        finishCleanupRef.current = null;
        if (restClip) {
          const restAction = mixer.clipAction(restClip);
          restAction.enabled = true;
          restAction.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1);
          action.crossFadeTo(restAction, 0.18, false);
          restAction.play();
          activeActionRef.current = restAction;
        }
      };
      mixer.addEventListener('finished', onFinished);
      finishCleanupRef.current = () => mixer.removeEventListener('finished', onFinished);
    }
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!modelSrc || !container) {
      setGlbClips([]);
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let loadedModel: THREE.Group | null = null;

    setIsLoading(true);
    setLoadError(null);

    const setup = async () => {
      const buffer = await loadGlbArrayBuffer(modelSrc);
      if (cancelled) return;
      if (!buffer) {
        setLoadError('GLB-Datei konnte nicht geladen werden.');
        setIsLoading(false);
        return;
      }

      const gltf = await new Promise<any>((resolve, reject) => {
        createGLTFLoader().parse(buffer, '', resolve, reject);
      });
      if (cancelled || !mountRef.current) return;

      const width = Math.max(220, container.clientWidth || 260);
      const height = 240;
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      container.innerHTML = '';
      container.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 50);
      camera.position.set(0, 1.35, 3.35);
      camera.lookAt(0, 0.9, 0);

      scene.add(new THREE.HemisphereLight(0xeef6ff, 0x1e293b, 1.35));
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
      keyLight.position.set(2.5, 4, 3);
      scene.add(keyLight);

      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.95, 24),
        new THREE.MeshBasicMaterial({ color: 0x164e63, transparent: true, opacity: 0.35 })
      );
      disc.rotation.x = -Math.PI / 2;
      scene.add(disc);

      const model = gltf.scene as THREE.Group;
      loadedModel = model;
      loadedModelRef.current = model;
      model.traverse((o: any) => {
        if (o.isMesh) {
          o.frustumCulled = false;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m: any) => {
            if (m?.map) {
              m.map.colorSpace = THREE.SRGBColorSpace;
              m.map.needsUpdate = true;
            }
          });
        }
      });

      const box = computeCharacterBounds(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -box.min.y, -center.z);
      const baseScale = size.y > 0.001 ? 1.8 / size.y : 1;

      const turntable = new THREE.Group();
      const adjuster = new THREE.Group();
      adjuster.add(model);
      adjuster.scale.setScalar(baseScale);
      adjuster.rotation.y = (rotationY * Math.PI) / 180;
      turntable.add(adjuster);
      scene.add(turntable);

      let dragging = false;
      let lastX = 0;
      const dom = renderer.domElement;
      const onDown = (e: PointerEvent) => {
        dragging = true;
        lastX = e.clientX;
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        turntable.rotation.y += (e.clientX - lastX) * 0.012;
        lastX = e.clientX;
      };
      const onUp = () => {
        dragging = false;
      };
      dom.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);

      const stripped = stripRootMotion(gltf.animations || [], model);
      clipsByNameRef.current = new Map(stripped.map((c) => [c.name, c]));
      const list = stripped.map((c) => ({ name: c.name, duration: c.duration }));
      setGlbClips(list);

      const mixer = new THREE.AnimationMixer(model);
      mixerRef.current = mixer;
      const initialMap = autoMapClipNames(
        stripped.map((c) => c.name),
        { model3dClips: clipsOverride }
      );
      setHasBattleWeapon(setBattleWeaponsVisible(model, !!initialMap.combat_idle));
      const startClipName = initialMap.combat_idle || initialMap.idle;
      if (startClipName) {
        const startClip = clipsByNameRef.current.get(startClipName);
        if (startClip) {
          const action = mixer.clipAction(startClip);
          action.setLoop(THREE.LoopRepeat, Infinity).play();
          activeActionRef.current = action;
          setPreviewLabel(initialMap.combat_idle ? 'Kampf-Ruhe' : 'Ruhe');
        }
      }

      const clock = new THREE.Clock();
      const animate = () => {
        if (cancelled) return;
        rafId = requestAnimationFrame(animate);
        mixer.update(Math.min(0.1, clock.getDelta()));
        renderer?.render(scene!, camera);
      };
      animate();
      setIsLoading(false);

      return () => {
        dom.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
    };

    let removeListeners: (() => void) | undefined;
    setup()
      .then((cleanupFn) => {
        if (cancelled) cleanupFn?.();
        else removeListeners = cleanupFn;
      })
      .catch((err) => {
        console.error('Failed to preview GLB clips:', err);
        if (!cancelled) {
          setLoadError('GLB-Vorschau konnte nicht initialisiert werden.');
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stopPreviewTimers();
      removeListeners?.();
      mixerRef.current?.stopAllAction();
      mixerRef.current = null;
      loadedModelRef.current = null;
      setHasBattleWeapon(false);
      activeActionRef.current = null;
      clipsByNameRef.current.clear();
      if (loadedModel) disposeSceneResources(loadedModel);
      if (scene) disposeSceneResources(scene);
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
      if (container) container.innerHTML = '';
    };
  }, [modelSrc]);

  const emitPatch = (next: Partial<AnimationConfigPatch>) => {
    onChange({
      model3dClips: 'model3dClips' in next ? next.model3dClips : clipsOverride,
      model3dImpactTimes: 'model3dImpactTimes' in next ? next.model3dImpactTimes : impactTimes,
      model3dAbilityAnims: 'model3dAbilityAnims' in next ? next.model3dAbilityAnims : abilityAnims,
    });
  };

  const setClipOverride = (key: BattleClipKey, clipName: string) => {
    const next = { ...(clipsOverride || {}) };
    if (clipName) next[key] = clipName;
    else delete next[key];
    const clean = Object.keys(next).length > 0 ? next : undefined;
    emitPatch({ model3dClips: clean });
    const targetClip = clipName || autoMap[key];
    if (targetClip) {
      const hasImpact = key === 'attack' || key === 'attack_heavy' || key === 'cast';
      playClipPreview(SHORT_LABELS[key].title, targetClip, {
        looping: LOOPING_CLIP_KEYS.has(key),
        holdLastFrame: key === 'defeat',
        impactRatio: hasImpact ? resolveImpactTime(key, impactTimes) : undefined,
        inBattle: isCombatClipKey(key),
      });
    }
  };

  const setImpactOverride = (key: BattleClipKey, val: number) => {
    emitPatch({ model3dImpactTimes: { ...(impactTimes || {}), [key]: val } });
  };

  const updateAbilityAnim = (abilityId: string, patch: Partial<AbilityAnimConfig>) => {
    const nextMap = { ...(abilityAnims || {}) };
    const merged: AbilityAnimConfig = { ...(nextMap[abilityId] || {}), ...patch };
    if (!merged.clip) delete merged.clip;
    if (merged.impactTime === undefined) delete merged.impactTime;
    if (!merged.approach) delete merged.approach;
    if (Object.keys(merged).length === 0) delete nextMap[abilityId];
    else nextMap[abilityId] = merged;
    emitPatch({
      model3dAbilityAnims: Object.keys(nextMap).length > 0 ? nextMap : undefined,
    });
  };

  const hasCustomOverrides =
    !!(clipsOverride && Object.keys(clipsOverride).length > 0) ||
    !!(impactTimes && Object.keys(impactTimes).length > 0) ||
    !!(abilityAnims && Object.keys(abilityAnims).length > 0);

  const renderStandardKeyRow = (key: BattleClipKey, withImpactSlider: boolean) => {
    const explicit = clipsOverride?.[key] ?? '';
    const resolved = effectiveMap[key];
    const autoName = autoMap[key];
    const impactRatio = resolveImpactTime(key, impactTimes);
    const clipDur = resolved ? clipDurations.get(resolved) ?? 0 : 0;
    const meta = SHORT_LABELS[key];

    return (
      <div key={key} className="bg-gray-950/70 border border-gray-800 rounded-lg px-2.5 py-2 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44 shrink-0">
            <div className="text-xs font-semibold text-gray-200">{meta.title}</div>
            <div className="text-[10px] text-gray-500 leading-tight">{meta.hint}</div>
          </div>
          <select
            className="flex-1 min-w-[160px] bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-cyan-500 outline-none font-mono"
            value={explicit}
            onChange={(e) => setClipOverride(key, e.target.value)}
          >
            <option value="">Automatisch ({autoName || 'Ersatz-Animation'})</option>
            {glbClips.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.duration.toFixed(2)} s)
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!resolved}
            onClick={() =>
              playClipPreview(meta.title, resolved, {
                looping: LOOPING_CLIP_KEYS.has(key),
                holdLastFrame: key === 'defeat',
                impactRatio: withImpactSlider ? impactRatio : undefined,
                inBattle: isCombatClipKey(key),
              })
            }
            className="px-2.5 py-1 rounded bg-cyan-700/80 hover:bg-cyan-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-semibold flex items-center gap-1 transition-colors"
            title={resolved ? `Clip "${resolved}" abspielen` : 'Kein Clip vorhanden'}
          >
            <Play size={11} /> Test
          </button>
        </div>

        {withImpactSlider && (
          <div className="flex items-center gap-3 pl-1 text-[11px] text-gray-400">
            <span className="w-44 shrink-0 text-gray-500">Trefferzeitpunkt:</span>
            <input
              type="range"
              min="0.05"
              max="0.95"
              step="0.05"
              value={impactRatio}
              onChange={(e) => setImpactOverride(key, parseFloat(e.target.value))}
              className="flex-1 accent-cyan-400"
            />
            <span className="font-mono text-cyan-300 w-24 text-right tabular-nums">
              {Math.round(impactRatio * 100)} %
              {clipDur > 0 ? ` (${(clipDur * impactRatio).toFixed(2)}s)` : ''}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-cyan-300 flex items-center gap-2">
            <Film size={15} /> {title ? `3D-Animationen: ${title}` : '3D-Animationen'}
          </h4>
          <p className="text-[11px] text-gray-400">
            Ordne den Standard-Aktionen und jeder einzelnen Fähigkeit gezielt einen GLB-Clip + Trefferzeitpunkt zu.
          </p>
        </div>
        {hasCustomOverrides && (
          <button
            type="button"
            onClick={() => onChange({ model3dClips: undefined, model3dImpactTimes: undefined, model3dAbilityAnims: undefined })}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600 flex items-center gap-1"
            title="Alle manuellen Zuordnungen auf Automatik zurücksetzen"
          >
            <RotateCcw size={12} /> Alle auf Automatik
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Live 3D Clip Preview */}
        <div className="lg:col-span-4 bg-gray-950/90 border border-gray-800 rounded-xl p-2 relative sticky top-0">
          <div
            ref={mountRef}
            className="w-full h-[240px] rounded-lg overflow-hidden cursor-grab active:cursor-grabbing flex items-center justify-center bg-gradient-to-b from-gray-900/70 to-gray-950"
          />
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 rounded-xl text-xs text-cyan-300 gap-2">
              <Loader2 size={16} className="animate-spin" /> Lade 3D-Clips...
            </div>
          )}
          {loadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950/90 rounded-xl text-xs text-rose-300 p-4 text-center">
              {loadError}
            </div>
          )}
          {impactFlash && (
            <div className="absolute top-4 right-4 px-2 py-0.5 rounded bg-amber-400 text-black text-[11px] font-black flex items-center gap-1 shadow-lg animate-pulse">
              <Zap size={12} /> Treffer!
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-gray-400 px-1 gap-2">
            <span className="truncate">Vorschau: <b className="text-cyan-200">{previewLabel}</b></span>
            <span className="shrink-0 flex items-center gap-2">
              {hasBattleWeapon && <span className="text-amber-300 font-semibold">⚔ Waffe im Kampf</span>}
              <span>{glbClips.length} Clips</span>
            </span>
          </div>
        </div>

        {/* Grouped Mapping Rows */}
        <div className="lg:col-span-8 space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {glbClips.length === 0 && !isLoading && !loadError && (
            <div className="text-xs text-amber-300/90 bg-amber-950/40 border border-amber-800/50 rounded-lg p-3">
              Diese GLB-Datei enthält keine Animations-Clips. Im Kampf greifen automatisch die prozeduralen Ersatz-Animationen.
            </div>
          )}

          {/* 1. Standard Attacks */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-300 flex items-center gap-1.5 px-1">
              <Swords size={12} /> Standard-Angriffe
            </div>
            {ATTACK_KEYS.map((k) => renderStandardKeyRow(k, true))}
          </div>

          {/* 2. Per-Ability Animations */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5 px-1">
              <Sparkles size={12} /> Fähigkeiten (je Fähigkeit eigener Clip wählbar)
            </div>
            {renderStandardKeyRow('cast', true)}
            {ABILITIES.map((ab) => {
              const cfg = abilityAnims?.[ab.id];
              const fallbackClip = effectiveMap.cast || effectiveMap.attack;
              const resolvedClip =
                cfg?.clip && clipDurations.has(cfg.clip) ? cfg.clip : fallbackClip;
              const approach = cfg?.approach ?? defaultAbilityApproach(ab.id);
              const impactRatio = clampImpactRatio(
                cfg?.impactTime,
                resolveImpactTime('cast', impactTimes)
              );
              const clipDur = resolvedClip ? clipDurations.get(resolvedClip) ?? 0 : 0;

              return (
                <div key={ab.id} className="bg-gray-950/70 border border-purple-900/40 rounded-lg px-2.5 py-2 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-44 shrink-0">
                      <div className="text-xs font-semibold text-purple-200">{ab.name}</div>
                      <div className="text-[10px] text-gray-500 leading-tight truncate" title={ab.description}>
                        {ab.apCost} AP · {ab.description}
                      </div>
                    </div>
                    <select
                      className="flex-1 min-w-[160px] bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-purple-400 outline-none font-mono"
                      value={cfg?.clip ?? ''}
                      onChange={(e) => {
                        const clip = e.target.value || undefined;
                        updateAbilityAnim(ab.id, { clip });
                        const target = clip || fallbackClip;
                        if (target) {
                          playClipPreview(ab.name, target, { impactRatio, inBattle: true });
                        }
                      }}
                    >
                      <option value="">
                        Standard ({fallbackClip ? fallbackClip : 'Ersatz-Animation'})
                      </option>
                      {glbClips.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name} ({c.duration.toFixed(2)} s)
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        updateAbilityAnim(ab.id, {
                          approach: approach === 'melee' ? 'ranged' : 'melee',
                        })
                      }
                      className={`px-2 py-1 rounded border text-[11px] font-semibold transition-colors ${
                        approach === 'melee'
                          ? 'bg-amber-950/70 border-amber-700/60 text-amber-200 hover:bg-amber-900/70'
                          : 'bg-indigo-950/70 border-indigo-700/60 text-indigo-200 hover:bg-indigo-900/70'
                      }`}
                      title={
                        approach === 'melee'
                          ? 'Nahkampf: Figur läuft für diese Fähigkeit vor an die Chunk-Kante'
                          : 'Am Platz: Figur wirkt diese Fähigkeit von ihrer Kachel aus'
                      }
                    >
                      {approach === 'melee' ? 'Läuft vor' : 'Am Platz'}
                    </button>
                    <button
                      type="button"
                      disabled={!resolvedClip}
                      onClick={() => playClipPreview(ab.name, resolvedClip, { impactRatio, inBattle: true })}
                      className="px-2.5 py-1 rounded bg-purple-700/80 hover:bg-purple-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-semibold flex items-center gap-1 transition-colors"
                      title={resolvedClip ? `Clip "${resolvedClip}" abspielen` : 'Kein Clip vorhanden'}
                    >
                      <Play size={11} /> Test
                    </button>
                  </div>

                  {cfg?.clip && (
                    <div className="flex items-center gap-3 pl-1 text-[11px] text-gray-400">
                      <span className="w-44 shrink-0 text-gray-500">Trefferzeitpunkt:</span>
                      <input
                        type="range"
                        min="0.05"
                        max="0.95"
                        step="0.05"
                        value={impactRatio}
                        onChange={(e) =>
                          updateAbilityAnim(ab.id, { impactTime: parseFloat(e.target.value) })
                        }
                        className="flex-1 accent-purple-400"
                      />
                      <span className="font-mono text-purple-300 w-24 text-right tabular-nums">
                        {Math.round(impactRatio * 100)} %
                        {clipDur > 0 ? ` (${(clipDur * impactRatio).toFixed(2)}s)` : ''}
                      </span>
                      {impactRatio !== DEFAULT_IMPACT_TIME && (
                        <button
                          type="button"
                          onClick={() => updateAbilityAnim(ab.id, { impactTime: undefined })}
                          className="text-[10px] text-gray-500 hover:text-gray-300"
                          title="Auf 50% zurücksetzen"
                        >
                          50%
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 3. Movement & Status States */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5 px-1">
              <Activity size={12} /> Bewegung &amp; Zustände
            </div>
            {STATE_KEYS.map((k) => renderStandardKeyRow(k, false))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const CharacterModel3dAnimations: React.FC<{
  character: Character;
  onChange: (u: Partial<Character>) => void;
}> = ({ character, onChange }) => {
  if (!character.model3dSrc) return null;
  return (
    <div className="bg-gray-900/75 border border-gray-700/80 rounded-xl p-4 mt-2">
      <Model3dAnimationEditor
        modelSrc={character.model3dSrc}
        title={character.name}
        rotationY={character.model3dRotationY}
        clips={character.model3dClips}
        impactTimes={character.model3dImpactTimes}
        abilityAnims={character.model3dAbilityAnims}
        onChange={(patch) => onChange(patch)}
      />
    </div>
  );
};

export const Model3dAnimationModal: React.FC<
  Model3dAnimationEditorProps & { onClose: () => void }
> = ({ onClose, ...editorProps }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-900 border border-cyan-500/40 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold flex items-center gap-1.5 border border-gray-700"
          >
            <X size={14} /> Fertig (Esc)
          </button>
        </div>
        <Model3dAnimationEditor {...editorProps} />
      </div>
    </div>
  );
};
