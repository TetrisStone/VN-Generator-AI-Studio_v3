// Figure helpers for the battle scene and the marching party:
// battle animation resolution (section 13), procedural stand-in figures and
// the follower chain that walks behind the leader on its breadcrumb trail.
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Character } from '../../types';
import { createGLTFLoader, loadGlbArrayBuffer } from '../../utils/gltfLoader';
import { BattleAnimator, ensureUniqueMaterials, stripRootMotion } from '../../battle/animation';
import { resolveHeroStats, resolveSparkStats } from '../../battle/stats';
import type { ResolvedStats } from '../../battle/types';
import type { Tile } from '../../battle/detection';
import { BREADCRUMB_LENGTH } from '../../battle/config';

export { BattleAnimator as Animator, type BattleClipKey as ClipKind } from '../../battle/animation';

// ---------------------------------------------------------------------------
// Roster: 3 heroes + Spark. Derived from the project characters because the
// project has no party data yet.
// ---------------------------------------------------------------------------
export interface RosterEntry {
  id: string;
  name: string;
  characterId?: string;
  isSpark: boolean;
  stats: ResolvedStats;
  color: number;
}

const HERO_COLORS = [0x38bdf8, 0x34d399, 0xa78bfa];

/**
 * Party = first 3 non-Spark characters that are not evil (main characters
 * first) + the Spark character. Missing members are filled with defaults.
 * Marching order: leader, hero 2, Spark, hero 3.
 */
export function buildRoster(characters: Character[]): RosterEntry[] {
  const candidates = characters.filter(c => !c.isSpark && c.alignment !== 'boese');
  candidates.sort((a, b) => (a.importance === 'main' ? 0 : 1) - (b.importance === 'main' ? 0 : 1));
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

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
/** Loads the GLB of a project character (model3dSrc). Null when missing/broken. */
export async function loadCharacterGlb(c: Character | undefined): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] } | null> {
  if (!c?.model3dSrc) return null;
  try {
    const buffer = await loadGlbArrayBuffer(c.model3dSrc);
    if (!buffer) return null;
    return await new Promise(resolve => {
      createGLTFLoader().parse(buffer, '', g => resolve({ scene: g.scene, animations: g.animations || [] }), () => resolve(null));
    });
  } catch {
    return null;
  }
}

function proceduralHero(color: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.8, 4, 12), new THREE.MeshLambertMaterial({ color }));
  body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshLambertMaterial({ color: 0xffe4d6 }));
  head.position.y = 1.55;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1), new THREE.MeshLambertMaterial({ color: 0x1f2937 }));
  visor.position.set(0, 1.57, 0.18);
  g.add(body, head, visor);
  return g;
}

function sparkOrb(): THREE.Group {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 16), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  const light = new THREE.PointLight(0xfbbf24, 2.2, 5);
  g.add(core, halo, light);
  g.position.y = 1.2;
  g.userData.isOrb = true;
  return g;
}

export interface PartyFigure {
  entry: RosterEntry;
  root: THREE.Group;
  /** Holder of the visible model (procedural bob / sink happens here) */
  inner: THREE.Group;
  animator: BattleAnimator;
  tile: Tile;
  target: THREE.Vector3 | null;
  moving: boolean;
}

