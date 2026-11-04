// Binds the pure battle engine to the existing Three.js dungeon scene:
// detection, arena grids, camera, figure movement and event playback.
// DungeonTestView only provides a BattleBridge and forwards input / ticks.
import * as THREE from 'three';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Character } from '../../types';
import { chooseRespawnTile, detectEncounter, selectEnemyGroup, tileDist, type EnemyCandidate, type Encounter, type Tile } from '../../battle/detection';
import { gridToWorldTile, placeSide, selectArena, type Arena, type Chunk } from '../../battle/arena';
import {
  actionUnavailableReason, actorHasOptions, applyAction, createBattle, endTurn, enemyTurnOrder, getCombatant,
  hasAnyValidAction, needsSingleTarget, startTurn, validTargets, enemyPersistence,
} from '../../battle/engine';
import { decideEnemyAction } from '../../battle/ai';
import { resolveEnemyStats } from '../../battle/stats';
import { randomSeed } from '../../battle/rng';
import { getAbility } from '../../battle/abilities';
import type { ActionId, BattleAction, BattleEvent, BattleState, CombatantInit, GridPos, Outcome, Side } from '../../battle/types';
import { Animator, type ClipKind, type Party } from './figures';

// ---------------------------------------------------------------------------
// Bridge & UI types
// ---------------------------------------------------------------------------
export interface PlacedFigureLike {
  id: string;
  kind: 'npc' | 'enemy';
  libraryId: string;
  col: number;
  row: number;
  rotationY: number;
  sectionId?: string;
  characterId?: string;
  groupId?: string;
}

export type EnemyStateMap = Record<string, { kraft?: number; defeated?: boolean }>;

export interface BattleBridge {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  camTarget: THREE.Vector3;
  container: HTMLElement;
  getFrustum(): number;
  setFrustum(f: number): void;
  tileSize: number;
  /** World position of a sub-tile (y = floor surface) */
  tileToWorld(col: number, row: number): THREE.Vector3;
  /** Walkable sub-tile of the CURRENT section */
  isWalkable(col: number, row: number): boolean;
  section(): string;
  dungeonId(): string;
  characters(): Character[];
  party(): Party | null;
  figures(): PlacedFigureLike[];
  figureHolder(id: string): THREE.Object3D | undefined;
  figureName(f: PlacedFigureLike): string;
  leaderRoot(): THREE.Object3D | null;
  leaderTile(): Tile;
  leaderAnimator(): Animator;
  leaderStop(): void;
  /** Sync the movement engine after the battle moved / teleported the leader */
  leaderSync(tile: Tile, facing: number): void;
  enemyState(): EnemyStateMap;
  persistEnemyState(patch: EnemyStateMap): void;
  onFinished(): void;
}

export interface BattleFloater {
  id: number;
  x: number;
  y: number;
  text: string;
  kind: 'damage' | 'heal' | 'coup' | 'kraft' | 'info' | 'block';
}

export interface BattleUi {
  active: boolean;
  inputEnabled: boolean;
  state: BattleState | null;
  banner: { text: string; tone: 'hero' | 'enemy' | 'victory' | 'defeat' } | null;
  selectedId: string | null;
  actionId: ActionId | null;
  hoverTargetId: string | null;
  validTargetIds: string[];
  floaters: BattleFloater[];
  anchors: Record<string, { x: number; y: number }>;
  message: string | null;
  defeatText: string | null;
}