function buildFigure(
  entry: RosterEntry,
  glb: { scene: THREE.Group; animations: THREE.AnimationClip[] } | null,
  surfaceY: number,
  character?: Character
): PartyFigure {
  const root = new THREE.Group();
  root.name = `Party_${entry.id}`;
  const inner = new THREE.Group();
  let animator = new BattleAnimator(null, [], { characterName: entry.name });
  if (glb) {
    const model = cloneSkeleton(glb.scene) as THREE.Group;
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
    ensureUniqueMaterials(model);

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -box.min.y, -center.z);

    const baseScale = size.y > 0.001 ? (entry.isSpark ? 1.2 : 1.85) / size.y : 1;
    const userScale = character?.model3dScale ?? 1.0;
    const userOffsetY = character?.model3dOffsetY ?? 0.0;
    const userRotY = ((character?.model3dRotationY ?? 0) * Math.PI) / 180;

    const scaler = new THREE.Group();
    scaler.add(model);
    scaler.scale.setScalar(baseScale * userScale);
    scaler.position.set(0, userOffsetY, 0);
    scaler.rotation.y = userRotY;
    inner.add(scaler);

    const cleanClips = stripRootMotion(glb.animations, model);
    if (cleanClips.length > 0) {
      animator = new BattleAnimator(new THREE.AnimationMixer(model), cleanClips, {
        characterName: entry.name,
        model3dClips: character?.model3dClips,
        model3dImpactTimes: character?.model3dImpactTimes,
        model3dAbilityAnims: character?.model3dAbilityAnims,
      });
      animator.play('idle');
    }
  } else {
    inner.add(entry.isSpark ? sparkOrb() : proceduralHero(entry.color));
  }
  // root.y = floor surface (follows async floor loads), inner/shadow are local
  root.position.y = surfaceY;
  root.add(inner);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 20),
    new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: entry.isSpark ? 0.25 : 0.4, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  root.add(shadow);
  return { entry, root, inner, animator, tile: { col: 0, row: 0 }, target: null, moving: false };
}

// ---------------------------------------------------------------------------
// Party: followers behind the leader + breadcrumb trail of the leader
// ---------------------------------------------------------------------------
export class Party {
  readonly roster: RosterEntry[];
  followers: PartyFigure[] = [];
  /** Leader tiles, oldest -> newest (max BREADCRUMB_LENGTH) */
  trail: Tile[] = [];
  lastMoveDir: { x: number; z: number } | null = null;
  private group = new THREE.Group();
  private disposed = false;
  /** Running steps are finished quickly (battle start, ≤ 150 ms) */
  private rush = false;

  constructor(
    private scene: THREE.Scene,
    characters: Character[],
    private tileToWorld: (col: number, row: number) => THREE.Vector3,
    private isWalkable: (col: number, row: number) => boolean,
    private surfaceY: () => number
  ) {
    this.roster = buildRoster(characters);
    this.group.name = 'PartyFollowers';
    scene.add(this.group);
    // Placeholders immediately, GLBs replace them once loaded
    this.followers = this.roster.slice(1).map(e => buildFigure(e, null, this.surfaceY()));
    this.followers.forEach(f => this.group.add(f.root));
    void this.loadModels(characters);
  }

  get leaderEntry(): RosterEntry {
    return this.roster[0];
  }

  private async loadModels(characters: Character[]) {
    for (let k = 0; k < this.followers.length; k++) {
      const f = this.followers[k];
      const char = characters.find(c => c.id === f.entry.characterId);
      const glb = await loadCharacterGlb(char);
      if (!glb || this.disposed) continue;
      f.animator.dispose();
      const nf = buildFigure(f.entry, glb, this.surfaceY(), char);
      nf.tile = f.tile;
      nf.root.position.copy(f.root.position);
      nf.root.rotation.y = f.root.rotation.y;
      nf.root.visible = f.root.visible;
      this.group.remove(f.root);
      this.group.add(nf.root);
      this.followers[k] = nf;
    }
  }

  dispose() {
    this.disposed = true;
    for (const f of this.followers) f.animator.dispose();
    this.scene.remove(this.group);
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  /** Nearest distinct walkable tiles around the leader (BFS), preferring the trail */
  private tilesAround(leader: Tile, count: number): Tile[] {
    const out: Tile[] = [];
    const used = new Set([`${leader.col},${leader.row}`]);
    for (let k = this.trail.length - 2; k >= 0 && out.length < count; k--) {
      const t = this.trail[k];
      const key = `${t.col},${t.row}`;
      if (used.has(key) || !this.isWalkable(t.col, t.row)) continue;
      // trail tiles must stay close to the leader to form a chain
      if (Math.abs(t.col - leader.col) + Math.abs(t.row - leader.row) > out.length + 1) break;
      used.add(key);
      out.push(t);
    }
    const queue: Tile[] = [leader];
    const seen = new Set([`${leader.col},${leader.row}`]);
    for (let head = 0; head < queue.length && out.length < count && head < 400; head++) {
      const cur = queue[head];
      for (const n of [{ col: cur.col, row: cur.row - 1 }, { col: cur.col - 1, row: cur.row }, { col: cur.col + 1, row: cur.row }, { col: cur.col, row: cur.row + 1 }]) {
        const key = `${n.col},${n.row}`;
        if (seen.has(key) || !this.isWalkable(n.col, n.row)) continue;
        seen.add(key);
        queue.push(n);
        if (!used.has(key) && out.length < count) {
          used.add(key);
          out.push(n);
        }
      }
    }
    while (out.length < count) out.push({ ...leader });
    return out;
  }

  /** Instantly re-forms the chain around the leader (spawn, teleport, respawn) */
  resetAround(leader: Tile, keepTrail = false) {
    if (!keepTrail) this.trail = [{ ...leader }];
    const tiles = this.tilesAround(leader, this.followers.length);
    this.followers.forEach((f, k) => {
      f.tile = tiles[k];
      f.target = null;
      f.moving = false;
      const p = this.tileToWorld(f.tile.col, f.tile.row);
      f.root.position.set(p.x, this.surfaceY(), p.z);
      f.root.visible = true;
      f.animator.play('idle');
    });
  }

  /** Followers walk to chain tiles behind the leader (after a victory) */
  regroup(leader: Tile) {
    const tiles = this.tilesAround(leader, this.followers.length);
    this.followers.forEach((f, k) => this.walkTo(f, tiles[k]));
    this.pushTrail(leader);
  }

  private walkTo(f: PartyFigure, t: Tile) {
    f.tile = { ...t };
    const p = this.tileToWorld(t.col, t.row);
    f.target = new THREE.Vector3(p.x, 0, p.z);
  }

  private pushTrail(t: Tile) {
    const last = this.trail[this.trail.length - 1];
    if (last && last.col === t.col && last.row === t.row) return;
    this.trail.push({ ...t });
    if (this.trail.length > BREADCRUMB_LENGTH) this.trail.shift();
  }

  /** Leader reached a new tile: every follower steps onto its predecessor's tile */
  onLeaderArrive(newTile: Tile, prevTile: Tile) {
    this.lastMoveDir = { x: newTile.col - prevTile.col, z: newTile.row - prevTile.row };
    this.pushTrail(newTile);
    const prev = [prevTile, ...this.followers.map(f => f.tile)];
    this.followers.forEach((f, k) => {
      const t = prev[k];
      if (t.col !== f.tile.col || t.row !== f.tile.row) this.walkTo(f, t);
    });
  }

  memberTiles(leader: Tile): Tile[] {
    return [leader, ...this.followers.map(f => f.tile)];
  }

  /** Finish running steps quickly (battle start, ≤ 150 ms) */
  hurry() {
    this.rush = this.followers.some(f => !!f.target);
  }

  tick(delta: number, elapsed: number, speed: number, frozen: boolean) {
    const surface = this.surfaceY();
    let anyTarget = false;
    for (const f of this.followers) {
      f.animator.mixer?.update(delta);
      if (f.entry.isSpark) {
        const orb = f.inner.children[0];
        if (orb?.userData?.isOrb) orb.position.y = 1.2 + Math.sin(elapsed * 2.2) * 0.08;
      }
      // While frozen (battle) the battle director owns position and height
      if (!frozen) f.root.position.y = surface;
      if (!f.target || (frozen && !this.rush)) {
        if (f.moving && !f.target) {
          f.moving = false;
          f.inner.position.y = 0;
          f.animator.play('idle');
        }
        continue;
      }
      anyTarget = true;
      const pos = f.root.position;
      const dx = f.target.x - pos.x;
      const dz = f.target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      const stepSpeed = this.rush ? Math.max(speed * 6, dist / 0.15) : speed * 1.15;
      const step = stepSpeed * delta;
      if (!f.moving) {
        f.moving = true;
        f.animator.play('run', { timeScale: f.animator.runTimeScale(stepSpeed) });
      }
      if (dist > 0.001) f.root.rotation.y = Math.atan2(dx, dz);
      if (dist <= step) {
        pos.x = f.target.x;
        pos.z = f.target.z;
        f.target = null;
      } else {
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;
      }
      if (!f.animator.has('run') && !f.entry.isSpark) f.inner.position.y = Math.abs(Math.sin(elapsed * 12)) * 0.05;
    }
    if (!anyTarget) this.rush = false;
  }
}