export const INITIAL_BATTLE_UI: BattleUi = {
  active: false,
  inputEnabled: false,
  state: null,
  banner: null,
  selectedId: null,
  actionId: null,
  hoverTargetId: null,
  validTargetIds: [],
  floaters: [],
  anchors: {},
  message: null,
  defeatText: null,
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------
interface Fighter {
  id: string;
  side: Side;
  isLeader: boolean;
  root: THREE.Object3D;
  baseY: number;
  anim: () => Animator;
  home: THREE.Vector3;
  /** Enemies: dungeon start transform (defeat reset) */
  origin?: { x: number; z: number; rotY: number; tile: Tile };
  /** Fallback figure created for the battle only (removed afterwards) */
  temp?: boolean;
  stars: THREE.Group;
  shield: THREE.Mesh;
  shownStatus: 'active' | 'dizzy' | 'defeated';
  shake: number;
}

interface GridTile {
  side: Side;
  pos: GridPos;
  fill: THREE.Mesh;
  border: THREE.Mesh;
  phase: number;
}

interface Tween {
  t: number;
  dur: number;
  fn: (k: number) => void;
  resolve: () => void;
}

const HERO_GRID = new THREE.Color(0x22d3ee);
const ENEMY_GRID = new THREE.Color(0xf97316);
const TARGET_HERO = new THREE.Color(0x4ade80);
const TARGET_ENEMY = new THREE.Color(0xfde047);
const SELECTED = new THREE.Color(0x93c5fd);
const INVALID = new THREE.Color(0x475569);
const WHITE = new THREE.Color(0xffffff);

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

// ---------------------------------------------------------------------------
// Director
// ---------------------------------------------------------------------------
export class BattleDirector {
  ui: BattleUi = { ...INITIAL_BATTLE_UI };
  active = false;
  /** Detection paused after a defeat until the first movement input */
  paused = false;
  /** Leader walks during the battle (procedural run pose in the host loop) */
  leaderMoving = false;

  private state: BattleState | null = null;
  private arena: Arena | null = null;
  private fighters = new Map<string, Fighter>();
  private hidden: THREE.Object3D[] = [];
  private grid: GridTile[] = [];
  private gridGroup: THREE.Group | null = null;
  private gridAlpha = 0;
  private fx = new THREE.Group();
  private tweens: Tween[] = [];
  private savedCam: { pos: THREE.Vector3; target: THREE.Vector3; frustum: number } | null = null;
  private hoverKey: string | null = null;
  private floaterSeq = 1;
  private elapsed = 0;
  private disposed = false;
  private raycaster = new THREE.Raycaster();
  private involvedEnemyOrigins: Array<Tile & { ini: number }> = [];
  private onResize = () => this.computeAnchors();

  constructor(private b: BattleBridge, private pushUi: (ui: BattleUi) => void) {
    this.fx.name = 'BattleFx';
    b.scene.add(this.fx);
    window.addEventListener('resize', this.onResize);
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.tweens = [];
    this.removeGrid();
    this.b.scene.remove(this.fx);
    for (const f of this.fighters.values()) if (f.temp) this.b.scene.remove(f.root);
  }

  private emit(patch: Partial<BattleUi>) {
    this.ui = { ...this.ui, ...patch };
    if (!this.disposed) this.pushUi(this.ui);
  }

  // ------------------------------------------------------------- timing
  private tween(dur: number, fn: (k: number) => void): Promise<void> {
    return new Promise(resolve => {
      if (dur <= 0 || this.disposed) {
        try { fn(1); } catch { /* noop */ }
        resolve();
        return;
      }
      this.tweens.push({ t: 0, dur, fn, resolve });
    });
  }
  private wait(s: number) {
    return this.tween(s, () => {});
  }

  tick(delta: number, elapsed: number) {
    this.elapsed = elapsed;
    if (this.tweens.length) {
      for (const tw of [...this.tweens]) {
        tw.t += delta;
        const k = Math.min(1, tw.t / tw.dur);
        try { tw.fn(k); } catch (err) { console.warn('[battle] tween failed:', err); }
        if (k >= 1) {
          this.tweens.splice(this.tweens.indexOf(tw), 1);
          tw.resolve();
        }
      }
    }
    if (!this.active) return;
    this.updateGridVisuals();
    const surface = this.surfaceY();
    for (const f of this.fighters.values()) {
      const p = f.root.position;
      f.stars.position.set(p.x, surface + 2.15, p.z);
      f.stars.rotation.y = elapsed * 3;
      f.shield.position.set(p.x, surface + 0.95, p.z);
      (f.shield.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(elapsed * 4) * 0.04;
    }
  }

  private surfaceY(): number {
    return this.b.tileToWorld(0, 0).y;
  }

  // ------------------------------------------------------------- detection
  private enemyPool(): Array<EnemyCandidate & { fig: PlacedFigureLike }> {
    const section = this.b.section();
    const es = this.b.enemyState();
    const did = this.b.dungeonId();
    return this.b
      .figures()
      .filter(n => n.kind === 'enemy' && (n.sectionId ?? 'root') === section && !es[`${did}:${n.id}`]?.defeated)
      .map(n => ({ id: n.id, col: n.col, row: n.row, ini: this.enemyStats(n).ini, groupId: n.groupId || undefined, fig: n }));
  }

  private enemyStats(n: PlacedFigureLike) {
    const c = n.characterId ? this.b.characters().find(x => x.id === n.characterId) : undefined;
    return resolveEnemyStats(c?.battleStats);
  }

  /** Called whenever the leader (and with it the chain) reached a new tile */
  checkEncounter() {
    if (this.active || this.paused) return;
    const party = this.b.party();
    if (!party) return;
    const leader = this.b.leaderTile();
    const enc = detectEncounter({
      leader,
      leaderIni: party.leaderEntry.stats.ini,
      members: party.memberTiles(leader),
      enemies: this.enemyPool(),
      walkable: (c, r) => this.b.isWalkable(c, r),
    });
    if (enc) this.startBattle(enc);
  }

  /** E on an adjacent enemy: the heroes strike first */
  engage(enemyId: string) {
    if (this.active) return;
    this.paused = false;
    if (this.enemyPool().some(e => e.id === enemyId)) {
      this.startBattle({ triggerId: enemyId, initiative: 'hero', kind: 'first_strike' });
    }
  }

  resumeDetection() {
    this.paused = false;
  }

  // ------------------------------------------------------------- start
  private chunkFits(c: Chunk): boolean {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      if (!this.b.isWalkable(c.cx * 3 + i, c.cz * 3 + j)) return false;
    }
    return true;
  }

  private gridWorld(side: Side, pos: GridPos): THREE.Vector3 {
    const t = gridToWorldTile(this.arena!, side, pos);
    const p = this.b.tileToWorld(t.col, t.row);
    return new THREE.Vector3(p.x, 0, p.z);
  }

  private makeStatusFx(): { stars: THREE.Group; shield: THREE.Mesh } {
    const stars = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.09),
        new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      const a = (k / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.38, Math.sin(a * 2) * 0.05, Math.sin(a) * 0.38);
      stars.add(s);
    }
    stars.visible = false;
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    shield.visible = false;
    this.fx.add(stars, shield);
    return { stars, shield };
  }

  private fallbackEnemyFigure(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 4, 12), new THREE.MeshLambertMaterial({ color: 0xb91c1c }));
    body.position.y = this.surfaceY() + 0.75;
    g.add(body);
    this.b.scene.add(g);
    return g;
  }

  private startBattle(enc: Encounter) {
    const party = this.b.party();
    const pool = this.enemyPool();
    const trigger = pool.find(p => p.id === enc.triggerId);
    if (!party || !trigger) return;
    this.active = true;
    this.b.leaderStop();
    party.hurry();

    const group = selectEnemyGroup(trigger, pool) as Array<EnemyCandidate & { fig: PlacedFigureLike }>;
    const leaderTile = this.b.leaderTile();
    const arena = selectArena({
      leaderTile,
      enemyTile: trigger,
      lastMoveDir: party.lastMoveDir,
      fits: c => this.chunkFits(c),
    });
    this.arena = arena;

    // --- placement (section 4)
    const heroOrder = [{ entry: party.roster[0], tile: leaderTile }, ...party.followers.map(f => ({ entry: f.entry, tile: f.tile }))];
    const heroPos = placeSide(heroOrder.map(h => ({ id: h.entry.id, col: h.tile.col, row: h.tile.row })), 'hero', arena);
    const members = party.memberTiles(leaderTile);
    const nearest = (t: Tile) => Math.min(...members.map(m => tileDist(m, t)));
    const enemiesSorted = [...group].sort((a, b) => nearest(a) - nearest(b) || a.id.localeCompare(b.id));
    const enemyPos = placeSide(enemiesSorted.map(e => ({ id: e.id, col: e.col, row: e.row })), 'enemy', arena);

    // --- engine state
    const es = this.b.enemyState();
    const did = this.b.dungeonId();
    const inits: CombatantInit[] = [];
    for (const h of heroOrder) {
      inits.push({
        id: h.entry.id, name: h.entry.name, side: 'hero', isSpark: h.entry.isSpark, stats: h.entry.stats,
        pos: heroPos.get(h.entry.id) ?? { row: 2, lane: 1 }, characterId: h.entry.characterId,
      });
    }
    this.involvedEnemyOrigins = [];
    for (const e of enemiesSorted) {
      const stats = this.enemyStats(e.fig);
      this.involvedEnemyOrigins.push({ col: e.col, row: e.row, ini: stats.ini });
      inits.push({
        id: e.id, name: this.b.figureName(e.fig), side: 'enemy', stats, pos: enemyPos.get(e.id) ?? { row: 2, lane: 1 },
        kraft: es[`${did}:${e.id}`]?.kraft, placementId: e.id, characterId: e.fig.characterId,
      });
    }
    this.state = createBattle(inits, enc.initiative, randomSeed());

    // --- fighters
    this.fighters.clear();
    const leaderRoot = this.b.leaderRoot();
    for (const h of heroOrder) {
      const isLeader = h.entry.id === party.roster[0].id;
      const fol = party.followers.find(f => f.entry.id === h.entry.id);
      const root = isLeader ? leaderRoot : fol?.root;
      if (!root) continue;
      const { stars, shield } = this.makeStatusFx();
      const cached = fol?.animator;
      this.fighters.set(h.entry.id, {
        id: h.entry.id, side: 'hero', isLeader, root, baseY: root.position.y,
        anim: isLeader ? () => this.b.leaderAnimator() : () => cached ?? new Animator(null, []),
        home: this.gridWorld('hero', heroPos.get(h.entry.id)!), stars, shield, shownStatus: 'active', shake: 0,
      });
    }
    for (const e of enemiesSorted) {
      let root = this.b.figureHolder(e.id);
      let temp = false;
      if (!root) {
        root = this.fallbackEnemyFigure();
        const p = this.b.tileToWorld(e.col, e.row);
        root.position.set(p.x, 0, p.z);
        temp = true;
      }
      const ud = root.userData ?? {};
      const animator = new Animator(ud.mixer ?? null, ud.clips ?? [], { current: ud.idleAction ?? null });
      const { stars, shield } = this.makeStatusFx();
      this.fighters.set(e.id, {
        id: e.id, side: 'enemy', isLeader: false, root, baseY: root.position.y, anim: () => animator,
        home: this.gridWorld('enemy', enemyPos.get(e.id)!), stars, shield, shownStatus: 'active', shake: 0, temp,
        origin: { x: root.position.x, z: root.position.z, rotY: root.rotation.y, tile: { col: e.col, row: e.row } },
      });
    }

    this.emit({
      ...INITIAL_BATTLE_UI,
      active: true,
      state: this.state,
      banner: { text: enc.kind === 'first_strike' ? 'Erstschlag!' : 'Hinterhalt!', tone: enc.initiative },
    });
    void this.intro().catch(err => {
      console.error('[battle] intro failed:', err);
    });
  }

  private hideBystanders() {
    const a = this.arena!;
    const inArena = (t: Tile) => {
      const cx = Math.floor((t.col + 1) / 3);
      const cz = Math.floor((t.row + 1) / 3);
      return (cx === a.a.cx && cz === a.a.cz) || (cx === a.b.cx && cz === a.b.cz);
    };
    const section = this.b.section();
    this.hidden = [];
    for (const n of this.b.figures()) {
      if ((n.sectionId ?? 'root') !== section || this.fighters.has(n.id) || !inArena(n)) continue;
      const h = this.b.figureHolder(n.id);
      if (h && h.visible) {
        h.visible = false;
        this.hidden.push(h);
      }
    }
  }

  private async intro() {
    const s0 = this.state!;
    void this.wait(1.1).then(() => this.emit({ banner: null }));
    this.hideBystanders();
    await this.cameraToArena(0.6);
    this.buildGrid();
    const walks: Promise<void>[] = [this.fadeGrid(1, 0.3)];
    for (const f of this.fighters.values()) walks.push(this.moveTo(f, f.home, 7, 0.6));
    await Promise.all(walks);
    for (const f of this.fighters.values()) this.faceEnemy(f);
    this.computeAnchors();
    // Enemies that enter with 0 Kraft are dizzy from the start
    this.syncStatusVisuals();
    const r = startTurn(s0);
    this.state = r.state;
    await this.play(r.events);
    await this.advance();
  }

  // ------------------------------------------------------------- camera
  private async cameraToArena(dur: number) {
    const { camera, camTarget } = this.b;
    const a = this.arena!;
    this.savedCam = { pos: camera.position.clone(), target: camTarget.clone(), frustum: this.b.getFrustum() };
    const ca = this.b.tileToWorld(a.a.cx * 3, a.a.cz * 3);
    const cb = this.b.tileToWorld(a.b.cx * 3, a.b.cz * 3);
    const center = new THREE.Vector3((ca.x + cb.x) / 2, 0.45, (ca.z + cb.z) / 2);
    const offset = camera.position.clone().sub(camTarget);

    // Required frustum: project the arena box (16 m x 8 m, 0..2.4 m high)
    const half = (this.b.tileSize * 3) / 2;
    const minX = Math.min(ca.x, cb.x) - half;
    const maxX = Math.max(ca.x, cb.x) + half;
    const minZ = Math.min(ca.z, cb.z) - half;
    const maxZ = Math.max(ca.z, cb.z) + half;
    const probe = camera.clone();
    probe.position.copy(center).add(offset);
    probe.lookAt(center);
    probe.updateMatrixWorld(true);
    const inv = probe.matrixWorldInverse;
    const c0 = center.clone().applyMatrix4(inv);
    let mx = 0;
    let my = 0;
    for (const x of [minX, maxX]) for (const z of [minZ, maxZ]) for (const y of [ca.y, ca.y + 2.4]) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(inv);
      mx = Math.max(mx, Math.abs(v.x - c0.x));
      my = Math.max(my, Math.abs(v.y - c0.y));
    }
    const aspect = this.b.container.clientWidth / Math.max(1, this.b.container.clientHeight);
    // extra room for the HUD at the bottom/top of the screen
    const targetFrustum = Math.max(2 * my, (2 * mx) / aspect) * 1.32;

    const fromT = camTarget.clone();
    const fromF = this.b.getFrustum();
    await this.tween(dur, k => {
      const e = ease(k);
      camTarget.lerpVectors(fromT, center, e);
      camera.position.copy(camTarget).add(offset);
      camera.lookAt(camTarget);
      this.b.setFrustum(fromF + (targetFrustum - fromF) * e);
    });
  }

  private async cameraBack(dur: number, focus: THREE.Vector3) {
    const saved = this.savedCam;
    if (!saved) return;
    const { camera, camTarget } = this.b;
    const offset = camera.position.clone().sub(camTarget);
    const fromT = camTarget.clone();
    const toT = new THREE.Vector3(focus.x, 0.45, focus.z);
    const fromF = this.b.getFrustum();
    await this.tween(dur, k => {
      const e = ease(k);
      camTarget.lerpVectors(fromT, toT, e);
      camera.position.copy(camTarget).add(offset);
      camera.lookAt(camTarget);
      this.b.setFrustum(fromF + (saved.frustum - fromF) * e);
    });
    this.savedCam = null;
  }

  private project(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.b.camera);
    return {
      x: ((v.x + 1) / 2) * this.b.container.clientWidth,
      y: ((1 - v.y) / 2) * this.b.container.clientHeight,
    };
  }

  private computeAnchors() {
    if (!this.active) return;
    const anchors: Record<string, { x: number; y: number }> = {};
    const y = this.surfaceY() + 2.35;
    for (const f of this.fighters.values()) anchors[f.id] = this.project(new THREE.Vector3(f.home.x, y, f.home.z));
    this.emit({ anchors });
  }

  // ------------------------------------------------------------- grid
  private buildGrid() {
    this.removeGrid();
    const g = new THREE.Group();
    g.name = 'BattleGrid';
    const size = this.b.tileSize - 0.16;
    const y = this.surfaceY() + 0.02;
    const band = 0.05;
    for (const side of ['hero', 'enemy'] as Side[]) {
      for (let row = 0; row < 3; row++) for (let lane = 0; lane < 3; lane++) {
        const pos = { row, lane };
        const w = this.gridWorld(side, pos);
        const color = side === 'hero' ? HERO_GRID : ENEMY_GRID;
        const fill = new THREE.Mesh(
          new THREE.PlaneGeometry(size, size),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
        );
        fill.rotation.x = -Math.PI / 2;
        fill.position.set(w.x, y, w.z);
        fill.userData = { side, row, lane };
        const shape = new THREE.Shape();
        const o = size / 2;
        shape.moveTo(-o, -o); shape.lineTo(o, -o); shape.lineTo(o, o); shape.lineTo(-o, o); shape.lineTo(-o, -o);
        const hole = new THREE.Path();
        const ii = o - band;
        hole.moveTo(-ii, -ii); hole.lineTo(-ii, ii); hole.lineTo(ii, ii); hole.lineTo(ii, -ii); hole.lineTo(-ii, -ii);
        shape.holes.push(hole);
        const border = new THREE.Mesh(
          new THREE.ShapeGeometry(shape),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
        );
        border.rotation.x = -Math.PI / 2;
        border.position.set(w.x, y + 0.002, w.z);
        g.add(fill, border);
        this.grid.push({ side, pos, fill, border, phase: (row * 3 + lane) * 0.4 });
      }
    }
    this.b.scene.add(g);
    this.gridGroup = g;
    this.gridAlpha = 0;
  }

  private removeGrid() {
    if (!this.gridGroup) return;
    this.b.scene.remove(this.gridGroup);
    this.gridGroup.traverse((o: any) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    this.gridGroup = null;
    this.grid = [];
  }

  private fadeGrid(to: number, dur: number) {
    const from = this.gridAlpha;
    return this.tween(dur, k => { this.gridAlpha = from + (to - from) * k; });
  }

  private occupantAt(side: Side, pos: GridPos): string | null {
    const c = this.state?.combatants.find(x => x.side === side && x.pos.row === pos.row && x.pos.lane === pos.lane && x.status !== 'defeated');
    return c ? c.id : null;
  }

  private updateGridVisuals() {
    if (!this.grid.length) return;
    const s = this.state;
    const selectedId = this.ui.selectedId;
    const targets = new Set(this.ui.validTargetIds);
    for (const t of this.grid) {
      const key = `${t.side}:${t.pos.row}:${t.pos.lane}`;
      const occ = this.occupantAt(t.side, t.pos);
      const occC = occ && s ? getCombatant(s, occ) : undefined;
      let state: 'normal' | 'hover' | 'target' | 'selected' | 'invalid' = 'normal';
      if (occC && occC.status === 'dizzy' && occC.side === 'hero') state = 'invalid';
      if (occ && targets.has(occ)) state = 'target';
      if (occ && occ === selectedId) state = 'selected';
      if (this.hoverKey === key && this.ui.inputEnabled) state = 'hover';
      const base = t.side === 'hero' ? HERO_GRID : ENEMY_GRID;
      const bMat = t.border.material as THREE.MeshBasicMaterial;
      const fMat = t.fill.material as THREE.MeshBasicMaterial;
      let bo = 0.5;
      let fo = 0.035;
      switch (state) {
        case 'hover':
          bMat.color.copy(base).lerp(WHITE, 0.55); fMat.color.copy(bMat.color); bo = 1; fo = 0.16; break;
        case 'target':
          bMat.color.copy(t.side === 'hero' ? TARGET_HERO : TARGET_ENEMY); fMat.color.copy(bMat.color); bo = 0.95; fo = 0.12; break;
        case 'selected':
          bMat.color.copy(SELECTED); fMat.color.copy(SELECTED); bo = 1; fo = 0.18; break;
        case 'invalid':
          bMat.color.copy(INVALID); fMat.color.copy(INVALID); bo = 0.3; fo = 0.02; break;
        default:
          bMat.color.copy(base); fMat.color.copy(base);
      }
      const pulse = state === 'target' ? 0.75 + 0.25 * Math.sin(this.elapsed * 6) : 0.86 + 0.14 * Math.sin(this.elapsed * 2.2 + t.phase);
      bMat.opacity = bo * pulse * this.gridAlpha;
      fMat.opacity = fo * pulse * this.gridAlpha;
    }
  }

  // ------------------------------------------------------------- input
  private pick(ndc: { x: number; y: number }): { side: Side; pos: GridPos; key: string } | null {
    if (!this.grid.length) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.b.camera);
    const hit = this.raycaster.intersectObjects(this.grid.map(g => g.fill), false)[0];
    if (!hit) return null;
    const { side, row, lane } = hit.object.userData as { side: Side; row: number; lane: number };
    return { side, pos: { row, lane }, key: `${side}:${row}:${lane}` };
  }

  /** Returns the cursor style */
  pointerMove(ndc: { x: number; y: number }): string {
    const p = this.pick(ndc);
    this.hoverKey = p?.key ?? null;
    const occ = p ? this.occupantAt(p.side, p.pos) : null;
    const hoverTarget = occ && this.ui.validTargetIds.includes(occ) ? occ : null;
    if (hoverTarget !== this.ui.hoverTargetId) this.emit({ hoverTargetId: hoverTarget });
    if (!this.ui.inputEnabled) return 'default';
    if (hoverTarget) return 'crosshair';
    if (occ && this.isSelectableHero(occ)) return 'pointer';
    return 'default';
  }

  pointerDown(ndc: { x: number; y: number }) {
    if (!this.ui.inputEnabled) return;
    const p = this.pick(ndc);
    if (!p) return;
    const occ = this.occupantAt(p.side, p.pos);
    if (!occ) return;
    if (this.ui.actionId && this.ui.validTargetIds.includes(occ)) {
      this.chooseTarget(occ);
      return;
    }
    if (this.isSelectableHero(occ)) this.selectActor(occ);
  }

  private isSelectableHero(id: string): boolean {
    const c = this.state ? getCombatant(this.state, id) : undefined;
    return !!c && c.side === 'hero' && !c.isSpark && c.status === 'active';
  }

  selectActor(id: string) {
    if (!this.ui.inputEnabled || !this.isSelectableHero(id)) return;
    this.emit({ selectedId: id, actionId: null, validTargetIds: [], hoverTargetId: null, message: null });
  }

  selectAction(actionId: ActionId) {
    const s = this.state;
    const actorId = this.ui.selectedId;
    if (!s || !actorId || !this.ui.inputEnabled) return;
    const reason = actionUnavailableReason(s, actorId, actionId);
    if (reason) {
      this.emit({ message: reason });
      return;
    }
    const actor = getCombatant(s, actorId)!;
    if (!needsSingleTarget(actor, actionId)) {
      void this.perform({ actorId, actionId });
      return;
    }
    this.emit({ actionId, validTargetIds: validTargets(s, actorId, actionId).map(c => c.id), message: null });
  }

  hoverTarget(id: string | null) {
    const v = id && this.ui.validTargetIds.includes(id) ? id : null;
    if (v !== this.ui.hoverTargetId) this.emit({ hoverTargetId: v });
  }

  chooseTarget(id: string) {
    const actorId = this.ui.selectedId;
    const actionId = this.ui.actionId;
    if (!actorId || !actionId || !this.ui.validTargetIds.includes(id)) return;
    void this.perform({ actorId, actionId, targetId: id });
  }

  cancel() {
    if (this.ui.actionId) this.emit({ actionId: null, validTargetIds: [], hoverTargetId: null });
  }

  endTurnClicked() {
    if (!this.ui.inputEnabled || !this.state || this.state.turn !== 'hero') return;
    this.setInput(false);
    void (async () => {
      const r = endTurn(this.state!);
      this.state = r.state;
      await this.play(r.events);
      await this.advance();
    })();
  }

  private setInput(on: boolean) {
    if (!on) {
      this.emit({ inputEnabled: false, actionId: null, validTargetIds: [], hoverTargetId: null, state: this.state });
      return;
    }
    const s = this.state!;
    let sel = this.ui.selectedId;
    if (!sel || !this.isSelectableHero(sel) || !actorHasOptions(s, sel)) {
      sel = s.combatants.find(c => c.side === 'hero' && !c.isSpark && c.status === 'active' && actorHasOptions(s, c.id))?.id ?? null;
    }
    this.emit({ inputEnabled: true, selectedId: sel, actionId: null, validTargetIds: [], hoverTargetId: null, state: s });
  }

  private async perform(action: BattleAction) {
    if (!this.state || !this.ui.inputEnabled) return;
    let r;
    try {
      r = applyAction(this.state, action);
    } catch (err) {
      this.emit({ message: (err as Error).message });
      return;
    }
    this.setInput(false);
    this.state = r.state;
    await this.play(r.events);
    await this.advance();
  }

  // ------------------------------------------------------------- flow
  private async advance() {
    for (let guard = 0; guard < 400 && !this.disposed; guard++) {
      const s = this.state!;
      if (s.outcome !== 'ongoing') {
        await this.finish(s.outcome);
        return;
      }
      if (s.turn === 'enemy') {
        this.emit({ state: s });
        await this.enemyTurn();
        if (this.state!.outcome !== 'ongoing') continue;
        const r = endTurn(this.state!);
        this.state = r.state;
        await this.play(r.events);
        continue;
      }
      if (!hasAnyValidAction(s)) {
        await this.wait(0.35);
        const r = endTurn(s);
        this.state = r.state;
        await this.play(r.events);
        continue;
      }
      this.setInput(true);
      return;
    }
  }

  private async enemyTurn() {
    await this.wait(0.3);
    for (const id of enemyTurnOrder(this.state!)) {
      if (this.disposed || this.state!.outcome !== 'ongoing') return;
      const c = getCombatant(this.state!, id);
      if (!c || c.status !== 'active') continue;
      const d = decideEnemyAction(this.state!, id);
      this.state = d.state;
      if (!d.action) continue;
      let r;
      try {
        r = applyAction(this.state, d.action);
      } catch (err) {
        console.warn('[battle] enemy action rejected:', err);
        continue;
      }
      this.state = r.state;
      await this.play(r.events);
      await this.wait(0.12);
    }
  }

  // ------------------------------------------------------------- playback
  private async play(events: BattleEvent[]) {
    let k = 0;
    while (k < events.length && !this.disposed) {
      const ev = events[k++];
      switch (ev.type) {
        case 'turn_start':
          this.emit({ state: this.state, banner: { text: ev.side === 'hero' ? `Runde ${ev.round} · Dein Zug` : `Runde ${ev.round} · Gegnerzug`, tone: ev.side } });
          void this.wait(0.9).then(() => { if (this.ui.banner && !['Sieg!', 'Niederlage'].includes(this.ui.banner.text)) this.emit({ banner: null }); });
          await this.wait(0.35);
          break;
        case 'spark_phase': {
          this.emit({ state: this.state });
          const sp = this.sparkFighter();
          if (sp) this.burst(sp.root.position, ev.mode === 'heal' ? 0x4ade80 : 0xfbbf24, 1.1, 0.5, 1.4);
          await this.wait(0.3);
          break;
        }
        case 'spark_heal': {
          const sp = this.sparkFighter();
          const t = this.fighters.get(ev.targetId);
          if (sp && t) this.beam(sp.root.position, t.root.position, 0x4ade80, 0.6);
          if (t) this.floater(t, `Spark ✚ ${ev.recovery}/2`, 'heal');
          await this.wait(0.45);
          break;
        }
        case 'revive': {
          const t = this.fighters.get(ev.id);
          this.emit({ state: this.state });
          if (t) {
            this.floater(t, `Steht auf! ${ev.hp} LP`, 'heal');
            this.burst(t.root.position, 0x4ade80, 1.2, 0.6, 1);
          }
          this.syncStatusVisuals();
          await this.wait(0.4);
          break;
        }
        case 'kraft': {
          const t = this.fighters.get(ev.targetId);
          const sp = this.sparkFighter();
          if (t && sp && this.state?.sparkMode === 'drain' && !events.slice(0, k).some(e => e.type === 'action')) {
            this.beam(sp.root.position, t.root.position, 0xfbbf24, 0.5);
          }
          if (t) this.floater(t, `−${ev.amount} Kraft`, 'kraft');
          this.emit({ state: this.state });
          this.syncStatusVisuals();
          await this.wait(0.12);
          break;
        }
        case 'action': {
          const effects: BattleEvent[] = [];
          while (k < events.length && !['action', 'turn_start', 'turn_end', 'spark_phase', 'ap', 'outcome'].includes(events[k].type)) {
            effects.push(events[k++]);
          }
          await this.choreograph(ev, effects);
          break;
        }
        case 'dizzy':
        case 'defeated':
          this.emit({ state: this.state });
          this.syncStatusVisuals();
          await this.wait(0.2);
          break;
        case 'ap':
        case 'turn_end':
        case 'outcome':
          this.emit({ state: this.state });
          break;
        default:
          break;
      }
    }
    this.emit({ state: this.state });
    this.syncStatusVisuals();
  }

  private sparkFighter(): Fighter | undefined {
    const sp = this.state?.combatants.find(c => c.isSpark);
    return sp ? this.fighters.get(sp.id) : undefined;
  }

  private edgePoint(side: Side, lane: number): THREE.Vector3 {
    const a = this.arena!;
    const w = this.gridWorld(side, { row: 0, lane });
    const sgn = side === 'hero' ? 1 : -1;
    const shift = this.b.tileSize / 2 - 0.42;
    return new THREE.Vector3(w.x + a.d.x * sgn * shift, 0, w.z + a.d.z * sgn * shift);
  }

  private faceEnemy(f: Fighter) {
    const d = this.arena!.d;
    const sgn = f.side === 'hero' ? 1 : -1;
    f.root.rotation.y = Math.atan2(d.x * sgn, d.z * sgn);
  }

  private async moveTo(f: Fighter, to: THREE.Vector3, speed: number, maxDur: number) {
    const from = f.root.position.clone();
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.02) return;
    f.root.rotation.y = Math.atan2(dx, dz);
    const anim = f.anim();
    const hasRun = anim.play('run') > 0;
    if (f.isLeader) this.leaderMoving = true;
    const dur = Math.max(0.15, Math.min(maxDur, dist / speed));
    await this.tween(dur, k => {
      f.root.position.x = from.x + dx * k;
      f.root.position.z = from.z + dz * k;
      if (!hasRun && !f.isLeader) f.root.position.y = f.baseY + Math.abs(Math.sin(k * Math.PI * 4)) * 0.06;
    });
    f.root.position.y = f.baseY;
    if (f.isLeader) this.leaderMoving = false;
    this.playRest(f);
  }

  private statusOf(id: string) {
    return this.state ? getCombatant(this.state, id)?.status ?? 'active' : 'active';
  }

  private playRest(f: Fighter) {
    const st = this.statusOf(f.id);
    if (st === 'defeated') return;
    const anim = f.anim();
    if (st === 'dizzy') {
      if (!anim.play('dizzy')) anim.play('idle', { timeScale: 0.5 });
    } else {
      anim.play('idle');
    }
  }

  private async lunge(f: Fighter, dist: number, dur: number) {
    const dir = new THREE.Vector3(Math.sin(f.root.rotation.y), 0, Math.cos(f.root.rotation.y));
    const from = f.root.position.clone();
    await this.tween(dur, k => {
      const o = Math.sin(k * Math.PI) * dist;
      f.root.position.set(from.x + dir.x * o, from.y, from.z + dir.z * o);
    });
  }

  private playClip(f: Fighter, kind: ClipKind, fallbacks: Array<{ kind: ClipKind; timeScale?: number }> = []): number {
    const anim = f.anim();
    const d = anim.play(kind, { once: true });
    if (d > 0) return d;
    for (const fb of fallbacks) {
      const d2 = anim.play(fb.kind, { once: true, timeScale: fb.timeScale });
      if (d2 > 0) return d2;
    }
    return 0;
  }

  private async choreograph(ev: Extract<BattleEvent, { type: 'action' }>, effects: BattleEvent[]) {
    const actor = this.fighters.get(ev.actorId);
    const s = this.state!;
    const actorC = getCombatant(s, ev.actorId);
    if (!actor || !actorC) {
      await this.applyEffects(effects, null);
      return;
    }
    const ab = ev.abilityId ? getAbility(ev.abilityId) : undefined;
    const firstTarget = ev.targetIds[0] ? getCombatant(s, ev.targetIds[0]) : undefined;
    const offensive = ev.actionId === 'normal_hit' || ev.actionId === 'heavy_hit' || (!!ab && !!firstTarget && firstTarget.side !== actorC.side);

    if (ev.actionId === 'block') {
      this.playClip(actor, 'block');
      this.burst(actor.root.position, 0x38bdf8, 1, 0.45, 1.1);
      this.floater(actor, 'Block', 'block');
      await this.wait(0.45);
      await this.applyEffects(effects, actor);
      this.playRest(actor);
      return;
    }

    if (!offensive) {
      // Support ability on allies: cast in place
      const d = this.playClip(actor, 'cast', [{ kind: 'attack' }]);
      this.burst(actor.root.position, 0x86efac, 0.9, 0.5, 1.3);
      await this.wait(d > 0 ? Math.min(0.5, d * 0.5) : 0.35);
      await this.applyEffects(effects, actor);
      await this.wait(0.35);
      this.playRest(actor);
      return;
    }

    // Offensive: run to the edge of the own chunk on the lane of the target
    const lanes = ev.targetIds.map(id => getCombatant(s, id)?.pos.lane ?? 1);
    const lane = lanes.length === 1 ? lanes[0] : 1;
    await this.moveTo(actor, this.edgePoint(actor.side, lane), 8, 0.45);
    this.faceEnemy(actor);
    let dur = 0;
    if (ev.actionId === 'normal_hit') dur = this.playClip(actor, 'attack');
    else if (ev.actionId === 'heavy_hit') dur = this.playClip(actor, 'attack_heavy', [{ kind: 'attack', timeScale: 0.8 }]);
    else dur = this.playClip(actor, 'cast', [{ kind: 'attack' }]);
    if (ab) this.burst(actor.root.position, 0xc084fc, 1, 0.5, 1.4);
    let impact: number;
    if (dur > 0) {
      impact = Math.min(0.55, dur * 0.45);
      await this.wait(impact);
    } else {
      impact = 0.18;
      void this.lunge(actor, ev.actionId === 'heavy_hit' ? 0.75 : 0.5, ev.actionId === 'heavy_hit' ? 0.5 : 0.36);
      await this.wait(ev.actionId === 'heavy_hit' ? 0.25 : impact);
    }
    if (ev.actionId === 'heavy_hit') {
      for (const id of ev.targetIds) {
        const t = this.fighters.get(id);
        if (t) this.burst(t.root.position, 0xfb923c, 1.6, 0.5, 1.2);
      }
    }
    await this.applyEffects(effects, actor);
    await this.wait(Math.max(0.3, Math.min(0.8, dur - impact)));
    await this.moveTo(actor, actor.home, 8, 0.45);
    this.faceEnemy(actor);
    this.playRest(actor);
  }

  private async applyEffects(effects: BattleEvent[], actor: Fighter | null) {
    let reacted = false;
    for (const e of effects) {
      switch (e.type) {
        case 'damage': {
          const t = this.fighters.get(e.targetId);
          if (t) {
            this.floater(t, e.blocked ? `${e.amount} (Block)` : String(e.amount), 'damage');
            this.hitReaction(t);
            reacted = true;
          }
          break;
        }
        case 'coup_de_grace': {
          const t = this.fighters.get(e.targetId);
          if (t) {
            this.floater(t, 'GNADENSTOSS', 'coup');
            this.burst(t.root.position, 0xf43f5e, 1.5, 0.5, 1);
          }
          break;
        }
        case 'heal': {
          const t = this.fighters.get(e.targetId);
          if (t) {
            this.floater(t, `+${e.amount} LP`, 'heal');
            this.burst(t.root.position, 0x4ade80, 1, 0.5, 1);
          }
          break;
        }
        case 'block': {
          const t = this.fighters.get(e.targetId);
          if (t && t !== actor) this.floater(t, 'Geschützt', 'block');
          break;
        }
        case 'buff': {
          const t = this.fighters.get(e.targetId);
          if (t) this.floater(t, `ATK +${e.percent} %`, 'info');
          break;
        }
        case 'kraft': {
          const t = this.fighters.get(e.targetId);
          if (t) this.floater(t, `−${e.amount} Kraft`, 'kraft');
          break;
        }
        default:
          break;
      }
    }
    this.emit({ state: this.state });
    this.syncStatusVisuals();
    if (reacted) await this.wait(0.1);
  }

  private hitReaction(t: Fighter) {
    const st = this.statusOf(t.id);
    if (st === 'defeated') return;
    const d = st === 'active' ? t.anim().play('hit', { once: true }) : 0;
    if (d > 0) {
      void this.wait(Math.min(d, 0.7)).then(() => this.playRest(t));
    } else {
      const from = t.root.position.clone();
      void this.tween(0.28, k => {
        const o = Math.sin(k * Math.PI * 6) * 0.08 * (1 - k);
        t.root.position.x = from.x + o;
        t.root.position.z = from.z - o;
      }).then(() => { t.root.position.x = from.x; t.root.position.z = from.z; });
    }
    this.flash(t.root.position, 0xff2222);
  }

  private syncStatusVisuals() {
    const s = this.state;
    if (!s) return;
    for (const c of s.combatants) {
      const f = this.fighters.get(c.id);
      if (!f) continue;
      f.shield.visible = c.status === 'active' && c.damageFactor < 1;
      f.stars.visible = c.status === 'dizzy';
      if (f.shownStatus === c.status) continue;
      const prev = f.shownStatus;
      f.shownStatus = c.status;
      if (c.status === 'defeated') {
        f.shield.visible = false;
        f.stars.visible = false;
        const d = f.anim().play('defeat', { once: true });
        const baseY = f.baseY;
        void this.wait(d > 0 ? Math.min(d, 1.2) : 0.1)
          .then(() => this.tween(0.8, k => { f.root.position.y = baseY - 2.3 * ease(k); }))
          .then(() => { if (this.statusOf(f.id) === 'defeated') f.root.visible = false; });
      } else {
        if (prev === 'defeated') {
          f.root.visible = true;
          f.root.position.y = f.baseY;
        }
        this.playRest(f);
      }
    }
  }

  // ------------------------------------------------------------- fx
  private burst(at: THREE.Vector3, color: number, scale: number, dur: number, y = 1) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), mat);
    m.position.set(at.x, this.surfaceY() + y, at.z);
    this.fx.add(m);
    void this.tween(dur, k => {
      m.scale.setScalar(0.4 + k * scale * 1.6);
      mat.opacity = 0.55 * (1 - k);
    }).then(() => { this.fx.remove(m); m.geometry.dispose(); mat.dispose(); });
  }

  private beam(from: THREE.Vector3, to: THREE.Vector3, color: number, dur: number) {
    const y = this.surfaceY();
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, y + 1.3, from.z),
      new THREE.Vector3((from.x + to.x) / 2, y + 2.2, (from.z + to.z) / 2),
      new THREE.Vector3(to.x, y + 1.1, to.z),
    ]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    this.fx.add(line);
    void this.tween(dur, k => { mat.opacity = 1 - k; }).then(() => { this.fx.remove(line); geo.dispose(); mat.dispose(); });
  }

  private flash(at: THREE.Vector3, color: number) {
    const light = new THREE.PointLight(color, 0, 3.5);
    light.position.set(at.x, this.surfaceY() + 1.2, at.z);
    this.fx.add(light);
    void this.tween(0.3, k => { light.intensity = 6 * Math.sin(k * Math.PI); }).then(() => this.fx.remove(light));
  }

  private floater(f: Fighter, text: string, kind: BattleFloater['kind']) {
    const p = this.project(new THREE.Vector3(f.root.position.x, this.surfaceY() + 2.0, f.root.position.z));
    const id = this.floaterSeq++;
    const jitter = ((id % 3) - 1) * 14;
    this.emit({ floaters: [...this.ui.floaters, { id, x: p.x + jitter, y: p.y, text, kind }] });
    window.setTimeout(() => {
      if (this.disposed) return;
      this.emit({ floaters: this.ui.floaters.filter(x => x.id !== id) });
    }, 1300);
  }

  // ------------------------------------------------------------- end
  private restoreHeroes() {
    for (const f of this.fighters.values()) {
      if (f.side !== 'hero') continue;
      f.root.visible = true;
      f.root.position.y = f.baseY;
      f.anim().play('idle');
    }
  }

  private cleanupScene() {
    for (const f of this.fighters.values()) {
      this.fx.remove(f.stars, f.shield);
      f.stars.traverse((o: any) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      f.shield.geometry.dispose();
      (f.shield.material as THREE.Material).dispose();
      if (f.temp) this.b.scene.remove(f.root);
    }
    for (const h of this.hidden) h.visible = true;
    this.hidden = [];
    this.removeGrid();
  }

  private gridTileOfLeader(): { tile: Tile; facing: number } | null {
    const party = this.b.party();
    const s = this.state;
    if (!party || !s || !this.arena) return null;
    const c = getCombatant(s, party.roster[0].id);
    if (!c) return null;
    const d = this.arena.d;
    return { tile: gridToWorldTile(this.arena, 'hero', c.pos), facing: Math.atan2(d.x, d.z) };
  }

  private async finish(outcome: Outcome) {
    this.setInput(false);
    const s = this.state!;
    const did = this.b.dungeonId();
    const party = this.b.party();
    if (outcome === 'victory') {
      this.emit({ banner: { text: 'Sieg!', tone: 'victory' } });
      await this.wait(1.2);
      const patch: EnemyStateMap = {};
      for (const [pid, v] of Object.entries(enemyPersistence(s))) patch[`${did}:${pid}`] = { kraft: v.kraft, defeated: true };
      this.b.persistEnemyState(patch);
      for (const f of this.fighters.values()) if (f.side === 'enemy') f.root.visible = false;
      await this.fadeGrid(0, 0.3);
      this.restoreHeroes();
      const lt = this.gridTileOfLeader();
      if (lt) this.b.leaderSync(lt.tile, lt.facing);
      this.cleanupScene();
      this.active = false;
      if (party && lt) party.regroup(lt.tile);
      this.emit({ ...INITIAL_BATTLE_UI, banner: null });
      const root = this.b.leaderRoot();
      await this.cameraBack(0.6, root ? root.position : this.b.camTarget);
    } else {
      this.emit({ banner: null, defeatText: 'Spark verglüht, um euch zu retten … Die Gruppe erwacht an einem sicheren Ort.' });
      await this.wait(1.6);
      // Kraft is kept, HP are refilled (next fight starts with full HP)
      const patch: EnemyStateMap = {};
      for (const [pid, v] of Object.entries(enemyPersistence(s))) patch[`${did}:${pid}`] = { kraft: v.kraft, defeated: v.defeated || undefined };
      this.b.persistEnemyState(patch);
      for (const f of this.fighters.values()) {
        if (f.side !== 'enemy' || !f.origin) continue;
        const defeated = this.statusOf(f.id) === 'defeated';
        f.root.position.set(f.origin.x, f.baseY, f.origin.z);
        f.root.rotation.y = f.origin.rotY;
        f.root.visible = !defeated && !f.temp;
        f.anim().play('idle');
      }
      this.restoreHeroes();
      const trail = party ? party.trail : [];
      const respawn = chooseRespawnTile(trail, this.involvedEnemyOrigins) ?? this.b.leaderTile();
      this.b.leaderSync(respawn, this.b.leaderRoot()?.rotation.y ?? 0);
      if (party) party.resetAround(respawn);
      this.cleanupScene();
      this.active = false;
      this.paused = true;
      const root = this.b.leaderRoot();
      await this.cameraBack(0.01, root ? root.position : this.b.camTarget);
      await this.wait(0.6);
      this.emit({ ...INITIAL_BATTLE_UI });
    }
    this.fighters.clear();
    this.state = null;
    this.arena = null;
    this.b.onFinished();
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------
export interface BattleApi {
  selectActor(id: string): void;
  selectAction(id: ActionId): void;
  chooseTarget(id: string): void;
  hoverTarget(id: string | null): void;
  cancel(): void;
  endTurn(): void;
}

export function useBattleScene() {
  const [ui, setUi] = useState<BattleUi>(INITIAL_BATTLE_UI);
  const directorRef = useRef<BattleDirector | null>(null);

  const attach = useCallback((bridge: BattleBridge) => {
    directorRef.current?.dispose();
    const d = new BattleDirector(bridge, next => setUi(next));
    directorRef.current = d;
    return d;
  }, []);

  const detach = useCallback(() => {
    directorRef.current?.dispose();
    directorRef.current = null;
    setUi(INITIAL_BATTLE_UI);
  }, []);

  const api = useMemo<BattleApi>(() => ({
    selectActor: id => directorRef.current?.selectActor(id),
    selectAction: id => directorRef.current?.selectAction(id),
    chooseTarget: id => directorRef.current?.chooseTarget(id),
    hoverTarget: id => directorRef.current?.hoverTarget(id),
    cancel: () => directorRef.current?.cancel(),
    endTurn: () => directorRef.current?.endTurnClicked(),
  }), []);

  return { ui, api, attach, detach, directorRef };
}
