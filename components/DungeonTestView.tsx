import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { 
  ArrowLeft, RotateCcw, Upload, Compass, Shield, User, 
  ChevronDown, ChevronUp, Footprints, Sparkles, Check, 
  Trash2, Sliders, Film, HelpCircle, Layers, Box, Grid, Square, DoorClosed, Layers as LayersIcon, Move, X,
  Users, Swords
} from 'lucide-react';
import { Character } from '../types';
import { getItem, setItem } from '../utils/db';
import { loadImage } from '../utils/imageStorage';

interface DungeonTestViewProps {
  onExit: () => void;
  characters?: Character[];
}

interface TileCoord {
  col: number; // 0, 1, 2 (West to East)
  row: number; // 0, 1, 2 (North to South)
}

type Direction = 'NORTH' | 'EAST' | 'SOUTH' | 'WEST';

const TILE_SIZE = 2.4; // Default procedural world units per tile (total 7.2m)
const BLENDER_CHUNK_SIZE = 8.0; // Blender Floor Chunk is 8m x 8m
const BLENDER_TILE_SIZE = 8.0 / 3; // ~2.6667m per tile for 3x3 grid
const PLATFORM_HALF = (3 * TILE_SIZE) / 2; // 3.6 units from center to edge
const WALL_HEIGHT = 3.8;
const WALL_THICKNESS = 0.55;

const STORAGE_KEY_CHAR_GLB = 'dungeon_custom_glb_config';
const STORAGE_KEY_FLOOR_GLB = 'dungeon_custom_floor_glb';
const STORAGE_KEY_WALL_GLB = 'dungeon_custom_wall_glb';
const STORAGE_KEY_DOOR_GLB = 'dungeon_custom_door_glb';

interface StoredGLBConfig {
  fileName: string;
  fileSize: number;
  dataBase64: string;
  scale?: number;
  useRawScale?: boolean;
  offsetY?: number;
  rotationY?: number;
  idleClipName?: string;
  runClipName?: string;
}

interface StoredEnvironmentGLBConfig {
  fileName: string;
  fileSize: number;
  dataBase64: string;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
  rotationY?: number;
  showLeftWall?: boolean;
  showUpperWall?: boolean;
  showSecondWall?: boolean;
  showLeftDoor?: boolean;
  showUpperDoor?: boolean;
  wallLayout?: 'diorama' | 'single' | 'three' | 'four';
}

// =========================================================================
// CHUNK LIBRARY & MULTI-PLACEMENT (Grid-Snapping Editor)
// =========================================================================

type ChunkType = 'floor' | 'wall' | 'door';

// One uploaded GLB file, reusable for arbitrarily many placements
interface ChunkLibraryEntry {
  id: string;
  type: ChunkType;
  fileName: string;
  fileSize: number;
  dataBase64: string; // Data URL
}

// One placed copy in the chunk grid (1 chunk = 1 cell of 8m x 8m)
interface PlacedChunkInstance {
  id: string;
  type: ChunkType;
  libraryId: string;
  cellX: number; // Chunk-grid cell, base chunk = (0, 0)
  cellZ: number;
  rotationY: number; // degrees, multiple of 90 (mouse wheel)
  sectionId?: string; // dungeon section; undefined = root section
  portalId?: string; // id of the paired door instance (section transition)
  pairColorIndex?: number; // shared color of the door pair in link mode
}

interface SectionInfo {
  id: string;
  name: string;
}

interface PlacementSession {
  type: PlacementType;
  libId: string;
  fileName: string;
  rotationY: number;
  /** Set while an existing placed instance is being moved (id of that instance) */
  moveInstanceId?: string;
  /** Set while an existing placed character is being moved (id of that instance) */
  moveNpcId?: string;
}

type ChunkEditMode = 'move' | 'delete' | 'link' | null;

// ---------------------------------------------------------------------------
// NPC & Enemy characters: GLB figures placed on walkable sub-tiles. Enemies
// will trigger combat later, neutral characters will become interactable.
// ---------------------------------------------------------------------------

type NpcKind = 'npc' | 'enemy';

// Placement scope: chunks snap to the 8m chunk grid, characters to sub-tiles
type PlacementType = ChunkType | NpcKind;

// One uploaded character GLB file, reusable for arbitrarily many placements
interface NpcLibraryEntry {
  id: string;
  kind: NpcKind;
  fileName: string;
  fileSize: number;
  dataBase64: string; // Data URL
}

// One placed NPC/enemy copy standing on a walkable sub-tile of a section
interface PlacedNpcInstance {
  id: string;
  kind: NpcKind;
  libraryId: string;
  col: number; // walkable sub-tile coordinates (x,z in sub-tile steps)
  row: number;
  rotationY: number; // degrees, multiple of 90 (mouse wheel)
  sectionId?: string; // dungeon section; undefined = root section
}

const CHUNK_LIBRARY_KEY = 'dungeon_chunk_library';
const CHUNK_PLACEMENTS_KEY = 'dungeon_chunk_placements';
const CHUNK_SECTIONS_KEY = 'dungeon_sections';
const NPC_LIBRARY_KEY = 'dungeon_npc_library';
const NPC_PLACEMENTS_KEY = 'dungeon_npc_placements';

function makePlacementId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// Ids for placing chunk copies (used by the pointerdown handler)
// — shared helper so both chunk and npc placements use the same format
const PLACEMENT_ID_PREFIX = { chunk: 'plt', npc: 'npl' } as const;

// Rotation -> which cell edge the door mesh sits on (left = north at 0,
// upper = east at -90/270) and its interior approach tile offsets
const DOOR_EDGE_BY_ROT: Record<number, { i: number; j: number }> = {
  0: { i: 0, j: -1 },   // north edge  -> tile just inside (south of door)
  90: { i: -1, j: 0 },  // west edge   -> tile just inside (east of door)
  180: { i: 0, j: 1 },  // south edge  -> tile just inside (north of door)
  270: { i: 1, j: 0 }   // east edge   -> tile just inside (west of door)
};
// Character facing (radians) while standing IN FRONT of, i.e. with the back
// towards, a door with that rotation (pointing away from the door into the room)
const DOOR_BACK_FACING_BY_ROT: Record<number, number> = {
  0: 0,               // door at north edge, character faces south (into room)
  90: Math.PI / 2,    // door at west edge, character faces east
  180: Math.PI,       // door at south edge, character faces north
  270: -Math.PI / 2   // door at east edge, character faces west
};

// The walkable sub-tile a door leads to: cell interior tile adjacent to the door
function doorApproachTile(inst: PlacedChunkInstance): { col: number; row: number } {
  const rot = ((Math.round(inst.rotationY) % 360) + 360) % 360;
  const off = DOOR_EDGE_BY_ROT[rot] ?? DOOR_EDGE_BY_ROT[0];
  return { col: inst.cellX * 3 + off.i, row: inst.cellZ * 3 + off.j };
}

function doorBackFacingAngle(inst: PlacedChunkInstance): number {
  const rot = ((Math.round(inst.rotationY) % 360) + 360) % 360;
  return DOOR_BACK_FACING_BY_ROT[rot] ?? 0;
}

// Chunk grid cell size: one chunk = 8m x 8m, neighbors share an edge
const CHUNK_CELL = BLENDER_CHUNK_SIZE;

// Convert tile coordinate to world coordinates with dynamic tile size & surface height
function tileToWorld(col: number, row: number, tileSize: number = TILE_SIZE, surfaceY: number = 0.05): THREE.Vector3 {
  const x = (col - 1) * tileSize;
  const z = (row - 1) * tileSize;
  return new THREE.Vector3(x, surfaceY, z);
}

// Helper: Convert ArrayBuffer to Base64 Data URL
function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string = 'model/gltf-binary'): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], { type: mimeType });
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Helper: Convert Base64 Data URL to ArrayBuffer
function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(',')[1];
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Material tuning for static environment chunks (used by base chunk & all placed copies)
function prepareChunkModel(root: THREE.Object3D) {
  root.traverse((child: any) => {
    if (child.isMesh) {
      child.castShadow = false;
      child.receiveShadow = false;
      child.frustumCulled = false;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m: any) => {
        if (m && m.map) {
          m.map.colorSpace = THREE.SRGBColorSpace;
          m.map.needsUpdate = true;
        }
      });
    }
  });
}


// =========================================================================
// TEXTURE GENERATORS (Matching the Stylized Anime Character from image.png)
// =========================================================================

function createStylizedFloorCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  const bgGrad = ctx.createRadialGradient(512, 512, 100, 512, 512, 700);
  bgGrad.addColorStop(0, '#989793');
  bgGrad.addColorStop(0.6, '#86847f');
  bgGrad.addColorStop(1, '#6c6a66');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  for (let i = 0; i < 600; i++) {
    const rx = Math.random() * 1024;
    const ry = Math.random() * 1024;
    ctx.beginPath();
    ctx.arc(rx, ry, 12 + Math.random() * 24, 0, Math.PI * 2);
    ctx.fill();
  }

  const borderWidth = 64;
  const innerSize = 1024 - borderWidth * 2;
  const tileSize = innerSize / 3;

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const tx = borderWidth + c * tileSize;
      const ty = borderWidth + r * tileSize;

      const subPaver = tileSize / 2;
      for (let sr = 0; sr < 2; sr++) {
        for (let sc = 0; sc < 2; sc++) {
          const px = tx + sc * subPaver;
          const py = ty + sr * subPaver;

          const tint = ((c * 7 + r * 13 + sc * 3 + sr * 5) % 9) - 4;
          const pGrad = ctx.createLinearGradient(px, py, px + subPaver, py + subPaver);
          pGrad.addColorStop(0, `rgb(${145 + tint * 2}, ${143 + tint * 2}, ${138 + tint})`);
          pGrad.addColorStop(1, `rgb(${125 + tint * 2}, ${123 + tint * 2}, ${118 + tint})`);

          const pad = 4;
          const radius = 8;
          ctx.fillStyle = pGrad;
          ctx.beginPath();
          ctx.roundRect(px + pad, py + pad, subPaver - pad * 2, subPaver - pad * 2, radius);
          ctx.fill();

          ctx.strokeStyle = 'rgba(240, 238, 230, 0.45)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(px + pad + radius, py + pad);
          ctx.lineTo(px + subPaver - pad - radius, py + pad);
          ctx.moveTo(px + pad, py + pad + radius);
          ctx.lineTo(px + pad, py + subPaver - pad - radius);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(40, 38, 35, 0.45)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(px + subPaver - pad, py + pad + radius);
          ctx.lineTo(px + subPaver - pad, py + subPaver - pad - radius);
          ctx.moveTo(px + pad + radius, py + subPaver - pad);
          ctx.lineTo(px + subPaver - pad - radius, py + subPaver - pad);
          ctx.stroke();
        }
      }

      ctx.strokeStyle = 'rgba(45, 42, 38, 0.65)';
      ctx.lineWidth = 4;
      ctx.strokeRect(tx + 2, ty + 2, tileSize - 4, tileSize - 4);

      ctx.strokeStyle = 'rgba(190, 165, 120, 0.35)';
      ctx.lineWidth = 2;
      const cornerL = 20;
      ctx.beginPath();
      ctx.moveTo(tx + 12, ty + 12 + cornerL);
      ctx.lineTo(tx + 12, ty + 12);
      ctx.lineTo(tx + 12 + cornerL, ty + 12);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(tx + tileSize - 12 - cornerL, ty + 12);
      ctx.lineTo(tx + tileSize - 12, ty + 12);
      ctx.lineTo(tx + tileSize - 12, ty + 12 + cornerL);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(tx + tileSize - 12, ty + tileSize - 12 - cornerL);
      ctx.lineTo(tx + tileSize - 12, ty + tileSize - 12);
      ctx.lineTo(tx + tileSize - 12 - cornerL, ty + tileSize - 12);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(tx + 12 + cornerL, ty + tileSize - 12);
      ctx.lineTo(tx + 12, ty + tileSize - 12);
      ctx.lineTo(tx + 12, ty + tileSize - 12 - cornerL);
      ctx.stroke();
    }
  }

  const cx = 512;
  const cy = 512;
  ctx.save();
  ctx.strokeStyle = 'rgba(195, 175, 130, 0.4)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 70, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(195, 175, 130, 0.25)';
  ctx.beginPath();
  ctx.arc(cx, cy, 84, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(195, 175, 130, 0.45)';
  [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach(angle => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -96);
    ctx.lineTo(8, -80);
    ctx.lineTo(0, -72);
    ctx.lineTo(-8, -80);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();

  ctx.fillStyle = '#6e6b66';
  ctx.fillRect(0, 0, 1024, borderWidth);
  ctx.fillRect(0, 1024 - borderWidth, 1024, borderWidth);
  ctx.fillRect(0, 0, borderWidth, 1024);
  ctx.fillRect(1024 - borderWidth, 0, borderWidth, 1024);

  ctx.strokeStyle = 'rgba(40, 38, 35, 0.6)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 3; i++) {
    const pos = borderWidth + i * tileSize;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, borderWidth);
    ctx.moveTo(pos, 1024 - borderWidth);
    ctx.lineTo(pos, 1024);
    ctx.moveTo(0, pos);
    ctx.lineTo(borderWidth, pos);
    ctx.moveTo(1024 - borderWidth, pos);
    ctx.lineTo(1024, pos);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(borderWidth, borderWidth);
  ctx.moveTo(1024, 0);
  ctx.lineTo(1024 - borderWidth, borderWidth);
  ctx.moveTo(1024, 1024);
  ctx.lineTo(1024 - borderWidth, 1024 - borderWidth);
  ctx.moveTo(0, 1024);
  ctx.lineTo(borderWidth, 1024 - borderWidth);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(230, 225, 215, 0.4)';
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, 1018, 1018);

  return canvas;
}

function createStylizedWallCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, 1024);
  grad.addColorStop(0, '#555452');
  grad.addColorStop(0.3, '#6f6c68');
  grad.addColorStop(0.8, '#62605b');
  grad.addColorStop(1, '#4d4b47');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);

  const numRows = 7;
  const rowHeight = 1024 / numRows;

  for (let r = 0; r < numRows; r++) {
    const y = r * rowHeight;
    const numCols = 4;
    const colWidth = 1024 / numCols;
    const offset = r % 2 === 0 ? 0 : colWidth / 2;

    for (let c = -1; c <= numCols; c++) {
      const x = c * colWidth + offset;
      const toneOffset = ((r * 11 + c * 17) % 7) - 3;

      const pad = 5;
      const bGrad = ctx.createLinearGradient(x, y, x, y + rowHeight);
      bGrad.addColorStop(0, `rgb(${118 + toneOffset * 2}, ${115 + toneOffset * 2}, ${110 + toneOffset})`);
      bGrad.addColorStop(1, `rgb(${98 + toneOffset * 2}, ${95 + toneOffset * 2}, ${90 + toneOffset})`);

      ctx.fillStyle = bGrad;
      ctx.beginPath();
      ctx.roundRect(x + pad, y + pad, colWidth - pad * 2, rowHeight - pad * 2, 6);
      ctx.fill();

      ctx.strokeStyle = 'rgba(235, 230, 220, 0.28)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x + pad + 6, y + pad);
      ctx.lineTo(x + colWidth - pad - 6, y + pad);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(30, 28, 25, 0.4)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x + pad + 6, y + rowHeight - pad);
      ctx.lineTo(x + colWidth - pad - 6, y + rowHeight - pad);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = 'rgba(35, 33, 30, 0.6)';
  ctx.lineWidth = 4;
  for (let r = 1; r < numRows; r++) {
    const y = r * rowHeight;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1024, y);
    ctx.stroke();
  }

  return canvas;
}

function createStylizedDoorCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 768;
  const ctx = canvas.getContext('2d')!;

  const woodGrad = ctx.createLinearGradient(0, 0, 512, 0);
  woodGrad.addColorStop(0, '#3f2518');
  woodGrad.addColorStop(0.5, '#4e2f1f');
  woodGrad.addColorStop(1, '#3a2114');
  ctx.fillStyle = woodGrad;
  ctx.fillRect(0, 0, 512, 768);

  const numPlanks = 4;
  const plankW = 512 / numPlanks;
  for (let i = 0; i < numPlanks; i++) {
    const px = i * plankW;
    const tone = 75 + (i % 2) * 8;

    const pGrad = ctx.createLinearGradient(px, 0, px + plankW, 0);
    pGrad.addColorStop(0, `rgb(${tone + 8}, ${Math.floor(tone * 0.65)}, ${Math.floor(tone * 0.45)})`);
    pGrad.addColorStop(0.5, `rgb(${tone + 20}, ${Math.floor(tone * 0.75)}, ${Math.floor(tone * 0.5)})`);
    pGrad.addColorStop(1, `rgb(${tone}, ${Math.floor(tone * 0.6)}, ${Math.floor(tone * 0.4)})`);

    ctx.fillStyle = pGrad;
    ctx.beginPath();
    ctx.roundRect(px + 3, 4, plankW - 6, 760, 4);
    ctx.fill();

    ctx.strokeStyle = 'rgba(25, 12, 6, 0.25)';
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 4; k++) {
      const gx = px + 12 + k * 18;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.bezierCurveTo(gx - 6, 250, gx + 6, 500, gx, 768);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = 'rgba(20, 10, 5, 0.7)';
  ctx.lineWidth = 4;
  for (let i = 1; i < numPlanks; i++) {
    ctx.beginPath();
    ctx.moveTo(i * plankW, 0);
    ctx.lineTo(i * plankW, 768);
    ctx.stroke();
  }

  const drawOrnateStrap = (yPos: number) => {
    const strapGrad = ctx.createLinearGradient(0, yPos, 0, yPos + 36);
    strapGrad.addColorStop(0, '#e2e8f0');
    strapGrad.addColorStop(0.5, '#cbd5e1');
    strapGrad.addColorStop(1, '#94a3b8');
    ctx.fillStyle = strapGrad;
    ctx.beginPath();
    ctx.roundRect(24, yPos, 464, 36, 8);
    ctx.fill();

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(80, yPos + 18, 10, 0, Math.PI * 2);
    ctx.moveTo(80, yPos + 18);
    ctx.bezierCurveTo(120, yPos + 6, 160, yPos + 30, 200, yPos + 18);
    ctx.arc(256, yPos + 18, 10, 0, Math.PI * 2);
    ctx.moveTo(256, yPos + 18);
    ctx.bezierCurveTo(296, yPos + 6, 336, yPos + 30, 376, yPos + 18);
    ctx.arc(432, yPos + 18, 10, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#fbbf24';
    [40, 140, 256, 370, 472].forEach(rx => {
      ctx.beginPath();
      ctx.arc(rx, yPos + 18, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#92400e';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  };

  drawOrnateStrap(120);
  drawOrnateStrap(600);

  const kx = 180;
  const ky = 380;
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.arc(kx, ky, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(kx, ky, 18, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(kx, ky + 42, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(kx - 3, ky + 39, 32, -Math.PI / 2, Math.PI / 4);
  ctx.stroke();

  return canvas;
}

export const DungeonTestView: React.FC<DungeonTestViewProps> = ({ onExit, characters = [] }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const charFileInputRef = useRef<HTMLInputElement>(null);
  const floorFileInputRef = useRef<HTMLInputElement>(null);
  const wallFileInputRef = useRef<HTMLInputElement>(null);
  const doorFileInputRef = useRef<HTMLInputElement>(null);

  // Active Asset Tab in Dock
  const [activeTab, setActiveTab] = useState<'character' | 'floor' | 'wall' | 'door'>('character');

  // Gameplay state (col/row = sub-tile indices on the chunk grid, center = [0,0])
  const [characterCoord, setCharacterCoord] = useState<TileCoord>({ col: 0, row: 0 });
  const [hoveredCoord, setHoveredCoord] = useState<TileCoord | null>(null);
  const [facingDir, setFacingDir] = useState<Direction>('SOUTH');
  const [animState, setAnimState] = useState<'IDLE' | 'RUN'>('IDLE');
  const [moveSpeed, setMoveSpeed] = useState<number>(3.6);
  const [isDockCollapsed, setIsDockCollapsed] = useState<boolean>(false);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const audioEnabledRef = useRef<boolean>(true);
  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
  }, [audioEnabled]);

  // GLB Custom Model state
  const [customModelLoaded, setCustomModelLoaded] = useState<boolean>(false);
  const [customModelName, setCustomModelName] = useState<string>('');
  const [customModelSize, setCustomModelSize] = useState<number>(0);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [dragHoverTarget, setDragHoverTarget] = useState<'character' | 'floor' | 'wall' | 'door' | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('3D-Modell wird geladen...');

  // Character Fine-Tuning state
  const [useRawCharacterScale, setUseRawCharacterScale] = useState<boolean>(true); // 1:1 Blender scale
  const [modelScale, setModelScale] = useState<number>(1.0);
  const [modelOffsetY, setModelOffsetY] = useState<number>(0.0);
  const [modelRotationY, setModelRotationY] = useState<number>(0); // in degrees: 0, 90, 180, 270

  // Floor Chunk GLB state (8m x 8m in Blender, center pivot)
  const [customFloorLoaded, setCustomFloorLoaded] = useState<boolean>(false);
  const [customFloorName, setCustomFloorName] = useState<string>('');
  const [customFloorSize, setCustomFloorSize] = useState<number>(0);
  const [floorScale, setFloorScale] = useState<number>(1.0);
  const [floorOffsetX, setFloorOffsetX] = useState<number>(0.0);
  const [floorOffsetY, setFloorOffsetY] = useState<number>(0.0);
  const [floorOffsetZ, setFloorOffsetZ] = useState<number>(0.0);
  const [floorRotationY, setFloorRotationY] = useState<number>(0);

  // Wall GLB state (8m x 0.5m x 4m in Blender, center-floor pivot)
  const [customWallLoaded, setCustomWallLoaded] = useState<boolean>(false);
  const [customWallName, setCustomWallName] = useState<string>('');
  const [customWallSize, setCustomWallSize] = useState<number>(0);
  const [wallScale, setWallScale] = useState<number>(1.0);
  const [wallOffsetX, setWallOffsetX] = useState<number>(0.0);
  const [wallOffsetY, setWallOffsetY] = useState<number>(0.0);
  const [wallOffsetZ, setWallOffsetZ] = useState<number>(0.0);
  const [wallRotationY, setWallRotationY] = useState<number>(0);
  const [showLeftWall, setShowLeftWall] = useState<boolean>(true);
  const [showUpperWall, setShowUpperWall] = useState<boolean>(true);

  // Door GLB state (center of left wall at 0°, center of upper wall at -90°)
  const [customDoorLoaded, setCustomDoorLoaded] = useState<boolean>(false);
  const [customDoorName, setCustomDoorName] = useState<string>('');
  const [customDoorSize, setCustomDoorSize] = useState<number>(0);
  const [doorScale, setDoorScale] = useState<number>(1.0);
  const [doorOffsetX, setDoorOffsetX] = useState<number>(0.0);
  const [doorOffsetY, setDoorOffsetY] = useState<number>(0.0);
  const [doorOffsetZ, setDoorOffsetZ] = useState<number>(0.0);
  const [doorRotationY, setDoorRotationY] = useState<number>(0);
  const [showLeftDoor, setShowLeftDoor] = useState<boolean>(true);
  const [showUpperDoor, setShowUpperDoor] = useState<boolean>(false);

  const customFloorLoadedRef = useRef<boolean>(false);
  useEffect(() => {
    customFloorLoadedRef.current = customFloorLoaded;
  }, [customFloorLoaded]);

  const floorOffsetYRef = useRef<number>(0.0);
  useEffect(() => {
    floorOffsetYRef.current = floorOffsetY;
  }, [floorOffsetY]);

  // ---- Chunk library & multi-placement state ----
  const [chunkLibrary, setChunkLibrary] = useState<ChunkLibraryEntry[]>([]);
  const chunkLibraryRef = useRef<ChunkLibraryEntry[]>([]);
  const [placedChunks, setPlacedChunks] = useState<PlacedChunkInstance[]>([]);
  const placedChunksRef = useRef<PlacedChunkInstance[]>([]);
  const [placementMode, setPlacementMode] = useState<PlacementSession | null>(null);
  const placementSceneRef = useRef<{ type: PlacementType; libId: string; gltfScene: THREE.Group; animations?: THREE.AnimationClip[]; moveNpcId?: string } | null>(null);
  const placementRequestSeqRef = useRef<number>(0);
  const ghostRotationRef = useRef<number>(0);

  // ---- NPC & enemy figures ----
  const [npcLibrary, setNpcLibrary] = useState<NpcLibraryEntry[]>([]);
  const npcLibraryRef = useRef<NpcLibraryEntry[]>([]);
  const [placedNpcs, setPlacedNpcs] = useState<PlacedNpcInstance[]>([]);
  const placedNpcsRef = useRef<PlacedNpcInstance[]>([]);
  // Idle-Animation mixer per placed instance (cleanup entries when deleted)
  const npcMixersRef = useRef<Array<{ id: string; mixer: THREE.AnimationMixer }>>([]);
  const placedNpcsGroupRef = useRef<THREE.Group | null>(null);
  const npcFileInputRef = useRef<HTMLInputElement>(null);
  const enemyFileInputRef = useRef<HTMLInputElement>(null);

  // Edit modes for already placed chunks (move / delete)
  const [editMode, setEditMode] = useState<ChunkEditMode>(null);
  const editModeRef = useRef<ChunkEditMode>(null);
  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  // Dungeon sections: the player is always inside one section; links between
  // paired doors switch sections during play
  const [sections, setSections] = useState<SectionInfo[]>([{ id: 'root', name: 'Abschnitt 1' }]);
  const sectionsRef = useRef<SectionInfo[]>([{ id: 'root', name: 'Abschnitt 1' }]);
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);
  const [activeSection, setActiveSection] = useState<string>('root');
  const activeSectionRef = useRef<string>('root');
  // File name of the first door picked while linking two doors
  const [linkPickName, setLinkPickName] = useState<string | null>(null);
  // Transient purple info pill (e.g. "door leads nowhere")
  const [portalHint, setPortalHint] = useState<string | null>(null);
  const portalHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showPortalHint = useCallback((text: string) => {
    if (portalHintTimerRef.current) clearTimeout(portalHintTimerRef.current);
    setPortalHint(text);
    portalHintTimerRef.current = setTimeout(() => setPortalHint(null), 4500);
  }, []);

  // Confirm dialog before unlinking a door pair
  const [unlinkAsk, setUnlinkAsk] = useState<{ doorId: string; label: string } | null>(null);
  const askUnlinkRef = useRef<(doorId: string, label: string) => void>(() => {});
  const unlinkDoorRef = useRef<(doorId: string) => void>(() => {});
  useEffect(() => {
    askUnlinkRef.current = (doorId, label) => setUnlinkAsk({ doorId, label });
  }, []);
  const resolveUnlink = (accepted: boolean) => {
    const ask = unlinkAsk;
    setUnlinkAsk(null);
    if (ask && accepted) unlinkDoorRef.current(ask.doorId);
  };

  // Camera look-at target, mutable outside the mount effect (section teleport)
  const camTargetRef = useRef<THREE.Vector3 | null>(null);
  // Effect <-> component bridges for section focus & door walks
  const focusSectionRef = useRef<(sectionId: string, door?: PlacedChunkInstance) => void>(() => {});
  const beginDoorWalkRef = useRef<(door: PlacedChunkInstance) => boolean>(() => false);
  // Handle click on a door while in link mode (effect scope), and link-mode
  // enter/exit handling (visibility flip, line display)
  const handleDoorLinkClickRef = useRef<(door: PlacedChunkInstance) => void>(() => {});
  const handleLinkModeChangedRef = useRef<(active: boolean) => void>(() => {});
  // Rebuild the door link glow quads (e.g. after deleting a linked door)
  const refreshLinkHighlightsRef = useRef<() => void>(() => {});
  // Called by the movement engine when the character arrives at a clicked door
  const doorArrivalRef = useRef<(doorId: string) => void>(() => {});
  // Tile (sub-tile key) where the character is walking to traverse a door
  const pendingPortalTileRef = useRef<{ col: number; row: number; doorId: string } | null>(null);

  // Three.js mutable references for the placement system (assigned inside mount effect)
  const ghostGroupRef = useRef<THREE.Group | null>(null);
  const ghostModelHolderRef = useRef<THREE.Group | null>(null);
  const ghostMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const ghostFootprintMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const ghostBorderMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const placedChunksGroupRef = useRef<THREE.Group | null>(null);

  const syncPlacedGroupRef = useRef<(list: PlacedChunkInstance[]) => void>(null);
  const syncNpcGroupRef = useRef<(list: PlacedNpcInstance[]) => void>(null);
  const applyGhostRef = useRef<() => void>(null);
  const hideGhostRef = useRef<() => void>(() => {});
  // Restores a carried chunk to its original cell when a move is aborted
  const restoreMoveRef = useRef<() => void>(() => {});

  // Base chunk occupancy mirrors (scene handlers can't read React state directly)
  const baseWallFlagsRef = useRef<{ left: boolean; upper: boolean }>({ left: false, upper: false });
  const baseDoorFlagsRef = useRef<{ left: boolean; upper: boolean }>({ left: false, upper: false });
  useEffect(() => {
    baseWallFlagsRef.current = {
      left: customWallLoaded && showLeftWall,
      upper: customWallLoaded && showUpperWall
    };
  }, [customWallLoaded, showLeftWall, showUpperWall]);
  useEffect(() => {
    baseDoorFlagsRef.current = {
      left: customDoorLoaded && showLeftDoor,
      upper: customDoorLoaded && showUpperDoor
    };
  }, [customDoorLoaded, showLeftDoor, showUpperDoor]);


  // Animation clips found in GLB
  const [availableClips, setAvailableClips] = useState<string[]>([]);
  const [selectedIdleClip, setSelectedIdleClip] = useState<string>('');
  const [selectedRunClip, setSelectedRunClip] = useState<string>('');
  const selectedIdleClipRef = useRef<string>('');
  const selectedRunClipRef = useRef<string>('');
  const moveSpeedRef = useRef<number>(3.6);

  useEffect(() => {
    moveSpeedRef.current = moveSpeed;
  }, [moveSpeed]);

  // Dynamic Tile and Surface parameters (one chunk = 3x3 sub-tiles of 8/3m)
  const currentTileSizeRef = useRef<number>(BLENDER_TILE_SIZE);
  const currentSurfaceYRef = useRef<number>(0.05);

  useEffect(() => {
    currentTileSizeRef.current = BLENDER_TILE_SIZE;
    currentSurfaceYRef.current = customFloorLoaded ? (0.25 + floorOffsetY) : 0.05;
  }, [customFloorLoaded, floorOffsetY]);

  // Three.js mutable references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const characterRootRef = useRef<THREE.Group | null>(null);
  const customModelInnerRef = useRef<THREE.Group | null>(null);
  const characterNaturalHeightRef = useRef<number>(1.85);
  const tileMeshesRef = useRef<THREE.Mesh[]>([]);
  const hoverIndicatorRef = useRef<THREE.Group | null>(null);
  // Walkable sub-tile keys ("x,z") across the whole dungeon + rebuild trigger
  const walkableKeysRef = useRef<Set<string>>(new Set(['0,0']));
  const refreshWalkableTilesRef = useRef<(opts?: { baseFloor?: boolean; section?: string }) => void>(null);

  // Scene Group References (prefab diorama removed - scene starts empty)
  const customFloorGroupRef = useRef<THREE.Group | null>(null);
  const customWallGroupRef = useRef<THREE.Group | null>(null);
  const customDoorGroupRef = useRef<THREE.Group | null>(null);
  const floorGltfSceneRef = useRef<THREE.Group | null>(null);
  const wallGltfSceneRef = useRef<THREE.Group | null>(null);
  const doorGltfSceneRef = useRef<THREE.Group | null>(null);

  // Animation mixer & clips
  const animationMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const gltfClipsMapRef = useRef<Map<string, THREE.AnimationClip>>(new Map());
  const activeActionRef = useRef<THREE.AnimationAction | null>(null);
  const activeActionNameRef = useRef<'idle' | 'run'>('idle');

  // Movement queue & navigation
  const moveQueueRef = useRef<TileCoord[]>([]);
  const currentTileRef = useRef<TileCoord>({ col: 0, row: 0 });
  const characterPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const targetWorldPosRef = useRef<THREE.Vector3 | null>(null);
  const currentFacingAngleRef = useRef<number>(0);
  const targetFacingAngleRef = useRef<number>(0);

  // Procedural dummy reference for fallback
  const animeKnightRef = useRef<{
    torso?: THREE.Group;
    head?: THREE.Group;
    hair?: THREE.Group;
    leftArm?: THREE.Group;
    rightArm?: THREE.Group;
    leftLeg?: THREE.Group;
    rightLeg?: THREE.Group;
  }>({});

  // Sound Synthesizer for tactile feedback
  const playTactileSfx = useCallback((type: 'click' | 'step' | 'hover' | 'success') => {
    if (!audioEnabledRef.current) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'hover') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(560, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(740, ctx.currentTime + 0.04);
        gain.gain.setValueAtTime(0.015, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
        osc.start();
        osc.stop(ctx.currentTime + 0.04);
      } else if (type === 'click') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.07, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } else if (type === 'step') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(130, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.06);
        gain.gain.setValueAtTime(0.04, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
        osc.start();
        osc.stop(ctx.currentTime + 0.06);
      } else if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
        osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2); // G5
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch {
      // Audio fallback
    }
  }, []);

  // Create built-in anime knight dummy
  const createAnimeKnightDummy = useCallback((): THREE.Group => {
    const root = new THREE.Group();
    root.name = 'AnimeKnightDummy';

    const armorMat = new THREE.MeshLambertMaterial({ color: 0xedf2f7 });
    const armorDarkMat = new THREE.MeshLambertMaterial({ color: 0xcfd8dc });
    const blueTabardMat = new THREE.MeshLambertMaterial({ color: 0x2563eb });
    const blueDarkMat = new THREE.MeshLambertMaterial({ color: 0x1d4ed8 });
    const redHairMat = new THREE.MeshLambertMaterial({ color: 0xdc2626 });
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xffe4d6 });
    const leatherMat = new THREE.MeshLambertMaterial({ color: 0x6b4423 });
    const goldMat = new THREE.MeshLambertMaterial({ color: 0xf59e0b });
    const eyeMat = new THREE.MeshLambertMaterial({ color: 0x0284c7 });

    const pelvis = new THREE.Group();
    pelvis.position.y = 0.95;
    root.add(pelvis);

    const torsoGroup = new THREE.Group();
    const breastplateGeo = new THREE.CylinderGeometry(0.28, 0.22, 0.55, 24);
    const breastplate = new THREE.Mesh(breastplateGeo, armorMat);
    breastplate.position.y = 0.32;
    torsoGroup.add(breastplate);

    const gorgetGeo = new THREE.CylinderGeometry(0.18, 0.24, 0.14, 20);
    const gorget = new THREE.Mesh(gorgetGeo, armorDarkMat);
    gorget.position.y = 0.62;
    torsoGroup.add(gorget);

    const beltGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.1, 24);
    const belt = new THREE.Mesh(beltGeo, leatherMat);
    belt.position.y = 0.06;
    torsoGroup.add(belt);

    const buckleGeo = new THREE.BoxGeometry(0.1, 0.12, 0.12);
    const buckle = new THREE.Mesh(buckleGeo, goldMat);
    buckle.position.set(0, 0.06, 0.21);
    torsoGroup.add(buckle);

    const skirtGroup = new THREE.Group();
    const skirtGeo = new THREE.CylinderGeometry(0.24, 0.42, 0.55, 24, 1, true);
    const skirt = new THREE.Mesh(skirtGeo, blueTabardMat);
    skirt.position.y = -0.22;
    skirtGroup.add(skirt);

    const flapGeo = new THREE.PlaneGeometry(0.22, 0.52);
    const flap = new THREE.Mesh(flapGeo, blueDarkMat);
    flap.position.set(0, -0.22, 0.28);
    skirtGroup.add(flap);

    torsoGroup.add(skirtGroup);
    pelvis.add(torsoGroup);
    animeKnightRef.current.torso = torsoGroup;

    const headGroup = new THREE.Group();
    headGroup.position.y = 0.76;
    const headGeo = new THREE.SphereGeometry(0.25, 24, 20);
    headGeo.scale(1, 1.12, 1);
    const head = new THREE.Mesh(headGeo, skinMat);
    headGroup.add(head);

    const eyeGeo = new THREE.PlaneGeometry(0.08, 0.12);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.09, 0.02, 0.24);
    leftEye.rotation.y = -0.15;
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.09, 0.02, 0.24);
    rightEye.rotation.y = 0.15;
    headGroup.add(leftEye);
    headGroup.add(rightEye);

    const hairGroup = new THREE.Group();
    const hairCrownGeo = new THREE.SphereGeometry(0.28, 20, 16);
    hairCrownGeo.scale(1.05, 1.05, 1.08);
    const hairCrown = new THREE.Mesh(hairCrownGeo, redHairMat);
    hairCrown.position.set(0, 0.06, -0.05);
    hairGroup.add(hairCrown);

    const hairBackGeo = new THREE.CylinderGeometry(0.28, 0.38, 0.85, 16);
    const hairBack = new THREE.Mesh(hairBackGeo, redHairMat);
    hairBack.position.set(0, -0.32, -0.18);
    hairBack.rotation.x = -0.12;
    hairGroup.add(hairBack);

    const bangGeo = new THREE.ConeGeometry(0.12, 0.32, 12);
    bangGeo.rotateZ(0.25);
    const bangLeft = new THREE.Mesh(bangGeo, redHairMat);
    bangLeft.position.set(-0.1, 0.12, 0.2);
    const bangRight = new THREE.Mesh(bangGeo, redHairMat);
    bangRight.position.set(0.12, 0.12, 0.19);
    bangRight.rotation.z = -0.4;
    hairGroup.add(bangLeft);
    hairGroup.add(bangRight);

    headGroup.add(hairGroup);
    animeKnightRef.current.hair = hairGroup;
    animeKnightRef.current.head = headGroup;
    torsoGroup.add(headGroup);

    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-0.35, 0.52, 0);
    const pauldronGeo = new THREE.SphereGeometry(0.18, 16, 12, 0, Math.PI);
    pauldronGeo.rotateZ(Math.PI / 2);
    const leftPauldron = new THREE.Mesh(pauldronGeo, armorMat);
    leftPauldron.position.set(-0.06, 0.05, 0);
    leftArmGroup.add(leftPauldron);

    const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.45, 16);
    const leftArm = new THREE.Mesh(armGeo, armorDarkMat);
    leftArm.position.y = -0.22;
    leftArmGroup.add(leftArm);

    const handGeo = new THREE.SphereGeometry(0.09, 14, 12);
    const leftHand = new THREE.Mesh(handGeo, armorMat);
    leftHand.position.y = -0.46;
    leftArmGroup.add(leftHand);

    torsoGroup.add(leftArmGroup);
    animeKnightRef.current.leftArm = leftArmGroup;

    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(0.35, 0.52, 0);
    const rightPauldron = new THREE.Mesh(pauldronGeo, armorMat);
    rightPauldron.position.set(0.06, 0.05, 0);
    rightPauldron.rotation.y = Math.PI;
    rightArmGroup.add(rightPauldron);

    const rightArm = new THREE.Mesh(armGeo, armorDarkMat);
    rightArm.position.y = -0.22;
    rightArmGroup.add(rightArm);

    const rightHand = new THREE.Mesh(handGeo, armorMat);
    rightHand.position.y = -0.46;
    rightArmGroup.add(rightHand);

    torsoGroup.add(rightArmGroup);
    animeKnightRef.current.rightArm = rightArmGroup;

    const leftLegGroup = new THREE.Group();
    leftLegGroup.position.set(-0.16, 0, 0);
    const legGeo = new THREE.CylinderGeometry(0.11, 0.09, 0.55, 16);
    const leftLeg = new THREE.Mesh(legGeo, armorMat);
    leftLeg.position.y = -0.28;
    leftLegGroup.add(leftLeg);

    const bootGeo = new THREE.BoxGeometry(0.14, 0.18, 0.26);
    const leftBoot = new THREE.Mesh(bootGeo, armorDarkMat);
    leftBoot.position.set(0, -0.62, 0.05);
    leftLegGroup.add(leftBoot);

    pelvis.add(leftLegGroup);
    animeKnightRef.current.leftLeg = leftLegGroup;

    const rightLegGroup = new THREE.Group();
    rightLegGroup.position.set(0.16, 0, 0);
    const rightLeg = new THREE.Mesh(legGeo, armorMat);
    rightLeg.position.y = -0.28;
    rightLegGroup.add(rightLeg);

    const rightBoot = new THREE.Mesh(bootGeo, armorDarkMat);
    rightBoot.position.set(0, -0.62, 0.05);
    rightLegGroup.add(rightBoot);

    pelvis.add(rightLegGroup);
    animeKnightRef.current.rightLeg = rightLegGroup;

    const shadowGeo = new THREE.PlaneGeometry(0.95, 0.95);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 0.01;
    root.add(shadowMesh);

    return root;
  }, []);

  // Update Procedural Character Kinematics
  const updateCharacterPose = useCallback((delta: number, elapsed: number, moving: boolean) => {
    // If using GLTF AnimationMixer
    if (animationMixerRef.current) {
      animationMixerRef.current.update(delta);
      return;
    }

    // If GLB loaded but has no skeletal animation: apply gentle procedural walk/idle bob to model
    if (customModelInnerRef.current) {
      if (moving) {
        customModelInnerRef.current.position.y = modelOffsetY + Math.abs(Math.sin(elapsed * 12)) * 0.06;
        customModelInnerRef.current.rotation.z = Math.sin(elapsed * 12) * 0.04;
      } else {
        customModelInnerRef.current.position.y = modelOffsetY + Math.sin(elapsed * 2.4) * 0.015;
        customModelInnerRef.current.rotation.z = 0;
      }
      return;
    }

    // Procedural Dummy Animation
    const limbs = animeKnightRef.current;
    if (!limbs.leftLeg || !limbs.rightLeg || !limbs.leftArm || !limbs.rightArm || !limbs.torso) return;

    if (moving) {
      const runSpeed = 13;
      const legCycle = Math.sin(elapsed * runSpeed);
      const armCycle = Math.cos(elapsed * runSpeed);

      limbs.leftLeg.rotation.x = legCycle * 0.72;
      limbs.rightLeg.rotation.x = -legCycle * 0.72;
      limbs.leftArm.rotation.x = -armCycle * 0.65;
      limbs.rightArm.rotation.x = armCycle * 0.65;

      limbs.torso.position.y = 0.32 + Math.abs(Math.sin(elapsed * runSpeed * 2)) * 0.06;
      limbs.torso.rotation.x = 0.14;
      limbs.torso.rotation.y = legCycle * 0.1;

      if (limbs.hair) {
        limbs.hair.rotation.x = Math.sin(elapsed * runSpeed * 2) * 0.08 - 0.05;
      }
    } else {
      const idleSpeed = 2.4;
      const breath = Math.sin(elapsed * idleSpeed);

      limbs.leftLeg.rotation.x = THREE.MathUtils.damp(limbs.leftLeg.rotation.x, 0, 8, delta);
      limbs.rightLeg.rotation.x = THREE.MathUtils.damp(limbs.rightLeg.rotation.x, 0, 8, delta);
      limbs.leftArm.rotation.x = THREE.MathUtils.damp(limbs.leftArm.rotation.x, Math.sin(elapsed * idleSpeed) * 0.06, 6, delta);
      limbs.rightArm.rotation.x = THREE.MathUtils.damp(limbs.rightArm.rotation.x, -Math.sin(elapsed * idleSpeed) * 0.06, 6, delta);

      limbs.torso.position.y = 0.32 + breath * 0.02;
      limbs.torso.rotation.x = THREE.MathUtils.damp(limbs.torso.rotation.x, 0, 8, delta);
      limbs.torso.rotation.y = THREE.MathUtils.damp(limbs.torso.rotation.y, Math.sin(elapsed * 1.2) * 0.03, 6, delta);

      if (limbs.hair) {
        limbs.hair.rotation.x = Math.sin(elapsed * 2.2) * 0.02;
      }
    }
  }, [modelOffsetY]);

  // Set Character Animation Clip
  const playAnimationClip = useCallback((clipName: string, fadeDuration: number = 0.25) => {
    if (!animationMixerRef.current || !clipName) return;
    const clip = gltfClipsMapRef.current.get(clipName);
    if (!clip) return;

    const nextAction = animationMixerRef.current.clipAction(clip);
    const currentAction = activeActionRef.current;

    if (currentAction === nextAction) {
      if (!currentAction.isRunning()) {
        currentAction.reset().play();
      }
      return;
    }

    if (currentAction) {
      currentAction.fadeOut(fadeDuration);
    }

    nextAction.reset().fadeIn(fadeDuration).play();
    activeActionRef.current = nextAction;
  }, []);

  // Switch animation between Idle and Run using always-fresh clip refs
  const updateMovementAnimation = useCallback((moving: boolean) => {
    if (!animationMixerRef.current) return;
    const clipName = moving ? selectedRunClipRef.current : selectedIdleClipRef.current;
    if (clipName) {
      playAnimationClip(clipName);
    }
  }, [playAnimationClip]);

  const updateMovementAnimationRef = useRef(updateMovementAnimation);
  useEffect(() => {
    updateMovementAnimationRef.current = updateMovementAnimation;
  }, [updateMovementAnimation]);

  // Instantiate and mount GLB Scene into Three.js
  const mountGLBModel = useCallback((gltf: any, config?: Partial<StoredGLBConfig>) => {
    if (!sceneRef.current) return;

    // Clear existing character
    if (characterRootRef.current && sceneRef.current) {
      sceneRef.current.remove(characterRootRef.current);
    }

    const model = gltf.scene;
    model.name = 'UserCustomGLB';

    // Normalize materials and skinning
    model.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;

        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m: any) => {
          if (m) {
            if ('roughness' in m) m.roughness = 0.85;
            if ('metalness' in m) m.metalness = 0.05;
            if (m.map) {
              m.map.colorSpace = THREE.SRGBColorSpace;
              m.map.needsUpdate = true;
            }
          }
        });
      }
    });

    // Compute bounding box and normalize scale & pivot to bottom-center
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Standard character height ~1.85m or true 1:1 Blender scale
    const naturalHeight = size.y || 1;
    characterNaturalHeightRef.current = naturalHeight;
    const isRawScale = config?.useRawScale !== undefined ? config.useRawScale : useRawCharacterScale;
    const baseScale = isRawScale ? 1.0 : (1.85 / naturalHeight);

    // Center model at its feet
    model.position.set(-center.x, -box.min.y, -center.z);

    // Inner wrapper for user scale, offset, and rotation adjustments
    const innerWrapper = new THREE.Group();
    innerWrapper.name = 'GLBInnerAdjuster';
    innerWrapper.add(model);

    const userScale = config?.scale ?? modelScale;
    const userOffsetY = config?.offsetY ?? modelOffsetY;
    const userRotY = (config?.rotationY ?? modelRotationY) * (Math.PI / 180);

    innerWrapper.scale.set(baseScale * userScale, baseScale * userScale, baseScale * userScale);
    innerWrapper.position.set(0, userOffsetY, 0);
    innerWrapper.rotation.y = userRotY;
    customModelInnerRef.current = innerWrapper;

    // Root wrapper for dungeon tile navigation and cardinal directions
    const root = new THREE.Group();
    root.name = 'CharacterRoot';
    root.add(innerWrapper);

    // Soft grounded shadow beneath character
    const shadowGeo = new THREE.PlaneGeometry(0.95, 0.95);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 0.01;
    root.add(shadowMesh);

    // Apply current position and facing angle
    root.position.copy(characterPosRef.current);
    root.rotation.y = currentFacingAngleRef.current;

    sceneRef.current.add(root);
    characterRootRef.current = root;

    // Process Animations
    const clips = gltf.animations || [];
    gltfClipsMapRef.current.clear();
    const clipNames: string[] = [];

    clips.forEach((clip: THREE.AnimationClip) => {
      gltfClipsMapRef.current.set(clip.name, clip);
      clipNames.push(clip.name);
    });

    setAvailableClips(clipNames);

    if (clips.length > 0) {
      const mixer = new THREE.AnimationMixer(model);
      animationMixerRef.current = mixer;

      // Auto-detect Idle & Run clips or use config
      let idleName = config?.idleClipName || clipNames.find(n => /idle|stand|wait|pose/i.test(n)) || clipNames[0];
      let runName = config?.runClipName || clipNames.find(n => /run|walk|move|jog/i.test(n)) || clipNames[1] || clipNames[0];

      setSelectedIdleClip(idleName);
      setSelectedRunClip(runName);
      selectedIdleClipRef.current = idleName;
      selectedRunClipRef.current = runName;

      const idleClip = gltfClipsMapRef.current.get(idleName);
      if (idleClip) {
        const action = mixer.clipAction(idleClip);
        action.play();
        activeActionRef.current = action;
        activeActionNameRef.current = 'idle';
      }
    } else {
      animationMixerRef.current = null;
      activeActionRef.current = null;
      setSelectedIdleClip('');
      setSelectedRunClip('');
      selectedIdleClipRef.current = '';
      selectedRunClipRef.current = '';
    }

    setCustomModelLoaded(true);
    playTactileSfx('success');
  }, [modelScale, modelOffsetY, modelRotationY, useRawCharacterScale, playTactileSfx]);

  // Mount Custom Floor GLB (Blender 8m x 8m, center pivot)
  const mountFloorGLB = useCallback((gltf: any, config?: Partial<StoredEnvironmentGLBConfig>) => {
    if (!sceneRef.current || !customFloorGroupRef.current) return;

    while (customFloorGroupRef.current.children.length > 0) {
      customFloorGroupRef.current.remove(customFloorGroupRef.current.children[0]);
    }

    const model = gltf.scene;
    model.name = 'UserCustomFloorScene';
    floorGltfSceneRef.current = model;

    model.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m: any) => {
          if (m && m.map) {
            m.map.colorSpace = THREE.SRGBColorSpace;
            m.map.needsUpdate = true;
          }
        });
      }
    });

    customFloorGroupRef.current.add(model);
    customFloorGroupRef.current.visible = true;

    const posX = config?.offsetX ?? floorOffsetX;
    const posY = config?.offsetY ?? floorOffsetY;
    const posZ = config?.offsetZ ?? floorOffsetZ;
    const rotY = ((config?.rotationY ?? floorRotationY) * Math.PI) / 180;
    const scale = config?.scale ?? floorScale;

    customFloorGroupRef.current.position.set(posX, posY, posZ);
    customFloorGroupRef.current.rotation.y = rotY;
    customFloorGroupRef.current.scale.setScalar(scale);

    // Base chunk floor defines walkable grid origin
    setCustomFloorLoaded(true);
    refreshWalkableTilesRef.current?.({ baseFloor: true });
    playTactileSfx('success');
  }, [floorOffsetX, floorOffsetY, floorOffsetZ, floorRotationY, floorScale, playTactileSfx]);
  // Mount Custom Wall GLB (Blender 8m x 0.5m x 4m, floor-center pivot)
  const mountWallGLB = useCallback((gltf: any, config?: Partial<StoredEnvironmentGLBConfig>) => {
    if (!sceneRef.current || !customWallGroupRef.current) return;

    while (customWallGroupRef.current.children.length > 0) {
      customWallGroupRef.current.remove(customWallGroupRef.current.children[0]);
    }

    const baseModel = gltf.scene;
    baseModel.name = 'UserCustomWallBase';
    wallGltfSceneRef.current = baseModel;

    baseModel.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m: any) => {
          if (m && m.map) {
            m.map.colorSpace = THREE.SRGBColorSpace;
            m.map.needsUpdate = true;
          }
        });
      }
    });

    const posX = config?.offsetX ?? wallOffsetX;
    const posY = config?.offsetY ?? wallOffsetY;
    const posZ = config?.offsetZ ?? wallOffsetZ;
    const baseRotY = ((config?.rotationY ?? wallRotationY) * Math.PI) / 180;
    const scale = config?.scale ?? wallScale;
    const leftActive = config?.showLeftWall !== undefined ? config.showLeftWall : showLeftWall;
    const upperActive = config?.showUpperWall !== undefined ? config.showUpperWall : showUpperWall;

    // 1. Left_Wall: stands on the left side (rotation 0)
    if (leftActive) {
      const leftWall = baseModel.clone(true);
      leftWall.name = 'Left_Wall';
      leftWall.position.set(0, 0, 0);
      leftWall.rotation.set(0, 0, 0);
      customWallGroupRef.current.add(leftWall);
    }

    // 2. Upper_Wall: rotated -90° (-Math.PI / 2) around floor center pivot to stand on the upper side
    if (upperActive) {
      const upperWall = baseModel.clone(true);
      upperWall.name = 'Upper_Wall';
      upperWall.position.set(0, 0, 0);
      upperWall.rotation.set(0, -Math.PI / 2, 0);
      customWallGroupRef.current.add(upperWall);
    }

    customWallGroupRef.current.position.set(posX, posY, posZ);
    customWallGroupRef.current.rotation.y = baseRotY;
    customWallGroupRef.current.scale.setScalar(scale);
    customWallGroupRef.current.visible = true;

    setCustomWallLoaded(true);
    playTactileSfx('success');
  }, [wallOffsetX, wallOffsetY, wallOffsetZ, wallRotationY, wallScale, showLeftWall, showUpperWall, playTactileSfx]);

  const mountFloorGLBRef = useRef(mountFloorGLB);
  useEffect(() => {
    mountFloorGLBRef.current = mountFloorGLB;
  }, [mountFloorGLB]);

  const mountWallGLBRef = useRef(mountWallGLB);
  useEffect(() => {
    mountWallGLBRef.current = mountWallGLB;
  }, [mountWallGLB]);

  // Mount Custom Door GLB (in center of left wall at 0°, rotated -90° for upper wall)
  const mountDoorGLB = useCallback((gltf: any, config?: Partial<StoredEnvironmentGLBConfig>) => {
    if (!sceneRef.current || !customDoorGroupRef.current) return;

    while (customDoorGroupRef.current.children.length > 0) {
      customDoorGroupRef.current.remove(customDoorGroupRef.current.children[0]);
    }

    const baseModel = gltf.scene;
    baseModel.name = 'UserCustomDoorBase';
    doorGltfSceneRef.current = baseModel;

    baseModel.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m: any) => {
          if (m && m.map) {
            m.map.colorSpace = THREE.SRGBColorSpace;
            m.map.needsUpdate = true;
          }
        });
      }
    });

    const posX = config?.offsetX ?? doorOffsetX;
    const posY = config?.offsetY ?? doorOffsetY;
    const posZ = config?.offsetZ ?? doorOffsetZ;
    const baseRotY = ((config?.rotationY ?? doorRotationY) * Math.PI) / 180;
    const scale = config?.scale ?? doorScale;
    const leftActive = config?.showLeftDoor !== undefined ? config.showLeftDoor : showLeftDoor;
    const upperActive = config?.showUpperDoor !== undefined ? config.showUpperDoor : showUpperDoor;

    // 1. Left_Door: positioned in the center of the left wall (rotation 0)
    if (leftActive) {
      const leftDoor = baseModel.clone(true);
      leftDoor.name = 'Left_Door';
      leftDoor.position.set(0, 0, 0);
      leftDoor.rotation.set(0, 0, 0);
      customDoorGroupRef.current.add(leftDoor);
    }

    // 2. Upper_Door: rotated -90° around floor center pivot to appear in the center of the upper wall
    if (upperActive) {
      const upperDoor = baseModel.clone(true);
      upperDoor.name = 'Upper_Door';
      upperDoor.position.set(0, 0, 0);
      upperDoor.rotation.set(0, -Math.PI / 2, 0);
      customDoorGroupRef.current.add(upperDoor);
    }

    customDoorGroupRef.current.position.set(posX, posY, posZ);
    customDoorGroupRef.current.rotation.y = baseRotY;
    customDoorGroupRef.current.scale.setScalar(scale);
    customDoorGroupRef.current.visible = true;

    setCustomDoorLoaded(true);
    playTactileSfx('success');
  }, [doorOffsetX, doorOffsetY, doorOffsetZ, doorRotationY, doorScale, showLeftDoor, showUpperDoor, playTactileSfx]);

  const mountDoorGLBRef = useRef(mountDoorGLB);
  useEffect(() => {
    mountDoorGLBRef.current = mountDoorGLB;
  }, [mountDoorGLB]);

  // =========================================================================
  // CHUNK LIBRARY & MULTI-PLACEMENT (Grid-Snapping Editor)
  // =========================================================================

  // Register an uploaded GLB file in the reusable chunk library
  const addChunkLibraryEntry = useCallback(async (type: ChunkType, fileName: string, fileSize: number, dataBase64: string) => {
    const entry: ChunkLibraryEntry = {
      id: `chunk_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
      type,
      fileName,
      fileSize,
      dataBase64
    };
    const next = [...chunkLibraryRef.current, entry];
    chunkLibraryRef.current = next;
    setChunkLibrary(next);
    try {
      await setItem(CHUNK_LIBRARY_KEY, next);
    } catch (e) {
      console.warn('Could not save chunk library:', e);
    }
  }, []);

  // Remove a library entry (and every placed copy that used it)
  const removeChunkLibraryEntry = useCallback(async (id: string) => {
    const entry = chunkLibraryRef.current.find(e => e.id === id);
    // Exit placement mode if the removed file was being placed
    if (placementSceneRef.current?.libId === id) {
      placementSceneRef.current = null;
      placementRequestSeqRef.current += 1;
      setPlacementMode(null);
      hideGhostRef.current?.();
    }

    const removed = placedChunksRef.current.filter(p => p.libraryId === id);
    // Free portal partners of removed linked doors
    removed.forEach(p => {
      if (!p.portalId) return;
      const partner = placedChunksRef.current.find(q => q.id === p.portalId);
      if (partner) {
        partner.portalId = undefined;
        partner.pairColorIndex = undefined;
      }
    });
    const remaining = placedChunksRef.current.filter(p => p.libraryId !== id);
    placedChunksRef.current = remaining;
    setPlacedChunks(remaining);
    try {
      await setItem(CHUNK_PLACEMENTS_KEY, remaining);
    } catch (e) {
      console.warn('Could not save chunk placements:', e);
    }
    syncPlacedGroupRef.current?.(remaining);
    refreshWalkableTilesRef.current?.();

    const nextLib = chunkLibraryRef.current.filter(e => e.id !== id);
    chunkLibraryRef.current = nextLib;
    setChunkLibrary(nextLib);
    try {
      await setItem(CHUNK_LIBRARY_KEY, nextLib);
    } catch (e) {
      console.warn('Could not save chunk library:', e);
    }
    playTactileSfx('click');
    if (entry) console.info(`Chunk "${entry.fileName}" aus der Bibliothek entfernt.`);
  }, [playTactileSfx]);

  // Apply a new list of placed chunks (removals happen here)
  const updatePlacements = useCallback(async (list: PlacedChunkInstance[]) => {
    placedChunksRef.current = list;
    setPlacedChunks(list);
    try {
      await setItem(CHUNK_PLACEMENTS_KEY, list);
    } catch (e) {
      console.warn('Could not save chunk placements:', e);
    }
    syncPlacedGroupRef.current?.(list);
    refreshWalkableTilesRef.current?.();
  }, []);

  // Register an uploaded character GLB in the reusable NPC/enemy library
  const addNpcLibraryEntry = useCallback(async (kind: NpcKind, fileName: string, fileSize: number, dataBase64: string) => {
    const entry: NpcLibraryEntry = {
      id: makePlacementId('npc_lib'),
      kind,
      fileName,
      fileSize,
      dataBase64
    };
    const next = [...npcLibraryRef.current, entry];
    npcLibraryRef.current = next;
    setNpcLibrary(next);
    try {
      await setItem(NPC_LIBRARY_KEY, next);
    } catch (e) {
      console.warn('Could not save npc library:', e);
    }
  }, []);

  // Remove a character library entry (and every placed copy that used it)
  const removeNpcLibraryEntry = useCallback(async (id: string) => {
    const entry = npcLibraryRef.current.find(e => e.id === id);
    // Exit placement mode if the removed file was being placed
    if (placementSceneRef.current?.libId === id) {
      placementSceneRef.current = null;
      placementRequestSeqRef.current += 1;
      setPlacementMode(null);
      hideGhostRef.current?.();
    }
    const remaining = placedNpcsRef.current.filter(p => p.libraryId !== id);
    placedNpcsRef.current = remaining;
    setPlacedNpcs(remaining);
    try {
      await setItem(NPC_PLACEMENTS_KEY, remaining);
    } catch (e) {
      console.warn('Could not save npc placements:', e);
    }
    syncNpcGroupRef.current?.(remaining);

    const nextLib = npcLibraryRef.current.filter(e => e.id !== id);
    npcLibraryRef.current = nextLib;
    setNpcLibrary(nextLib);
    try {
      await setItem(NPC_LIBRARY_KEY, nextLib);
    } catch (e) {
      console.warn('Could not save npc library:', e);
    }
    playTactileSfx('click');
    if (entry) console.info(`Charakter "${entry.fileName}" aus der Bibliothek entfernt.`);
  }, [playTactileSfx]);

  // Remove all placed copies of one type
  const clearPlacementsOfType = useCallback(async (type: ChunkType) => {
    // Exit placement mode if a copy of this type was being placed
    if (placementSceneRef.current?.type === type) {
      placementSceneRef.current = null;
      placementRequestSeqRef.current += 1;
      setPlacementMode(null);
      hideGhostRef.current?.();
    }
    // Free portal partners of removed linked doors
    placedChunksRef.current
      .filter(p => p.type === type && p.portalId)
      .forEach(p => {
        const partner = placedChunksRef.current.find(q => q.id === p.portalId);
        if (partner) {
          partner.portalId = undefined;
          partner.pairColorIndex = undefined;
        }
      });
    const remaining = placedChunksRef.current.filter(p => p.type !== type);
    placedChunksRef.current = remaining;
    setPlacedChunks(remaining);
    try {
      await setItem(CHUNK_PLACEMENTS_KEY, remaining);
    } catch (e) {
      console.warn('Could not save chunk placements:', e);
    }
    syncPlacedGroupRef.current?.(remaining);
    refreshWalkableTilesRef.current?.();
    playTactileSfx('click');
  }, [playTactileSfx]);

  // Enter Placement Mode: parse the library GLB and show a snapping ghost
  // Works for chunk types (8m grid) and character kinds (sub-tile grid)
  const startPlacement = useCallback((type: PlacementType, entry: ChunkLibraryEntry | NpcLibraryEntry) => {
    setHoveredCoord(null);
    setIsLoadingModel(true);
    setLoadingMessage(type === 'npc' || type === 'enemy'
      ? `Platzierungsmodus: Charakter "${entry.fileName}"...`
      : `Platzierungsmodus: "${entry.fileName}"...`);
    // Placing something leaves any chunk edit mode
    editModeRef.current = null;
    setEditMode(null);
    handleLinkModeChangedRef.current(false);
    try {
      const buffer = dataUrlToArrayBuffer(entry.dataBase64);
      const requestToken = ++placementRequestSeqRef.current;
      new GLTFLoader().parse(buffer, '', (gltf) => {
        // User may have cancelled while the file was still parsing
        if (requestToken !== placementRequestSeqRef.current) {
          setIsLoadingModel(false);
          return;
        }
        ghostRotationRef.current = 0;
        placementSceneRef.current = {
          type,
          libId: entry.id,
          gltfScene: gltf.scene,
          animations: gltf.animations || []
        };
        setPlacementMode({ type, libId: entry.id, fileName: entry.fileName, rotationY: 0 });
        setIsLoadingModel(false);
        applyGhostRef.current?.();
        playTactileSfx('success');
      }, (err) => {
        console.error('Placement GLTF parse error:', err);
        setIsLoadingModel(false);
      });
    } catch (err: any) {
      console.error('Placement file read error:', err);
      setIsLoadingModel(false);
    }
  }, [playTactileSfx]);

  // Leave Placement Mode
  const cancelPlacement = useCallback(() => {
    if (!placementSceneRef.current) return;
    // An aborted move puts the carried chunk back on its original cell
    restoreMoveRef.current?.();
    placementSceneRef.current = null;
    placementRequestSeqRef.current += 1;
    setPlacementMode(null);
    hideGhostRef.current?.();
    playTactileSfx('hover');
  }, [playTactileSfx]);

  // Toggle a chunk edit mode (move / delete / link doors on placed chunks)
  const toggleEditMode = useCallback((mode: Exclude<ChunkEditMode, null>) => {
    if (editModeRef.current === mode) {
      editModeRef.current = null;
      setEditMode(null);
      handleLinkModeChangedRef.current(false);
    } else {
      // Entering an edit mode leaves any active placement session
      if (placementSceneRef.current) {
        restoreMoveRef.current?.();
        placementSceneRef.current = null;
        placementRequestSeqRef.current += 1;
        setPlacementMode(null);
        hideGhostRef.current?.();
      }
      editModeRef.current = mode;
      setEditMode(mode);
      handleLinkModeChangedRef.current(mode === 'link');
    }
    playTactileSfx('hover');
  }, [playTactileSfx]);

  // Create a new empty dungeon section and jump to it
  const createSection = useCallback(() => {
    const num = sectionsRef.current.length + 1;
    const newSection: SectionInfo = { id: `sec_${Date.now().toString(36)}`, name: `Abschnitt ${num}` };
    const merged = [...sectionsRef.current, newSection];
    setSections(merged);
    setItem(CHUNK_SECTIONS_KEY, merged.filter(s => s.id !== 'root')).catch((e) => {
      console.warn('Could not save dungeon sections:', e);
    });
    focusSectionRef.current(newSection.id);
    playTactileSfx('click');
  }, [playTactileSfx]);

  // Switch the section the player/editor is looking at
  const selectSection = useCallback((id: string) => {
    if (id === activeSectionRef.current) return;
    focusSectionRef.current(id);
    playTactileSfx('click');
  }, [playTactileSfx]);

  // Load Character GLB File
  const processGLBFile = useCallback(async (file: File) => {
    setIsLoadingModel(true);
    setLoadingMessage(`Lade Charakter-Modell "${file.name}"...`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64DataUrl = await arrayBufferToDataUrl(arrayBuffer);

      const loader = new GLTFLoader();
      loader.parse(arrayBuffer, '', async (gltf) => {
        mountGLBModel(gltf, {
          fileName: file.name,
          fileSize: file.size,
          scale: 1.0,
          useRawScale: useRawCharacterScale,
          offsetY: 0.0,
          rotationY: 0.0
        });

        setCustomModelName(file.name);
        setCustomModelSize(file.size);
        setModelScale(1.0);
        setModelOffsetY(0.0);
        setModelRotationY(0);

        try {
          await setItem(STORAGE_KEY_CHAR_GLB, {
            fileName: file.name,
            fileSize: file.size,
            dataBase64: base64DataUrl,
            scale: 1.0,
            useRawScale: useRawCharacterScale,
            offsetY: 0.0,
            rotationY: 0.0
          });
        } catch (storageErr) {
          console.warn("Could not save GLB to IndexedDB:", storageErr);
        }

        setIsLoadingModel(false);
      }, (err) => {
        console.error("GLTF Loader parse error:", err);
        alert("Fehler beim Einlesen der .glb Datei. Bitte prüfe, ob die Datei intakt ist.");
        setIsLoadingModel(false);
      });
    } catch (err: any) {
      console.error("GLB file read error:", err);
      alert("Fehler beim Laden der Datei: " + err.message);
      setIsLoadingModel(false);
    }
  }, [mountGLBModel, useRawCharacterScale]);

  // Load Floor Chunk GLB File (8m x 8m)
  // Upload a character GLB and register it in the NPC/enemy library
  // (no scene mounting: figures appear once they are placed in the dungeon)
  const processNpcGLBFile = useCallback(async (file: File, kind: NpcKind) => {
    const kindLabel = kind === 'enemy' ? 'Gegner' : 'Neutralen-Charakter';
    setIsLoadingModel(true);
    setLoadingMessage(`Lade ${kindLabel} "${file.name}"...`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64DataUrl = await arrayBufferToDataUrl(arrayBuffer);

      new GLTFLoader().parse(arrayBuffer, '', async () => {
        await addNpcLibraryEntry(kind, file.name, file.size, base64DataUrl);
        setIsLoadingModel(false);
        playTactileSfx('success');
      }, (err: any) => {
        console.error(`${kindLabel} GLTF parse error:`, err);
        alert(`Fehler beim Einlesen der Charakter-GLB: ${err?.message ?? err}`);
        setIsLoadingModel(false);
      });
    } catch (err: any) {
      console.error(`${kindLabel} file read error:`, err);
      alert('Fehler beim Laden der Datei: ' + err.message);
      setIsLoadingModel(false);
    }
  }, [addNpcLibraryEntry, playTactileSfx]);

  // Load Floor GLB File
  const processFloorGLBFile = useCallback(async (file: File) => {
    setIsLoadingModel(true);
    setLoadingMessage(`Lade Bodenplatte "${file.name}" (8x8m)...`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64DataUrl = await arrayBufferToDataUrl(arrayBuffer);

      const loader = new GLTFLoader();
      loader.parse(arrayBuffer, '', async (gltf) => {
        mountFloorGLB(gltf, {
          fileName: file.name,
          fileSize: file.size,
          scale: 1.0,
          offsetX: 0.0,
          offsetY: 0.0,
          offsetZ: 0.0,
          rotationY: 0.0
        });

        setCustomFloorName(file.name);
        setCustomFloorSize(file.size);
        setFloorScale(1.0);
        setFloorOffsetX(0.0);
        setFloorOffsetY(0.0);
        setFloorOffsetZ(0.0);
        setFloorRotationY(0);

        // Register in chunk library (file can be re-selected for additional grid copies)
        addChunkLibraryEntry('floor', file.name, file.size, base64DataUrl);        try {
          await setItem(STORAGE_KEY_FLOOR_GLB, {
            fileName: file.name,
            fileSize: file.size,
            dataBase64: base64DataUrl,
            scale: 1.0,
            offsetX: 0.0,
            offsetY: 0.0,
            offsetZ: 0.0,
            rotationY: 0.0
          });
        } catch (storageErr) {
          console.warn("Could not save Floor GLB to IndexedDB:", storageErr);
        }

        setIsLoadingModel(false);
      }, (err) => {
        console.error("Floor GLTF parse error:", err);
        alert("Fehler beim Einlesen der Bodenplatten-GLB: " + err.message);
        setIsLoadingModel(false);
      });
    } catch (err: any) {
      console.error("Floor file read error:", err);
      alert("Fehler beim Laden der Datei: " + err.message);
      setIsLoadingModel(false);
    }
  }, [mountFloorGLB, addChunkLibraryEntry]);

  // Load Wall GLB File (8m length, 4m height)
  const processWallGLBFile = useCallback(async (file: File) => {
    setIsLoadingModel(true);
    setLoadingMessage(`Lade Wand "${file.name}" (8m)...`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64DataUrl = await arrayBufferToDataUrl(arrayBuffer);

      const loader = new GLTFLoader();
      loader.parse(arrayBuffer, '', async (gltf) => {
        mountWallGLB(gltf, {
          fileName: file.name,
          fileSize: file.size,
          scale: 1.0,
          offsetX: 0.0,
          offsetY: 0.0,
          offsetZ: 0.0,
          rotationY: 0.0,
          showLeftWall: showLeftWall,
          showUpperWall: showUpperWall
        });

        setCustomWallName(file.name);
        setCustomWallSize(file.size);
        setWallScale(1.0);
        setWallOffsetX(0.0);
        setWallOffsetY(0.0);
        setWallOffsetZ(0.0);
        setWallRotationY(0);

        // Register in chunk library (file can be re-selected for additional grid copies)
        addChunkLibraryEntry('wall', file.name, file.size, base64DataUrl);        try {
          await setItem(STORAGE_KEY_WALL_GLB, {
            fileName: file.name,
            fileSize: file.size,
            dataBase64: base64DataUrl,
            scale: 1.0,
            offsetX: 0.0,
            offsetY: 0.0,
            offsetZ: 0.0,
            rotationY: 0.0,
            showLeftWall: showLeftWall,
            showUpperWall: showUpperWall
          });
        } catch (storageErr) {
          console.warn("Could not save Wall GLB to IndexedDB:", storageErr);
        }

        setIsLoadingModel(false);
      }, (err) => {
        console.error("Wall GLTF parse error:", err);
        alert("Fehler beim Einlesen der Wand-GLB: " + err.message);
        setIsLoadingModel(false);
      });
    } catch (err: any) {
      console.error("Wall file read error:", err);
      alert("Fehler beim Laden der Datei: " + err.message);
      setIsLoadingModel(false);
    }
  }, [mountWallGLB, showLeftWall, showUpperWall, addChunkLibraryEntry]);

  // Load Door GLB File (center of left wall at 0°, center of upper wall at -90°)
  const processDoorGLBFile = useCallback(async (file: File) => {
    setIsLoadingModel(true);
    setLoadingMessage(`Lade Tür-Modell "${file.name}"...`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64DataUrl = await arrayBufferToDataUrl(arrayBuffer);

      const loader = new GLTFLoader();
      loader.parse(arrayBuffer, '', async (gltf) => {
        mountDoorGLB(gltf, {
          fileName: file.name,
          fileSize: file.size,
          scale: 1.0,
          offsetX: 0.0,
          offsetY: 0.0,
          offsetZ: 0.0,
          rotationY: 0.0,
          showLeftDoor: showLeftDoor,
          showUpperDoor: showUpperDoor
        });

        setCustomDoorName(file.name);
        setCustomDoorSize(file.size);
        setDoorScale(1.0);
        setDoorOffsetX(0.0);
        setDoorOffsetY(0.0);
        setDoorOffsetZ(0.0);
        setDoorRotationY(0);

        // Register in chunk library (file can be re-selected for additional grid copies)
        addChunkLibraryEntry('door', file.name, file.size, base64DataUrl);        try {
          await setItem(STORAGE_KEY_DOOR_GLB, {
            fileName: file.name,
            fileSize: file.size,
            dataBase64: base64DataUrl,
            scale: 1.0,
            offsetX: 0.0,
            offsetY: 0.0,
            offsetZ: 0.0,
            rotationY: 0.0,
            showLeftDoor: showLeftDoor,
            showUpperDoor: showUpperDoor
          });
        } catch (storageErr) {
          console.warn("Could not save Door GLB to IndexedDB:", storageErr);
        }

        setIsLoadingModel(false);
      }, (err) => {
        console.error("Door GLTF parse error:", err);
        alert("Fehler beim Einlesen der Tür-GLB: " + err.message);
        setIsLoadingModel(false);
      });
    } catch (err: any) {
      console.error("Door file read error:", err);
      alert("Fehler beim Laden der Tür-Datei: " + err.message);
      setIsLoadingModel(false);
    }
  }, [mountDoorGLB, showLeftDoor, showUpperDoor, addChunkLibraryEntry]);

  // Load a character's 3D model from the project
  const loadCharacterFromProject = useCallback(async (char: Character) => {
    if (!char.model3dSrc) {
      alert(`Für "${char.name}" ist noch kein 3D-Modell im Charakter-Editor hinterlegt. Du kannst direkt eine .glb Datei hochladen.`);
      return;
    }
    setIsLoadingModel(true);
    setLoadingMessage(`Lade 3D-Modell für ${char.name}...`);
    try {
      const dataUrl = await loadImage(char.model3dSrc);
      if (!dataUrl) {
        alert("3D-Modell im Speicher nicht gefunden.");
        setIsLoadingModel(false);
        return;
      }
      const buffer = dataUrlToArrayBuffer(dataUrl);
      const loader = new GLTFLoader();
      loader.parse(buffer, '', (gltf) => {
        mountGLBModel(gltf, {
          fileName: `${char.name}.glb`,
          scale: char.model3dScale ?? 1.0,
          useRawScale: useRawCharacterScale,
          offsetY: char.model3dOffsetY ?? 0.0,
          rotationY: char.model3dRotationY ?? 0.0,
        });
        setCustomModelName(`${char.name}.glb`);
        setCustomModelSize(0);
        setIsLoadingModel(false);
      });
    } catch (err: any) {
      console.error("Failed to load character GLB:", err);
      setIsLoadingModel(false);
    }
  }, [mountGLBModel, useRawCharacterScale]);

  // Revert to built-in Anime Knight Dummy
  const handleResetToDummy = useCallback(async () => {
    try {
      await setItem(STORAGE_KEY_CHAR_GLB, null);
    } catch (e) {
      console.warn("IDB clear error", e);
    }

    if (characterRootRef.current && sceneRef.current) {
      sceneRef.current.remove(characterRootRef.current);
    }

    animationMixerRef.current = null;
    gltfClipsMapRef.current.clear();
    customModelInnerRef.current = null;

    const dummy = createAnimeKnightDummy();
    dummy.position.copy(characterPosRef.current);
    dummy.rotation.y = currentFacingAngleRef.current;
    sceneRef.current?.add(dummy);
    characterRootRef.current = dummy;

    setCustomModelLoaded(false);
    setCustomModelName('');
    setCustomModelSize(0);
    setAvailableClips([]);
    setSelectedIdleClip('');
    setSelectedRunClip('');
    selectedIdleClipRef.current = '';
    selectedRunClipRef.current = '';
    setModelScale(1.0);
    setModelOffsetY(0.0);
    setModelRotationY(0);
    playTactileSfx('click');
  }, [createAnimeKnightDummy, playTactileSfx]);

  // Revert Floor: remove base chunk (prefab floor no longer exists)
  const handleResetFloor = useCallback(async () => {
    try {
      await setItem(STORAGE_KEY_FLOOR_GLB, null);
    } catch (e) {
      console.warn("IDB clear error", e);
    }
    if (customFloorGroupRef.current) {
      while (customFloorGroupRef.current.children.length > 0) {
        customFloorGroupRef.current.remove(customFloorGroupRef.current.children[0]);
      }
      customFloorGroupRef.current.visible = false;
    }
    floorGltfSceneRef.current = null;
    setCustomFloorLoaded(false);
    refreshWalkableTilesRef.current?.({ baseFloor: false });
    setCustomFloorName('');
    setCustomFloorSize(0);
    setFloorScale(1.0);
    setFloorOffsetX(0.0);
    setFloorOffsetY(0.0);
    setFloorOffsetZ(0.0);
    setFloorRotationY(0);
    playTactileSfx('click');
  }, [playTactileSfx]);

  // Revert Wall: remove base wall chunk
  const handleResetWall = useCallback(async () => {
    try {
      await setItem(STORAGE_KEY_WALL_GLB, null);
    } catch (e) {
      console.warn("IDB clear error", e);
    }
    if (customWallGroupRef.current) {
      while (customWallGroupRef.current.children.length > 0) {
        customWallGroupRef.current.remove(customWallGroupRef.current.children[0]);
      }
      customWallGroupRef.current.visible = false;
    }
    wallGltfSceneRef.current = null;
    setCustomWallLoaded(false);
    setCustomWallName('');
    setCustomWallSize(0);
    setWallScale(1.0);
    setWallOffsetX(0.0);
    setWallOffsetY(0.0);
    setWallOffsetZ(0.0);
    setWallRotationY(0);
    setShowLeftWall(true);
    setShowUpperWall(true);
    playTactileSfx('click');
  }, [playTactileSfx]);

  // Toggle individual walls (Left_Wall and Upper_Wall)
  const toggleLeftWall = useCallback(() => {
    setShowLeftWall(prev => {
      const next = !prev;
      getItem<StoredEnvironmentGLBConfig>(STORAGE_KEY_WALL_GLB).then(stored => {
        if (stored) setItem(STORAGE_KEY_WALL_GLB, { ...stored, showLeftWall: next });
      }).catch(err => console.warn(err));
      return next;
    });
    playTactileSfx('click');
  }, [playTactileSfx]);

  const toggleUpperWall = useCallback(() => {
    setShowUpperWall(prev => {
      const next = !prev;
      getItem<StoredEnvironmentGLBConfig>(STORAGE_KEY_WALL_GLB).then(stored => {
        if (stored) setItem(STORAGE_KEY_WALL_GLB, { ...stored, showUpperWall: next });
      }).catch(err => console.warn(err));
      return next;
    });
    playTactileSfx('click');
  }, [playTactileSfx]);

  // Remove Door GLB
  const handleResetDoor = useCallback(async () => {
    try {
      await setItem(STORAGE_KEY_DOOR_GLB, null);
    } catch (e) {
      console.warn("IDB clear door error", e);
    }
    if (customDoorGroupRef.current) {
      while (customDoorGroupRef.current.children.length > 0) {
        customDoorGroupRef.current.remove(customDoorGroupRef.current.children[0]);
      }
      customDoorGroupRef.current.visible = false;
    }
    doorGltfSceneRef.current = null;
    setCustomDoorLoaded(false);
    setCustomDoorName('');
    setCustomDoorSize(0);
    setDoorScale(1.0);
    setDoorOffsetX(0.0);
    setDoorOffsetY(0.0);
    setDoorOffsetZ(0.0);
    setDoorRotationY(0);
    setShowLeftDoor(true);
    setShowUpperDoor(false);
    playTactileSfx('click');
  }, [playTactileSfx]);

  // Toggle individual doors (Left_Door and Upper_Door)
  const toggleLeftDoor = useCallback(() => {
    setShowLeftDoor(prev => {
      const next = !prev;
      getItem<StoredEnvironmentGLBConfig>(STORAGE_KEY_DOOR_GLB).then(stored => {
        if (stored) setItem(STORAGE_KEY_DOOR_GLB, { ...stored, showLeftDoor: next });
      }).catch(err => console.warn(err));
      return next;
    });
    playTactileSfx('click');
  }, [playTactileSfx]);

  const toggleUpperDoor = useCallback(() => {
    setShowUpperDoor(prev => {
      const next = !prev;
      getItem<StoredEnvironmentGLBConfig>(STORAGE_KEY_DOOR_GLB).then(stored => {
        if (stored) setItem(STORAGE_KEY_DOOR_GLB, { ...stored, showUpperDoor: next });
      }).catch(err => console.warn(err));
      return next;
    });
    playTactileSfx('click');
  }, [playTactileSfx]);

  // Apply real-time Model Adjustments (Scale, Offset Y, Rotation Y)
  useEffect(() => {
    if (!customModelInnerRef.current) return;
    const baseScale = useRawCharacterScale ? 1.0 : (1.85 / (characterNaturalHeightRef.current || 1.85));
    customModelInnerRef.current.scale.setScalar(baseScale * modelScale);
    customModelInnerRef.current.position.y = modelOffsetY;
    customModelInnerRef.current.rotation.y = (modelRotationY * Math.PI) / 180;
  }, [modelScale, modelOffsetY, modelRotationY, useRawCharacterScale]);

  // Synchronize Floor transform in real time
  useEffect(() => {
    if (!customFloorGroupRef.current) return;
    customFloorGroupRef.current.position.set(floorOffsetX, floorOffsetY, floorOffsetZ);
    customFloorGroupRef.current.rotation.y = (floorRotationY * Math.PI) / 180;
    customFloorGroupRef.current.scale.setScalar(floorScale);
  }, [floorOffsetX, floorOffsetY, floorOffsetZ, floorRotationY, floorScale]);

  // Synchronize Wall transform in real time
  useEffect(() => {
    if (!customWallGroupRef.current) return;
    customWallGroupRef.current.position.set(wallOffsetX, wallOffsetY, wallOffsetZ);
    customWallGroupRef.current.rotation.y = (wallRotationY * Math.PI) / 180;
    customWallGroupRef.current.scale.setScalar(wallScale);
  }, [wallOffsetX, wallOffsetY, wallOffsetZ, wallRotationY, wallScale]);

  // Re-build wall instances if showLeftWall or showUpperWall changes
  useEffect(() => {
    if (!wallGltfSceneRef.current || !customWallLoaded) return;
    mountWallGLBRef.current({ scene: wallGltfSceneRef.current });
  }, [showLeftWall, showUpperWall, customWallLoaded]);

  // Synchronize Door transform in real time
  useEffect(() => {
    if (!customDoorGroupRef.current) return;
    customDoorGroupRef.current.position.set(doorOffsetX, doorOffsetY, doorOffsetZ);
    customDoorGroupRef.current.rotation.y = (doorRotationY * Math.PI) / 180;
    customDoorGroupRef.current.scale.setScalar(doorScale);
  }, [doorOffsetX, doorOffsetY, doorOffsetZ, doorRotationY, doorScale]);

  // Re-build door instances if showLeftDoor or showUpperDoor changes
  useEffect(() => {
    if (!doorGltfSceneRef.current || !customDoorLoaded) return;
    mountDoorGLBRef.current({ scene: doorGltfSceneRef.current });
  }, [showLeftDoor, showUpperDoor, customDoorLoaded]);

  // Dynamic Tile Position Helper: sub-tile indices on the chunk grid (one chunk = 3x3 tiles of 8/3m)
  const getTileWorldPos = useCallback((col: number, row: number) => {
    const sY = customFloorLoadedRef.current ? (0.25 + floorOffsetYRef.current) : 0.05;
    return new THREE.Vector3(col * BLENDER_TILE_SIZE, sY, row * BLENDER_TILE_SIZE);
  }, []);

  const getTileWorldPosRef = useRef(getTileWorldPos);
  useEffect(() => {
    getTileWorldPosRef.current = getTileWorldPos;
  }, [getTileWorldPos]);

  // Synchronize clickable floor tiles (dynamic set across all floor chunks)
  useEffect(() => {
    const tSize = BLENDER_TILE_SIZE;
    const sY = customFloorLoaded ? (0.25 + floorOffsetY) : 0.05;

    tileMeshesRef.current.forEach((tMesh) => {
      tMesh.position.set(tMesh.userData.col * tSize, sY + 0.015, tMesh.userData.row * tSize);
    });

    // If standing still, update character Y position so it rests flush on the floor surface
    if (characterRootRef.current && targetWorldPosRef.current === null) {
      const pos = getTileWorldPos(currentTileRef.current.col, currentTileRef.current.row);
      characterPosRef.current.set(pos.x, sY, pos.z);
      characterRootRef.current.position.set(pos.x, sY, pos.z);
    }
  }, [customFloorLoaded, floorOffsetY, getTileWorldPos]);

  // Compute direction angle (in radians) between 2 tiles
  const getCardinalAngle = (from: TileCoord, to: TileCoord): { angle: number; dir: Direction } => {
    const dCol = to.col - from.col;
    const dRow = to.row - from.row;

    if (dRow < 0) {
      return { angle: Math.PI, dir: 'NORTH' };
    } else if (dRow > 0) {
      return { angle: 0, dir: 'SOUTH' };
    } else if (dCol > 0) {
      return { angle: Math.PI / 2, dir: 'EAST' };
    } else {
      return { angle: -Math.PI / 2, dir: 'WEST' };
    }
  };

  // Plan path with BFS across all walkable dungeon tiles (chunk-safe, avoids holes)
  const planPath = (start: TileCoord, end: TileCoord): TileCoord[] => {
    const walkable = walkableKeysRef.current;
    const tileKey = (c: number, r: number) => `${c},${r}`;
    const startKey = tileKey(start.col, start.row);
    const endKey = tileKey(end.col, end.row);

    if (startKey === endKey) return [];
    if (!walkable.has(endKey)) return [];

    const visited = new Set([startKey]);
    const prevMap = new Map<string, string>();
    const queue: TileCoord[] = [start];
    let head = 0;
    let found = false;

    while (head < queue.length && !found) {
      const cur = queue[head++];
      for (const nxt of [
        { col: cur.col + 1, row: cur.row },
        { col: cur.col - 1, row: cur.row },
        { col: cur.col, row: cur.row + 1 },
        { col: cur.col, row: cur.row - 1 }
      ]) {
        const k = tileKey(nxt.col, nxt.row);
        if (visited.has(k)) continue;
        visited.add(k);
        prevMap.set(k, tileKey(cur.col, cur.row));
        if (k === endKey) { found = true; break; }
        if (walkable.has(k)) queue.push(nxt);
      }
    }

    if (!visited.has(endKey)) return [];

    const path: TileCoord[] = [];
    let k = endKey;
    while (k !== startKey) {
      const [c, r] = k.split(',').map(Number);
      path.push({ col: c, row: r });
      k = prevMap.get(k)!;
    }
    path.reverse();
    return path;
  };

  // Handle Tile Click: BFS path over the whole dungeon, run anim, step-by-step movement
  const handleTileClick = useCallback((targetCol: number, targetRow: number) => {
    // Any new tile walk drops a pending door traversal
    pendingPortalTileRef.current = null;
    const current = currentTileRef.current;
    if (current.col === targetCol && current.row === targetRow) {
      return;
    }

    if (!walkableKeysRef.current.has(`${targetCol},${targetRow}`)) {
      playTactileSfx('hover');
      return;
    }

    const waypoints = planPath(current, { col: targetCol, row: targetRow });
    if (waypoints.length === 0) {
      playTactileSfx('hover');
      return;
    }

    moveQueueRef.current = waypoints;
    const firstStep = waypoints[0];
    const { angle, dir } = getCardinalAngle(current, firstStep);

    targetFacingAngleRef.current = angle;
    currentFacingAngleRef.current = angle;
    if (characterRootRef.current) {
      characterRootRef.current.rotation.y = angle;
    }

    setFacingDir(dir);
    setAnimState('RUN');
    updateMovementAnimation(true);

    targetWorldPosRef.current = getTileWorldPos(firstStep.col, firstStep.row);
  }, [playTactileSfx, updateMovementAnimation, getTileWorldPos]);

  // -----------------------------------------------------------------------
  // Dungeon sections: click-to-walk on a door then section change on arrival
  // -----------------------------------------------------------------------

  // Walk to a door with the mouse. Returns true when a path was found; on
  // arrival the paired section is entered (movement engine calls doorArrivalRef)
  const beginDoorWalk = useCallback((door: PlacedChunkInstance): boolean => {
    const tile = doorApproachTile(door);
    const queueBefore = moveQueueRef.current.length;
    handleTileClickRef.current(tile.col, tile.row);
    if (moveQueueRef.current.length === queueBefore) {
      // No path found (e.g. missing floor) — the walk was not possible
      pendingPortalTileRef.current = null;
      return false;
    }
    pendingPortalTileRef.current = { col: tile.col, row: tile.row, doorId: door.id };
    playTactileSfx('click');
    return true;
  }, [playTactileSfx]);
  useEffect(() => {
    beginDoorWalkRef.current = beginDoorWalk;
  }, [beginDoorWalk]);

  // Spawn into the section the paired door leads to, standing with the back
  // towards that door (facing away from it into the room)
  const transitionThroughDoor = useCallback((doorId: string) => {
    const door = placedChunksRef.current.find(p => p.id === doorId);
    if (!door) return;
    const partner = door.portalId
      ? placedChunksRef.current.find(p => p.id === door.portalId)
      : undefined;
    if (!partner) {
      // Decorative door without a pair: just stop in front of it
      playTactileSfx('hover');
      showPortalHint('Diese Tür führt nirgendwohin. Verbinde sie über „Türen verbinden" mit einer Partner-Tür in einem anderen Abschnitt.');
      return;
    }
    focusSectionRef.current(partner.sectionId ?? 'root', partner);
    playTactileSfx('success');
  }, [playTactileSfx, showPortalHint]);
  useEffect(() => {
    doorArrivalRef.current = transitionThroughDoor;
  }, [transitionThroughDoor]);

  // Reset character to [0,0] Center Tile
  const resetToCenter = useCallback(() => {
    moveQueueRef.current = [];
    currentTileRef.current = { col: 0, row: 0 };
    targetWorldPosRef.current = null;
    const centerPos = getTileWorldPos(0, 0);
    characterPosRef.current.copy(centerPos);
    targetFacingAngleRef.current = 0;
    currentFacingAngleRef.current = 0;

    if (characterRootRef.current) {
      characterRootRef.current.position.copy(centerPos);
      characterRootRef.current.rotation.y = 0;
    }

    setCharacterCoord({ col: 0, row: 0 });
    setFacingDir('SOUTH');
    setAnimState('IDLE');
    updateMovementAnimation(false);
    playTactileSfx('click');
  }, [playTactileSfx, updateMovementAnimation, getTileWorldPos]);

  const handleTileClickRef = useRef(handleTileClick);
  useEffect(() => {
    handleTileClickRef.current = handleTileClick;
  }, [handleTileClick]);

  const mountGLBModelRef = useRef(mountGLBModel);
  useEffect(() => {
    mountGLBModelRef.current = mountGLBModel;
  }, [mountGLBModel]);

  const updateCharacterPoseRef = useRef(updateCharacterPose);
  useEffect(() => {
    updateCharacterPoseRef.current = updateCharacterPose;
  }, [updateCharacterPose]);

  // =========================================================================
  // INITIAL MOUNT & THREE.JS SETUP
  // =========================================================================
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x18181b);
    sceneRef.current = scene;

    // 2. Camera: Fixed Isometric Orthographic Camera at 45° tilt (mouse wheel zooms)
    let frustumSize = 11.2;
    const aspect = container.clientWidth / container.clientHeight;
    const camera = new THREE.OrthographicCamera(
      (-frustumSize * aspect) / 2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      1000
    );

    const camDist = 24;
    camera.position.set(-camDist, camDist * 1.15, camDist);
    // Shared look-at target (component ref: section teleports can recenter it)
    const camTarget = camTargetRef.current ?? new THREE.Vector3(0, 0.45, 0);
    camTargetRef.current = camTarget;
    camTarget.set(0, 0.45, 0);
    camera.lookAt(camTarget);
    cameraRef.current = camera;

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Soft Studio Lighting (Diffuse Ambient + Directional Key)
    const hemiLight = new THREE.HemisphereLight(0xfff6ea, 0x475569, 1.1);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(-15, 25, 15);
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.4);
    fillLight.position.set(15, 10, -15);
    scene.add(fillLight);

    // 5. Custom chunk groups (prefab diorama removed - dungeon is built from GLB chunks)
    const customFloorGroup = new THREE.Group();
    customFloorGroup.name = 'CustomFloorGroup';
    scene.add(customFloorGroup);
    customFloorGroupRef.current = customFloorGroup;

    // Custom 3D Wall Group (for user Blender 8m GLB, Left & Upper)
    const customWallGroup = new THREE.Group();
    customWallGroup.name = 'CustomWallGroup';
    scene.add(customWallGroup);
    customWallGroupRef.current = customWallGroup;

    // Custom 3D Door Group (for user Blender Door GLB, Left & Upper)
    const customDoorGroup = new THREE.Group();
    customDoorGroup.name = 'CustomDoorGroup';
    scene.add(customDoorGroup);
    customDoorGroupRef.current = customDoorGroup;

    // Placed chunk copies group (multi-placement grid building)
    const placedChunksGroup = new THREE.Group();
    placedChunksGroup.name = 'PlacedChunksGroup';
    scene.add(placedChunksGroup);
    placedChunksGroupRef.current = placedChunksGroup;

    // Placed NPC/enemy characters (stand idle on walkable sub-tiles)
    const placedNpcsGroup = new THREE.Group();
    placedNpcsGroup.name = 'PlacedNpcGroup';
    scene.add(placedNpcsGroup);
    placedNpcsGroupRef.current = placedNpcsGroup;

    // Soft glow shells around doors while linking (only the active section)
    const doorGlowGroup = new THREE.Group();
    doorGlowGroup.name = 'DoorLinkGlows';
    doorGlowGroup.visible = false;
    scene.add(doorGlowGroup);

    // Placement ghost group: translucent model copy + colored footprint (blue=free, red=occupied)
    const ghostGroup = new THREE.Group();
    ghostGroup.name = 'PlacementGhostGroup';
    ghostGroup.visible = false;
    scene.add(ghostGroup);
    ghostGroupRef.current = ghostGroup;

    const ghostFootprintMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.25,
      depthWrite: false
    });
    ghostFootprintMatRef.current = ghostFootprintMat;
    const ghostFootprint = new THREE.Mesh(
      new THREE.PlaneGeometry(CHUNK_CELL - 0.12, CHUNK_CELL - 0.12),
      ghostFootprintMat
    );
    ghostFootprint.rotation.x = -Math.PI / 2;
    ghostFootprint.position.y = 0.27;
    ghostGroup.add(ghostFootprint);

    const ghostBorderMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.65,
      depthWrite: false
    });
    ghostBorderMatRef.current = ghostBorderMat;
    const ghostBorder = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(CHUNK_CELL, CHUNK_CELL)),
      ghostBorderMat
    );
    ghostBorder.rotation.x = -Math.PI / 2;
    ghostBorder.position.y = 0.275;
    ghostGroup.add(ghostBorder);

    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.38,
      depthWrite: false
    });
    ghostMatRef.current = ghostMat;

    const ghostModelHolder = new THREE.Group();
    ghostModelHolder.name = 'GhostModelHolder';
    ghostGroup.add(ghostModelHolder);
    ghostModelHolderRef.current = ghostModelHolder;

    // 6. Clickable Floor Tile Grid (built dynamically across all placed floor chunks)
    tileMeshesRef.current = [];
    const tilesGroup = new THREE.Group();
    tilesGroup.name = 'TileGridGroup';
    scene.add(tilesGroup);

    const tileMeshMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.0,
      depthWrite: false
    });

    // 7. Dynamic Hover Indicator: Transparent Light-Blue Surface (2.67m x 2.67m tile)
    const hoverGroup = new THREE.Group();
    hoverGroup.visible = false;
    hoverIndicatorRef.current = hoverGroup;

    // Tile Wash Plane: 8/3m sub-tile with small margin
    const tileWashGeo = new THREE.PlaneGeometry(BLENDER_TILE_SIZE - 0.06, BLENDER_TILE_SIZE - 0.06);
    const tileWashMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.16,
      depthWrite: false
    });
    const tileWash = new THREE.Mesh(tileWashGeo, tileWashMat);
    tileWash.rotation.x = -Math.PI / 2;
    hoverGroup.add(tileWash);

    hoverGroup.position.y = 0.035;
    scene.add(hoverGroup);


    // Check IndexedDB for previously stored custom Character GLB
    const initCharacter = async () => {
      try {
        const storedGLB = await getItem<StoredGLBConfig>(STORAGE_KEY_CHAR_GLB);
        if (storedGLB?.dataBase64) {
          const buffer = dataUrlToArrayBuffer(storedGLB.dataBase64);
          const loader = new GLTFLoader();
          loader.parse(buffer, '', (gltf) => {
            setCustomModelName(storedGLB.fileName || 'custom_model.glb');
            setCustomModelSize(storedGLB.fileSize || 0);
            if (storedGLB.scale !== undefined) setModelScale(storedGLB.scale);
            if (storedGLB.useRawScale !== undefined) setUseRawCharacterScale(storedGLB.useRawScale);
            if (storedGLB.offsetY !== undefined) setModelOffsetY(storedGLB.offsetY);
            if (storedGLB.rotationY !== undefined) setModelRotationY(storedGLB.rotationY);

            mountGLBModelRef.current(gltf, storedGLB);
          });
          return;
        }
      } catch (err) {
        console.warn("Failed to restore stored GLB:", err);
      }

      // Fallback: Mount default Anime Knight Dummy
      const dummy = createAnimeKnightDummy();
      dummy.position.set(0, 0.05, 0);
      dummy.rotation.y = 0;
      scene.add(dummy);
      characterRootRef.current = dummy;
    };

    // Check IndexedDB for previously stored Floor and Wall GLB
    const initEnvironment = async () => {
      // 1. Restore Custom Floor (8m x 8m)
      try {
        const storedFloor = await getItem<StoredEnvironmentGLBConfig>(STORAGE_KEY_FLOOR_GLB);
        if (storedFloor?.dataBase64) {
          const buffer = dataUrlToArrayBuffer(storedFloor.dataBase64);
          new GLTFLoader().parse(buffer, '', (gltf) => {
            setCustomFloorName(storedFloor.fileName || 'custom_floor.glb');
            setCustomFloorSize(storedFloor.fileSize || 0);
            if (storedFloor.offsetX !== undefined) setFloorOffsetX(storedFloor.offsetX);
            if (storedFloor.offsetY !== undefined) setFloorOffsetY(storedFloor.offsetY);
            if (storedFloor.offsetZ !== undefined) setFloorOffsetZ(storedFloor.offsetZ);
            if (storedFloor.rotationY !== undefined) setFloorRotationY(storedFloor.rotationY);
            if (storedFloor.scale !== undefined) setFloorScale(storedFloor.scale);
            mountFloorGLBRef.current(gltf, storedFloor);
          });
        }
      } catch (err) {
        console.warn("Failed to restore custom floor:", err);
      }

      // 2. Restore Custom Wall (8m, North & East)
      try {
        const storedWall = await getItem<StoredEnvironmentGLBConfig>(STORAGE_KEY_WALL_GLB);
        if (storedWall?.dataBase64) {
          const buffer = dataUrlToArrayBuffer(storedWall.dataBase64);
          new GLTFLoader().parse(buffer, '', (gltf) => {
            setCustomWallName(storedWall.fileName || 'custom_wall.glb');
            setCustomWallSize(storedWall.fileSize || 0);
            if (storedWall.offsetX !== undefined) setWallOffsetX(storedWall.offsetX);
            if (storedWall.offsetY !== undefined) setWallOffsetY(storedWall.offsetY);
            if (storedWall.offsetZ !== undefined) setWallOffsetZ(storedWall.offsetZ);
            if (storedWall.rotationY !== undefined) setWallRotationY(storedWall.rotationY);
            if (storedWall.scale !== undefined) setWallScale(storedWall.scale);
            if (storedWall.showLeftWall !== undefined) setShowLeftWall(storedWall.showLeftWall);
            if (storedWall.showUpperWall !== undefined) setShowUpperWall(storedWall.showUpperWall);
            mountWallGLBRef.current(gltf, storedWall);
          });
        }
      } catch (err) {
        console.warn("Failed to restore custom wall:", err);
      }

      // 3. Restore Custom Door (center of left wall, upper wall)
      try {
        const storedDoor = await getItem<StoredEnvironmentGLBConfig>(STORAGE_KEY_DOOR_GLB);
        if (storedDoor?.dataBase64) {
          const buffer = dataUrlToArrayBuffer(storedDoor.dataBase64);
          new GLTFLoader().parse(buffer, '', (gltf) => {
            setCustomDoorName(storedDoor.fileName || 'custom_door.glb');
            setCustomDoorSize(storedDoor.fileSize || 0);
            if (storedDoor.offsetX !== undefined) setDoorOffsetX(storedDoor.offsetX);
            if (storedDoor.offsetY !== undefined) setDoorOffsetY(storedDoor.offsetY);
            if (storedDoor.offsetZ !== undefined) setDoorOffsetZ(storedDoor.offsetZ);
            if (storedDoor.rotationY !== undefined) setDoorRotationY(storedDoor.rotationY);
            if (storedDoor.scale !== undefined) setDoorScale(storedDoor.scale);
            if (storedDoor.showLeftDoor !== undefined) setShowLeftDoor(storedDoor.showLeftDoor);
            if (storedDoor.showUpperDoor !== undefined) setShowUpperDoor(storedDoor.showUpperDoor);
            mountDoorGLBRef.current(gltf, storedDoor);
          });
        }
      } catch (err) {
        console.warn("Failed to restore custom door:", err);
      }

      // 4. Restore chunk library and all previously placed grid copies
      try {
        const [storedLibrary, storedPlaced, storedSections] = await Promise.all([
          getItem<ChunkLibraryEntry[]>(CHUNK_LIBRARY_KEY),
          getItem<PlacedChunkInstance[]>(CHUNK_PLACEMENTS_KEY),
          getItem<SectionInfo[]>(CHUNK_SECTIONS_KEY)
        ]);

        // Custom sections (the root section always exists)
        if (Array.isArray(storedSections)) {
          const merged = [
            { id: 'root', name: 'Abschnitt 1' },
            ...storedSections.filter(s => s.id !== 'root')
          ];
          setSections(merged);
          sectionsRef.current = merged;
        }

        if (Array.isArray(storedLibrary) && storedLibrary.length > 0) {
          chunkLibraryRef.current = storedLibrary;
          setChunkLibrary(storedLibrary);
        }

        if (Array.isArray(storedPlaced) && storedPlaced.length > 0) {
          for (const inst of storedPlaced) {
            const entry = storedLibrary?.find(e => e.id === inst.libraryId);
            if (!entry) continue;
            const buffer = dataUrlToArrayBuffer(entry.dataBase64);
            await new Promise<void>((resolve) => {
              new GLTFLoader().parse(buffer, '', (gltf) => {
                placeChunkInstance(inst, gltf.scene);
                resolve();
              }, () => resolve());
            });
          }
          placedChunksRef.current = storedPlaced;
          setPlacedChunks(storedPlaced);
          // Rebuild the walkable grid including all restored floor copies
          refreshWalkableTilesRef.current?.({ baseFloor: true, section: 'root' });
        }
      } catch (err) {
        console.warn('Failed to restore placed chunks:', err);
      }

      // 5. Restore the NPC/enemy library and all placed characters
      try {
        const [storedNpcLibrary, storedNpcPlaced] = await Promise.all([
          getItem<NpcLibraryEntry[]>(NPC_LIBRARY_KEY),
          getItem<PlacedNpcInstance[]>(NPC_PLACEMENTS_KEY)
        ]);

        if (Array.isArray(storedNpcLibrary) && storedNpcLibrary.length > 0) {
          npcLibraryRef.current = storedNpcLibrary;
          setNpcLibrary(storedNpcLibrary);
        }

        if (Array.isArray(storedNpcPlaced) && storedNpcPlaced.length > 0) {
          for (const inst of storedNpcPlaced) {
            const entry = storedNpcLibrary?.find(e => e.id === inst.libraryId);
            if (!entry) continue;
            const buffer = dataUrlToArrayBuffer(entry.dataBase64);
            await new Promise<void>((resolve) => {
              new GLTFLoader().parse(buffer, '', (gltf) => {
                mountNpcInstance(inst, { scene: gltf.scene, animations: gltf.animations || [] });
                resolve();
              }, () => resolve());
            });
          }
          placedNpcsRef.current = storedNpcPlaced;
          setPlacedNpcs(storedNpcPlaced);
        }
      } catch (err) {
        console.warn('Failed to restore placed characters:', err);
      }
    };

    initCharacter();
    initEnvironment();

    // Raycaster for Tile Hover and Click
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    // -----------------------------------------------------------------------
    // Placement Mode logic (ghost preview, grid snapping, occupancy check)
    // -----------------------------------------------------------------------
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.25);
    const rayHitVec = new THREE.Vector3();
    let lastGhostCell: { x: number; z: number } | null = null;
    let lastGhostValid = false;

    const getPickPlaneY = () => (customFloorLoadedRef.current ? 0.25 + floorOffsetYRef.current : 0.05);

    // Orientation of a barrier (wall/door) in mod-180: 0/180 -> lane 0, 90/270 -> lane 90
    const orientOf = (rotY: number): number => ((Math.round(rotY) % 180) + 180) % 180;

    // Section of a placement ('root' when unset)
    const sectOf = (p: PlacedChunkInstance): string => p.sectionId ?? 'root';

    // Lanes of one barrier type per cell within the ACTIVE section: walls never
    // block doors and vice versa (doors overlap walls). Only same-type
    // same-lane conflicts.
    const isBarrierLaneFree = (t: 'wall' | 'door', lane: 0 | 90, cx: number, cz: number): boolean => {
      const empty = placedChunksRef.current.every(
        p => !(p.type === t && sectOf(p) === activeSectionRef.current && p.cellX === cx && p.cellZ === cz && orientOf(p.rotationY) === lane)
      );
      if (!empty) return false;
      // Base chunk instances at origin block their lane for the same type
      if (activeSectionRef.current === 'root' && cx === 0 && cz === 0) {
        if (t === 'wall') {
          if (lane === 0 && baseWallFlagsRef.current.left) return false;
          if (lane === 90 && baseWallFlagsRef.current.upper) return false;
        } else {
          if (lane === 0 && baseDoorFlagsRef.current.left) return false;
          if (lane === 90 && baseDoorFlagsRef.current.upper) return false;
        }
      }
      return true;
    };

    // Floors: one per cell (per section). Walls/doors: free when no same-type
    // chunk of the active section uses the lane
    const isCellOccupied = (t: ChunkType, cx: number, cz: number, rotY: number): boolean => {
      if (t === 'floor') {
        if (placedChunksRef.current.some(p => p.type === 'floor' && sectOf(p) === activeSectionRef.current && p.cellX === cx && p.cellZ === cz)) return true;
        if (activeSectionRef.current === 'root' && cx === 0 && cz === 0) return customFloorLoadedRef.current;
        return false;
      }
      return !isBarrierLaneFree(t, orientOf(rotY) as 0 | 90, cx, cz);
    };

    // free cells are only valid if adjacent (8-way) to any chunk of the same section
    const hasNeighborChunk = (cx: number, cz: number): boolean => {
      for (const p of placedChunksRef.current) {
        if (sectOf(p) !== activeSectionRef.current) continue;
        if (Math.abs(p.cellX - cx) <= 1 && Math.abs(p.cellZ - cz) <= 1) return true;
      }
      return activeSectionRef.current === 'root' && hasBaseAnchor() && Math.abs(cx) <= 1 && Math.abs(cz) <= 1;
    };

    // Any base chunk at origin anchors the building grid
    const hasBaseAnchor = (): boolean =>
      customFloorLoadedRef.current ||
      baseWallFlagsRef.current.left || baseWallFlagsRef.current.upper ||
      baseDoorFlagsRef.current.left || baseDoorFlagsRef.current.upper;

    // One character per walkable sub-tile of the active section; the player
    // character itself also blocks its tile
    const isNpcCellFree = (col: number, row: number): boolean => {
      if (!walkableKeysRef.current.has(`${col},${row}`)) return false;
      if (placedNpcsRef.current.some(n => (n.sectionId ?? 'root') === activeSectionRef.current && n.col === col && n.row === row)) return false;
      const pt = currentTileRef.current;
      if (pt && pt.col === col && pt.row === row) return false;
      return true;
    };

    const canPlaceAt = (t: PlacementType, cx: number, cz: number, rotY: number): boolean => {
      if (t === 'npc' || t === 'enemy') return isNpcCellFree(cx, cz);
      const sectionEmpty = !placedChunksRef.current.some(p => sectOf(p) === activeSectionRef.current);
      const noAnchor = activeSectionRef.current !== 'root' || !hasBaseAnchor();
      return !isCellOccupied(t, cx, cz, rotY) &&
        ((sectionEmpty && noAnchor) || hasNeighborChunk(cx, cz));
    };

    // -----------------------------------------------------------------------
    // Walkable dungeon tiles: every floor chunk (base + copies of the active
    // section) builds a 3x3 sub-tile grid the character can move on.
    // -----------------------------------------------------------------------
    const refreshWalkableTiles = (opts?: { baseFloor?: boolean; section?: string }) => {
      const section = opts?.section ?? activeSectionRef.current;
      const baseActive = opts?.baseFloor ?? customFloorLoadedRef.current;
      const keys = new Set<string>();
      // The base chunks (floor/wall/door) permanently belong to the root section
      if (section === 'root' && baseActive) {
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) keys.add(`${i},${j}`);
      }
      for (const p of placedChunksRef.current) {
        if (p.type !== 'floor') continue;
        if ((p.sectionId ?? 'root') !== section) continue;
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) keys.add(`${p.cellX * 3 + i},${p.cellZ * 3 + j}`);
      }
      // The character always has a home tile, even with no chunks built yet
      if (keys.size === 0) keys.add('0,0');

      walkableKeysRef.current = keys;

      const tSize = BLENDER_TILE_SIZE;
      const sY = baseActive ? (0.25 + floorOffsetYRef.current) : 0.05;

      for (const oldMesh of tileMeshesRef.current) {
        oldMesh.geometry.dispose();
        tilesGroup.remove(oldMesh);
      }
      tileMeshesRef.current = [];
      for (const key of keys) {
        const [c, r] = key.split(',').map(Number);
        const tMesh = new THREE.Mesh(new THREE.PlaneGeometry(tSize - 0.06, tSize - 0.06), tileMeshMat);
        tMesh.rotation.x = -Math.PI / 2;
        tMesh.position.set(c * tSize, sY + 0.015, r * tSize);
        tMesh.userData = { col: c, row: r };
        tilesGroup.add(tMesh);
        tileMeshesRef.current.push(tMesh);
      }
    };
    refreshWalkableTilesRef.current = refreshWalkableTiles;
    refreshWalkableTiles();

    // Repaint ghost colors for the currently snapped cell (after rotation or placement)
    const repaintGhost = () => {
      const placement = placementSceneRef.current;
      if (!placement || !lastGhostCell) return;
      lastGhostValid = canPlaceAt(placement.type, lastGhostCell.x, lastGhostCell.z, ghostRotationRef.current);
      const ghostColor = lastGhostValid ? 0x38bdf8 : 0xef4444;
      ghostMat.color.setHex(ghostColor);
      ghostFootprintMat.color.setHex(ghostColor);
      ghostBorderMat.color.setHex(ghostColor);
    };

    // Mount one placed chunk copy at its grid cell
    const placeChunkInstance = (inst: PlacedChunkInstance, gltfScene: THREE.Group) => {
      const holder = new THREE.Group();
      holder.name = `Placed_${inst.type}_${inst.id}`;
      const model = gltfScene.clone(true);
      prepareChunkModel(model);
      holder.add(model);
      holder.position.set(inst.cellX * CHUNK_CELL, 0, inst.cellZ * CHUNK_CELL);
      holder.rotation.y = (inst.rotationY * Math.PI) / 180;
      holder.userData = { instanceId: inst.id, libraryId: inst.libraryId, type: inst.type, sectionId: inst.sectionId ?? 'root' };
      // Chunks of non-active dungeon sections stay loaded but hidden
      holder.visible = (inst.sectionId ?? 'root') === activeSectionRef.current;
      placedChunksGroup.add(holder);
      return holder;
    };

    // Remove scene children whose instance id is no longer in the list
    const syncPlacedGroup = (list: PlacedChunkInstance[]) => {
      const keep = new Set(list.map(i => i.id));
      for (let i = placedChunksGroup.children.length - 1; i >= 0; i--) {
        const child = placedChunksGroup.children[i] as THREE.Group;
        if (!keep.has(child.userData?.instanceId)) {
          placedChunksGroup.remove(child);
        }
      }
    };
    syncPlacedGroupRef.current = syncPlacedGroup;

    // -----------------------------------------------------------------------
    // Placed NPC & enemy characters (idle figures on walkable sub-tiles)
    // -----------------------------------------------------------------------

    // Mount one NPC/enemy GLB on a sub-tile of the dungeon (idle animation)
    const mountNpcInstance = (inst: PlacedNpcInstance, gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }) => {
      const holder = new THREE.Group();
      holder.name = `PlacedNpc_${inst.id}`;
      // Clone via SkeletonUtils: AnimationMixer works on skinned clones too
      const model = cloneSkeleton(gltf.scene) as THREE.Group;
      // Same material fix-up as the player character
      model.traverse((child: any) => {
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = false;
          child.frustumCulled = false;
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m: any) => {
            if (m) {
              if ('roughness' in m) m.roughness = 0.85;
              if ('metalness' in m) m.metalness = 0.05;
              if (m.map) {
                m.map.colorSpace = THREE.SRGBColorSpace;
                m.map.needsUpdate = true;
              }
            }
          });
        }
      });
      // Bottom-center pivot + approx. player height (1.85m), like the dummy
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const baseScale = size.y > 0.001 ? 1.85 / size.y : 1.0;
      model.position.set(-center.x, -box.min.y, -center.z);
      const inner = new THREE.Group();
      inner.name = 'NpcInnerAdjuster';
      inner.add(model);
      inner.scale.setScalar(baseScale);
      holder.add(inner);

      const surfaceY = getPickPlaneY();
      holder.position.set(inst.col * BLENDER_TILE_SIZE, 0, inst.row * BLENDER_TILE_SIZE);

      // Small grounded shadow disc (same style as the player character)
      const shadowMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.8),
        new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.4, depthWrite: false })
      );
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.y = surfaceY + 0.02;
      holder.add(shadowMesh);
      // Lift the model to the floor surface height
      inner.position.y = surfaceY;

      holder.rotation.y = (inst.rotationY * Math.PI) / 180;
      holder.visible = (inst.sectionId ?? 'root') === activeSectionRef.current;
      holder.userData = {
        npcId: inst.id,
        libraryId: inst.libraryId,
        npcKind: inst.kind,
        sectionId: inst.sectionId ?? 'root'
      };
      placedNpcsGroup.add(holder);

      // Start the idle animation of this character
      const idleClip = gltf.animations.find(c => /idle|stand|wait|pose/i.test(c.name)) || gltf.animations[0];
      if (idleClip) {
        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(idleClip).play();
        npcMixersRef.current = [
          ...npcMixersRef.current.filter(x => x.id !== inst.id),
          { id: inst.id, mixer }
        ];
      }
      return holder;
    };

    // Remove scene children whose npc id is no longer in the list
    const syncNpcGroup = (list: PlacedNpcInstance[]) => {
      const keep = new Set(list.map(i => i.id));
      for (let i = placedNpcsGroup.children.length - 1; i >= 0; i--) {
        const child = placedNpcsGroup.children[i] as THREE.Group;
        if (!keep.has(child.userData?.npcId)) {
          placedNpcsGroup.remove(child);
        }
      }
      // Stop updating mixers of removed instances
      npcMixersRef.current = npcMixersRef.current.filter(x => keep.has(x.id));
    };
    syncNpcGroupRef.current = syncNpcGroup;

    // Delete one placed character immediately (used by the Remove mode)
    const deletePlacedNpc = (inst: PlacedNpcInstance) => {
      const next = placedNpcsRef.current.filter(p => p.id !== inst.id);
      placedNpcsRef.current = next;
      setPlacedNpcs(next);
      syncNpcGroup(next);
      setItem(NPC_PLACEMENTS_KEY, next).catch(err => console.warn('npc placement save failed:', err));
      playTactileSfx('click');
    };

    // Raycast against placed characters, resolves the owning instance
    const findPlacedNpcAtEvent = (e: MouseEvent): { inst: PlacedNpcInstance } | null => {
      if (placedNpcsRef.current.length === 0) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(placedNpcsGroup.children, true);
      for (const h of hits) {
        let obj: THREE.Object3D | null = h.object;
        while (obj && !obj.userData?.npcId) obj = obj.parent;
        if (!obj) continue;
        const inst = placedNpcsRef.current.find(p => p.id === obj!.userData.npcId);
        if (inst) return { inst };
      }
      return null;
    };

    // -----------------------------------------------------------------------
    // Edit modes for placed chunks: pick up & move, or delete
    // -----------------------------------------------------------------------
    let moveSession: { inst: PlacedChunkInstance; gltfScene: THREE.Group } | null = null;
    // Carried placed character (same pattern as the chunk move session)
    let npcMoveSession: { inst: PlacedNpcInstance; gltfScene: THREE.Group; animations: THREE.AnimationClip[] } | null = null;

    // Puts a carried chunk back on its original cell (aborted move)
    const restoreMoveSession = () => {
      const src = moveSession;
      if (!src) return;
      moveSession = null;
      placeChunkInstance(src.inst, src.gltfScene);
      const back = [...placedChunksRef.current, src.inst];
      placedChunksRef.current = back;
      setPlacedChunks(back);
      if (src.inst.type === 'floor') refreshWalkableTiles();
    };

    // Puts a carried character back on its original tile (aborted move)
    const restoreNpcMoveSession = () => {
      const src = npcMoveSession;
      if (!src) return;
      npcMoveSession = null;
      mountNpcInstance(src.inst, { scene: src.gltfScene, animations: src.animations });
      const back = [...placedNpcsRef.current, src.inst];
      placedNpcsRef.current = back;
      setPlacedNpcs(back);
    };

    // Shared restore for every abort path (chunks AND characters)
    const restoreActiveMove = () => {
      restoreMoveSession();
      restoreNpcMoveSession();
    };
    restoreMoveRef.current = restoreActiveMove;

    // Raycast against placed chunk copies, resolves the owning instance
    const findPlacedChunkAtEvent = (e: MouseEvent): { inst: PlacedChunkInstance } | null => {
      if (placedChunksRef.current.length === 0) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(placedChunksGroup.children, true);
      for (const h of hits) {
        let obj: THREE.Object3D | null = h.object;
        while (obj && !obj.userData?.instanceId) obj = obj.parent;
        if (!obj) continue;
        const inst = placedChunksRef.current.find(p => p.id === obj!.userData.instanceId);
        if (inst) return { inst };
      }
      return null;
    };

    // Delete one placed chunk copy immediately
    const deletePlacedChunk = (inst: PlacedChunkInstance) => {
      // Free the partner of a linked portal door
      if (inst.portalId) {
        const partner = placedChunksRef.current.find(p => p.id === inst.portalId);
        if (partner) {
          partner.portalId = undefined;
          partner.pairColorIndex = undefined;
        }
      }
      const next = placedChunksRef.current.filter(p => p.id !== inst.id);
      placedChunksRef.current = next;
      setPlacedChunks(next);
      syncPlacedGroup(next);
      setItem(CHUNK_PLACEMENTS_KEY, next).catch(err => console.warn('placement save failed:', err));
      if (inst.type === 'floor') refreshWalkableTiles();
      refreshLinkHighlightsRef.current?.();
      playTactileSfx('click');
    };

    // Pick a placed chunk up: it follows the cursor as ghost until the next
    // click commits the new position. ESC / Right click restores the original.
    const startMoveSession = (inst: PlacedChunkInstance) => {
      const entry = chunkLibraryRef.current.find(el => el.id === inst.libraryId);
      if (!entry) return;
      setIsLoadingModel(true);
      setLoadingMessage(`Chunk wird aufgenommen: "${entry.fileName}"...`);
      try {
        const requestToken = ++placementRequestSeqRef.current;
        const buffer = dataUrlToArrayBuffer(entry.dataBase64);
        new GLTFLoader().parse(buffer, '', (gltf) => {
          // The user switched to something else while the file was parsing
          if (requestToken !== placementRequestSeqRef.current) {
            setIsLoadingModel(false);
            return;
          }
          setIsLoadingModel(false);
          restoreActiveMove(); // safety: never carry two things at once
          moveSession = { inst, gltfScene: gltf.scene };
          const next = placedChunksRef.current.filter(p => p.id !== inst.id);
          placedChunksRef.current = next;
          setPlacedChunks(next);
          syncPlacedGroup(next);
          // Removed floor extends/shortens the walkable grid at once
          if (inst.type === 'floor') refreshWalkableTiles();
          ghostRotationRef.current = inst.rotationY;
          placementSceneRef.current = { type: inst.type, libId: entry.id, gltfScene: gltf.scene };
          setPlacementMode({
            type: inst.type,
            libId: entry.id,
            fileName: entry.fileName,
            rotationY: inst.rotationY,
            moveInstanceId: inst.id
          });
          applyGhostRef.current?.();
          playTactileSfx('success');
        }, () => {
          console.error('Chunk GLTF parse error (move)');
          setIsLoadingModel(false);
        });
      } catch (err: any) {
        console.error('Chunk file read error (move):', err);
        setIsLoadingModel(false);
      }
    };

    // Pick a placed character up: it follows the cursor as ghost until the next
    // click commits the new tile. ESC / Right click restores the original tile.
    const startNpcMoveSession = (inst: PlacedNpcInstance) => {
      const entry = npcLibraryRef.current.find(el => el.id === inst.libraryId);
      if (!entry) return;
      setIsLoadingModel(true);
      setLoadingMessage(`Figur wird aufgenommen: "${entry.fileName}"...`);
      try {
        const requestToken = ++placementRequestSeqRef.current;
        const buffer = dataUrlToArrayBuffer(entry.dataBase64);
        new GLTFLoader().parse(buffer, '', (gltf) => {
          // The user switched to something else while the file was parsing
          if (requestToken !== placementRequestSeqRef.current) {
            setIsLoadingModel(false);
            return;
          }
          setIsLoadingModel(false);
          restoreActiveMove(); // safety: never carry two things at once
          npcMoveSession = { inst, gltfScene: gltf.scene, animations: gltf.animations || [] };
          const next = placedNpcsRef.current.filter(p => p.id !== inst.id);
          placedNpcsRef.current = next;
          setPlacedNpcs(next);
          syncNpcGroup(next);
          ghostRotationRef.current = inst.rotationY;
          placementSceneRef.current = {
            type: inst.kind,
            libId: entry.id,
            gltfScene: gltf.scene,
            animations: gltf.animations || [],
            moveNpcId: inst.id
          };
          setPlacementMode({
            type: inst.kind,
            libId: entry.id,
            fileName: entry.fileName,
            rotationY: inst.rotationY,
            moveNpcId: inst.id
          });
          applyGhostRef.current?.();
          playTactileSfx('success');
        }, () => {
          console.error('Character GLTF parse error (move)');
          setIsLoadingModel(false);
        });
      } catch (err: any) {
        console.error('Character file read error (move):', err);
        setIsLoadingModel(false);
      }
    };

    // -----------------------------------------------------------------------
    // Dungeon sections
    // -----------------------------------------------------------------------

    // Only chunks (and characters) of one section are visible at any time
    const applySectionVisibility = (sectionId: string) => {
      placedChunksGroup.children.forEach(child => {
        const childSect = (child.userData?.sectionId as string) ?? 'root';
        child.visible = childSect === sectionId;
      });
      placedNpcsGroup.children.forEach(child => {
        const childSect = (child.userData?.sectionId as string) ?? 'root';
        child.visible = childSect === sectionId;
      });
      // Base chunks permanently belong to the root section
      if (customFloorGroupRef.current) customFloorGroupRef.current.visible = sectionId === 'root';
      if (customWallGroupRef.current) customWallGroupRef.current.visible = sectionId === 'root';
      if (customDoorGroupRef.current) customDoorGroupRef.current.visible = sectionId === 'root';
    };

    // Recentre the camera on a world position (keeps iso angle + zoom)
    const refocusCamera = (worldPos: THREE.Vector3) => {
      const delta = new THREE.Vector3(worldPos.x - camTarget.x, 0, worldPos.z - camTarget.z);
      camera.position.add(delta);
      camTarget.set(worldPos.x, 0.45, worldPos.z);
      camera.lookAt(camTarget);
    };

    // Instantly place the character on a tile and turn away from an optional door
    const teleportCharacterTo = (col: number, row: number, facingAngle: number | null) => {
      moveQueueRef.current = [];
      targetWorldPosRef.current = null;
      currentTileRef.current = { col, row };
      setCharacterCoord({ col, row });
      const pos = getTileWorldPos(col, row);
      characterPosRef.current.set(pos.x, pos.y, pos.z);
      if (characterRootRef.current) {
        characterRootRef.current.position.set(pos.x, pos.y, pos.z);
        if (facingAngle !== null) {
          targetFacingAngleRef.current = facingAngle;
          currentFacingAngleRef.current = facingAngle;
          characterRootRef.current.rotation.y = facingAngle;
        }
      }
      setFacingDir(facingAngle === 0 ? 'SOUTH' : facingAngle === Math.PI ? 'NORTH' : facingAngle === Math.PI / 2 ? 'EAST' : 'WEST');
      setAnimState('IDLE');
      updateMovementAnimationRef.current(false);
      pendingPortalTileRef.current = null;
    };

    // Switch to a section: visibility, walkable tiles, character position/camera
    const focusSection = (sectionId: string, door?: PlacedChunkInstance) => {
      activeSectionRef.current = sectionId;
      setActiveSection(sectionId);
      applySectionVisibility(sectionId);
      refreshWalkableTiles({ section: sectionId });

      if (door) {
        // Section entered through a door: spawn in front of it, back towards it
        const tile = doorApproachTile(door);
        if (!walkableKeysRef.current.has(`${tile.col},${tile.row}`)) {
          // Floor chunk missing behind the door: fall back to any section tile
          const fallback = [...walkableKeysRef.current][0];
          const [fc, fr] = fallback.split(',').map(Number);
          teleportCharacterTo(fc, fr, null);
        } else {
          teleportCharacterTo(tile.col, tile.row, doorBackFacingAngle(door));
        }
      } else {
        // Manual switch (dropdown): keep the character when its tile is
        // walkable in the new section, otherwise move to the nearest tile
        const t = currentTileRef.current;
        if (!walkableKeysRef.current.has(`${t.col},${t.row}`)) {
          let best: { col: number; row: number } | null = null;
          let bestDist = Infinity;
          for (const key of walkableKeysRef.current) {
            const [c, r] = key.split(',').map(Number);
            const d = Math.abs(c - t.col) + Math.abs(r - t.row);
            if (d < bestDist) { bestDist = d; best = { col: c, row: r }; }
          }
          if (best) teleportCharacterTo(best.col, best.row, null);
        }
      }
      refocusCamera(characterPosRef.current);
      // While linking doors the pick must survive section switching
      if (editModeRef.current !== 'link') setLinkPickName(null);
      // Marker shells must follow the freshly visible section
      refreshLinkHighlightsRef.current?.();
    };
    focusSectionRef.current = focusSection;
    focusSection('root');

    // Human-readable door label (door file names are all identical, ids are not)
    const doorLabelOf = (inst: PlacedChunkInstance): string => {
      const doors = placedChunksRef.current.filter(p => p.type === 'door');
      const i = doors.findIndex(p => p.id === inst.id);
      return `Tür #${i + 1}`;
    };

    // Door pair colors: one color per PAIR, both doors share it
    const DOOR_PAIR_COLORS = [
      0x22d3ee, 0xfb7185, 0x4ade80, 0xfacc15, 0xa78bfa, 0x38bdf8,
      0xfb923c, 0x34d399, 0xe879f9, 0xf87171, 0x2dd4bf, 0x818cf8
    ];
    const DOOR_PICK_COLOR = 0xfbbf24; // amber: door currently picked for linking

    // Transparent marker boxes hugging each door chunk's REAL geometry
    // (works with any pivot convention). Only doors of the visible section.
    const refreshLinkHighlights = () => {
      for (const child of [...doorGlowGroup.children]) {
        const m = child as THREE.Mesh;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        doorGlowGroup.remove(m);
      }
      for (const p of placedChunksRef.current) {
        if (p.type !== 'door') continue;
        if (sectOf(p) !== activeSectionRef.current) continue; // no ghosts of hidden sections
        const isPick = linkFirstPick.current?.id === p.id;
        const paired = p.portalId !== undefined && placedChunksRef.current.some(q => q.id === p.portalId);
        if (!isPick && !paired) continue;
        const color = isPick
          ? DOOR_PICK_COLOR
          : DOOR_PAIR_COLORS[(p.pairColorIndex ?? 0) % DOOR_PAIR_COLORS.length];
        const holder = placedChunksGroup.children.find(c => (c.userData?.instanceId as string) === p.id);
        if (!holder) continue;
        holder.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(holder);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        if (size.lengthSq() < 1e-6) continue;
        const pad = 0.22;
        const geo = new THREE.BoxGeometry(
          Math.max(size.x, 0.4) + pad,
          Math.max(size.y, 0.4) + pad,
          Math.max(size.z, 0.4) + pad
        );
        const mat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: isPick ? 0.42 : 0.3, depthWrite: false
        });
        const marker = new THREE.Mesh(geo, mat);
        marker.position.copy(center);
        marker.renderOrder = 5;
        doorGlowGroup.add(marker);
      }
    };

    // Pair two doors as a section portal (bidirectional link, shared color)
    const linkFirstPick = { current: null as PlacedChunkInstance | null };
    const pairDoors = (a: PlacedChunkInstance, b: PlacedChunkInstance) => {
      // Free the old partners of both doors (strict 1:1 pairing)
      for (const p of placedChunksRef.current) {
        if (p.id === a.id || p.id === b.id) continue;
        if (p.portalId === a.portalId || p.portalId === b.portalId) {
          p.portalId = undefined;
          p.pairColorIndex = undefined;
        }
      }
      // Smallest unused color index keeps colors stable across reloads
      const used = new Set(
        placedChunksRef.current.map(p => p.pairColorIndex).filter(v => v !== undefined) as number[]
      );
      let idx = 0;
      while (used.has(idx)) idx++;
      a.portalId = b.id;
      b.portalId = a.id;
      a.pairColorIndex = idx;
      b.pairColorIndex = idx;
      setItem(CHUNK_PLACEMENTS_KEY, [...placedChunksRef.current]).catch(err => console.warn('placement save failed:', err));
      refreshLinkHighlights();
      linkFirstPick.current = null;
      setLinkPickName(null);
      playTactileSfx('success');
    };

    // Unlink one pair (both directions); triggered from the confirm dialog
    const unlinkDoor = (doorId: string) => {
      const door = placedChunksRef.current.find(p => p.id === doorId);
      if (!door?.portalId) return;
      const partner = placedChunksRef.current.find(p => p.id === door.portalId);
      if (partner) {
        partner.portalId = undefined;
        partner.pairColorIndex = undefined;
      }
      door.portalId = undefined;
      door.pairColorIndex = undefined;
      setItem(CHUNK_PLACEMENTS_KEY, [...placedChunksRef.current]).catch(err => console.warn('placement save failed:', err));
      refreshLinkHighlights();
      playTactileSfx('click');
    };
    unlinkDoorRef.current = unlinkDoor;

    // Hook up the link-mode click handler (used by the pointerdown branch)
    handleDoorLinkClickRef.current = (inst: PlacedChunkInstance) => {
      if (inst.type !== 'door') return;
      const picked = linkFirstPick.current;
      if (!picked) {
        if (inst.portalId) {
          // Door already paired: ask the user before tearing it apart
          askUnlinkRef.current(inst.id, doorLabelOf(inst));
          playTactileSfx('hover');
        } else {
          linkFirstPick.current = inst;
          setLinkPickName(doorLabelOf(inst));
          refreshLinkHighlights();
          playTactileSfx('hover');
        }
        return;
      }
      if (picked.id === inst.id) {
        // Clicking the picked door again clears the selection
        linkFirstPick.current = null;
        setLinkPickName(null);
        refreshLinkHighlights();
        playTactileSfx('hover');
        return;
      }
      pairDoors(picked, inst);
    };
    // Link mode stays on the ACTIVE section; the user switches sections via
    // the dropdown while picking partners
    handleLinkModeChangedRef.current = (active: boolean) => {
      linkFirstPick.current = null;
      setLinkPickName(null);
      doorGlowGroup.visible = active;
      if (active) refreshLinkHighlights();
    };
    refreshLinkHighlights();
    refreshLinkHighlightsRef.current = refreshLinkHighlights;
    // (Re)build the ghost model for the active placement session
    const applyGhost = () => {
      const placement = placementSceneRef.current;
      if (!placement || !ghostModelHolder || !ghostGroupRef.current) return;
      while (ghostModelHolder.children.length > 0) {
        ghostModelHolder.remove(ghostModelHolder.children[0]);
      }
      // Skinned character ghosts need a SkeletonUtils clone: a plain clone
      // keeps its skeleton bound to the ORIGINAL bones and would render at
      // the bind pose world position instead of following the cursor
      const isChar = placement.type === 'npc' || placement.type === 'enemy';
      const model = isChar
        ? (cloneSkeleton(placement.gltfScene) as THREE.Group)
        : placement.gltfScene.clone(true);
      model.traverse((child: any) => {
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = false;
          child.frustumCulled = false;
          child.material = ghostMat;
        }
      });
      ghostModelHolder.add(model);
      ghostModelHolder.rotation.y = (ghostRotationRef.current * Math.PI) / 180;
      // Character ghosts show a single sub-tile footprint, chunks a full cell
      const fs = isChar ? BLENDER_TILE_SIZE / CHUNK_CELL : 1;
      ghostFootprint.scale.set(fs, fs, 1);
      ghostBorder.scale.set(fs, fs, 1);
      const pickY = getPickPlaneY();
      ghostFootprint.position.y = pickY + 0.02;
      ghostBorder.position.y = pickY + 0.025;
      ghostGroupRef.current.visible = false;
    };
    applyGhostRef.current = applyGhost;

    hideGhostRef.current = () => {
      if (ghostGroupRef.current) ghostGroupRef.current.visible = false;
    };

    // Update ghost position/color from a pointer event. Returns true while
    // Placement Mode is active (pointer handlers then skip tile navigation).
    const updateGhostForEvent = (e: MouseEvent): boolean => {
      const placement = placementSceneRef.current;
      if (!placement || !ghostGroupRef.current) return false;

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      groundPlane.constant = -getPickPlaneY();
      if (!raycaster.ray.intersectPlane(groundPlane, rayHitVec)) {
        ghostGroupRef.current.visible = false;
        lastGhostCell = null;
        lastGhostValid = false;
        return true;
      }

      const tSize = BLENDER_TILE_SIZE;
      const isChar = placement.type === 'npc' || placement.type === 'enemy';
      const step = isChar ? tSize : CHUNK_CELL;
      const cellX = Math.round(rayHitVec.x / step);
      const cellZ = Math.round(rayHitVec.z / step);
      lastGhostCell = { x: cellX, z: cellZ };
      lastGhostValid = canPlaceAt(placement.type, cellX, cellZ, ghostRotationRef.current);

      const ghostColor = lastGhostValid ? 0x38bdf8 : 0xef4444;
      ghostMat.color.setHex(ghostColor);
      ghostFootprintMat.color.setHex(ghostColor);
      ghostBorderMat.color.setHex(ghostColor);

      // Character ghosts show a sub-tile footprint, chunks a full 8m cell.
      // The plane's second dimension is local Y (= world Z after the
      // -90° ground rotation), so both x AND y must be scaled.
      const fs = isChar ? tSize / CHUNK_CELL : 1;
      ghostFootprint.scale.set(fs, fs, 1);
      ghostBorder.scale.set(fs, fs, 1);

      const pickY = getPickPlaneY();
      ghostFootprint.position.y = pickY + 0.02;
      ghostBorder.position.y = pickY + 0.025;

      ghostGroupRef.current.position.set(cellX * step, 0, cellZ * step);
      ghostModelHolder.rotation.y = (ghostRotationRef.current * Math.PI) / 180;
      ghostGroupRef.current.visible = true;
      return true;
    };

    // Unity-style grab pan state: right button drag translates the camera
    let grabState: { x: number; y: number; moved: boolean } | null = null;
    let rightPanMoved = false;

    // Pan by converting screen-pixel deltas to world units on the camera's
    // horizontal right axis and the ground-projected view-up axis
    const panCameraByPixels = (dxPx: number, dyPx: number) => {
      const px = frustumSize / Math.max(1, container.clientHeight);
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const groundUp = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      // Desired content motion on screen, expressed in world units
      const delta = new THREE.Vector3()
        .addScaledVector(right, dxPx * px)
        .addScaledVector(groundUp, -dyPx * px);
      camera.position.addScaledVector(delta, -1);
      camTarget.addScaledVector(delta, -1);
      camera.lookAt(camTarget);
    };

    const handlePointerMove = (e: MouseEvent) => {
      // Unity-style grab pan: right button held down translates the camera
      if (grabState) {
        const dx = e.clientX - grabState.x;
        const dy = e.clientY - grabState.y;
        if (!grabState.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        grabState.moved = true;
        grabState.x = e.clientX;
        grabState.y = e.clientY;
        renderer.domElement.style.cursor = 'grabbing';
        panCameraByPixels(dx, dy);
        return;
      }

      if (updateGhostForEvent(e)) {
        setHoveredCoord(null);
        if (hoverIndicatorRef.current) hoverIndicatorRef.current.visible = false;
        renderer.domElement.style.cursor = 'crosshair';
        return;
      }

      // Edit modes: hovering a placed chunk or character signals "pickable"
      if (editModeRef.current) {
        const hit = findPlacedChunkAtEvent(e) || findPlacedNpcAtEvent(e);
        if (hit) {
          setHoveredCoord(null);
          if (hoverIndicatorRef.current) hoverIndicatorRef.current.visible = false;
          renderer.domElement.style.cursor = editModeRef.current === 'move' ? 'grab' : 'pointer';
          return;
        }
      }

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(tileMeshesRef.current, false);

      if (intersects.length > 0) {
        const hitTile = intersects[0].object as THREE.Mesh;
        const col = hitTile.userData.col;
        const row = hitTile.userData.row;

        setHoveredCoord({ col, row });

        if (hoverIndicatorRef.current) {
          const wPos = getTileWorldPosRef.current(col, row);
          hoverIndicatorRef.current.position.set(wPos.x, wPos.y + 0.005, wPos.z);
          hoverIndicatorRef.current.visible = true;
        }
        renderer.domElement.style.cursor = 'pointer';
      } else {
        setHoveredCoord(null);
        if (hoverIndicatorRef.current) {
          hoverIndicatorRef.current.visible = false;
        }
        renderer.domElement.style.cursor = 'default';
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      // Right mouse button: begin grab-pan drag (drag > 3px pans, plain click cancels)
      if (e.button === 2) {
        grabState = { x: e.clientX, y: e.clientY, moved: false };
        return;
      }

      // Left click in an edit mode: pick up (move), delete, or link doors.
      // Characters can be deleted the same way as chunks.
      if (e.button === 0 && !placementSceneRef.current && editModeRef.current) {
        const hit = findPlacedChunkAtEvent(e);
        if (hit) {
          if (editModeRef.current === 'delete') deletePlacedChunk(hit.inst);
          else if (editModeRef.current === 'link') handleDoorLinkClickRef.current(hit.inst);
          else startMoveSession(hit.inst);
        } else if (editModeRef.current === 'delete') {
          const npcHit = findPlacedNpcAtEvent(e);
          if (npcHit) deletePlacedNpc(npcHit.inst);
        } else {
          // Move mode: characters can be picked up too
          const npcHit = findPlacedNpcAtEvent(e);
          if (npcHit) startNpcMoveSession(npcHit.inst);
        }
        return;
      }

      // Click on a door of the active section: walk there and step through it
      if (e.button === 0 && !placementSceneRef.current && !editModeRef.current) {
        const hit = findPlacedChunkAtEvent(e);
        if (hit && hit.inst.type === 'door' && sectOf(hit.inst) === activeSectionRef.current) {
          if (beginDoorWalkRef.current(hit.inst)) return;
        }
      }

      // Placement Mode: left click places the chunk, other interaction paused
      if (updateGhostForEvent(e)) {
        if (e.button === 0 && lastGhostCell) {
          const placement = placementSceneRef.current;
          if (placement && lastGhostValid) {
            // Character kinds land on their sub-tile with an idle animation
            if (placement.type === 'npc' || placement.type === 'enemy') {
              // A carried character keeps its identity, a fresh one gets a new id
              const carriedNpc = placement.moveNpcId ? npcMoveSession : null;
              const instNpc: PlacedNpcInstance = carriedNpc
                ? {
                    ...carriedNpc.inst,
                    col: lastGhostCell.x,
                    row: lastGhostCell.z,
                    rotationY: ghostRotationRef.current
                  }
                : {
                    id: makePlacementId(PLACEMENT_ID_PREFIX.npc),
                    kind: placement.type,
                    libraryId: placement.libId,
                    col: lastGhostCell.x,
                    row: lastGhostCell.z,
                    rotationY: ghostRotationRef.current,
                    sectionId: activeSectionRef.current
                  };
              mountNpcInstance(instNpc, {
                scene: placement.gltfScene,
                animations: placement.animations ?? []
              });
              const nextNpcList = [...placedNpcsRef.current.filter(p => p.id !== instNpc.id), instNpc];
              placedNpcsRef.current = nextNpcList;
              setPlacedNpcs(nextNpcList);
              setItem(NPC_PLACEMENTS_KEY, nextNpcList).catch(err => console.warn('npc placement save failed:', err));
              npcMoveSession = null;
              repaintGhost();
              playTactileSfx('success');
            } else {
            // A carried chunk keeps its identity, a fresh placement gets a new one
            const inst: PlacedChunkInstance = moveSession
              ? {
                  ...moveSession.inst,
                  cellX: lastGhostCell.x,
                  cellZ: lastGhostCell.z,
                  rotationY: ghostRotationRef.current
                }
              : {
                  id: makePlacementId(PLACEMENT_ID_PREFIX.chunk),
                  type: placement.type,
                  libraryId: placement.libId,
                  cellX: lastGhostCell.x,
                  cellZ: lastGhostCell.z,
                  rotationY: ghostRotationRef.current,
                  sectionId: activeSectionRef.current
                };
            placeChunkInstance(inst, placement.gltfScene);
            const nextList = [...placedChunksRef.current.filter(p => p.id !== inst.id), inst];
            placedChunksRef.current = nextList;
            setPlacedChunks(nextList);
            setItem(CHUNK_PLACEMENTS_KEY, nextList).catch(err => console.warn('placement save failed:', err));
            moveSession = null;
            // New floor chunk extends the walkable dungeon grid immediately
            if (placement.type === 'floor') refreshWalkableTiles();
            repaintGhost();
            playTactileSfx('success');
            }
          } else {
            playTactileSfx('hover');
          }
        }
        return;
      }

      if (e.button !== 0) return;

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(tileMeshesRef.current, false);

      if (intersects.length > 0) {
        const hitTile = intersects[0].object as THREE.Mesh;
        handleTileClickRef.current(hitTile.userData.col, hitTile.userData.row);
      }
    };

    // Shared cancel routine for every exit path out of Placement Mode
    const exitPlacement = () => {
      if (!placementSceneRef.current) return;
      placementSceneRef.current = null;
      placementRequestSeqRef.current += 1;
      // An aborted move puts the carried chunk/character back to its place
      restoreActiveMove();
      setPlacementMode(null);
      if (ghostGroupRef.current) ghostGroupRef.current.visible = false;
      renderer.domElement.style.cursor = 'default';
      playTactileSfx('hover');
    };

    // Mouse wheel: rotates ghost 90° in Placement Mode, zooms camera otherwise
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (placementSceneRef.current) {
        ghostRotationRef.current = (ghostRotationRef.current + 90) % 360;
        if (ghostModelHolder) {
          ghostModelHolder.rotation.y = (ghostRotationRef.current * Math.PI) / 180;
        }
        setPlacementMode(prev => (prev ? { ...prev, rotationY: ghostRotationRef.current } : prev));
        playTactileSfx('hover');
        repaintGhost();
        return;
      }
      frustumSize = Math.min(30, Math.max(6, frustumSize * (e.deltaY > 0 ? 1.08 : 1 / 1.08)));
      applyCameraFrustum();
    };

    // Right click: after an actual grab-pan drag do nothing; a plain right
    // click in Placement Mode cancels the placement
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (rightPanMoved) {
        rightPanMoved = false;
        return;
      }
      exitPlacement();
    };

    // ESC while in Placement Mode: cancel. ESC also leaves any chunk edit mode
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      exitPlacement();
      if (editModeRef.current) {
        editModeRef.current = null;
        setEditMode(null);
        handleLinkModeChangedRef.current(false);
        renderer.domElement.style.cursor = 'default';
        playTactileSfx('hover');
      }
    };

    // End grab-pan when the button is released or the cursor leaves the canvas
    const handlePointerUp = (e: MouseEvent) => {
      if (e.button === 2 && grabState) {
        rightPanMoved = grabState.moved;
        grabState = null;
        if (!rightPanMoved) renderer.domElement.style.cursor = 'default';
      }
    };
    const handlePointerLeave = () => {
      if (grabState) {
        rightPanMoved = grabState.moved;
        grabState = null;
        renderer.domElement.style.cursor = 'default';
      }
    };

    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave);
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });
    renderer.domElement.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);

    const applyCameraFrustum = () => {
      if (!container || !camera) return;
      const newAspect = container.clientWidth / Math.max(1, container.clientHeight);
      camera.left = (-frustumSize * newAspect) / 2;
      camera.right = (frustumSize * newAspect) / 2;
      camera.top = frustumSize / 2;
      camera.bottom = -frustumSize / 2;
      camera.updateProjectionMatrix();
    };

    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      rendererRef.current.setSize(container.clientWidth, container.clientHeight);
      applyCameraFrustum();
    };

    window.addEventListener('resize', handleResize);

    // Animation Loop
    let animationFrameId: number;
    const timer = new THREE.Timer();

    // When a door walk reaches its target tile the section transition fires
    const checkDoorArrival = () => {
      const pending = pendingPortalTileRef.current;
      if (!pending) return;
      if (pending.col === currentTileRef.current.col && pending.row === currentTileRef.current.row) {
        pendingPortalTileRef.current = null;
        doorArrivalRef.current(pending.doorId);
      }
    };

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      timer.update();
      const delta = Math.min(timer.getDelta(), 0.1);
      const elapsed = timer.getElapsed();

      // Idle animations of every placed NPC/enemy in the scene
      for (const npcAnim of npcMixersRef.current) npcAnim.mixer.update(delta);

      // Step-by-step Movement Engine
      const charRoot = characterRootRef.current;
      const queue = moveQueueRef.current;

      if (charRoot && targetWorldPosRef.current) {
        const currentPos = characterPosRef.current;
        const targetPos = targetWorldPosRef.current;
        const dist = currentPos.distanceTo(targetPos);

        const step = moveSpeedRef.current * delta;

        if (dist <= step) {
          currentPos.copy(targetPos);
          charRoot.position.copy(targetPos);

          if (queue.length > 0) {
            const nextStep = queue.shift()!;
            currentTileRef.current = nextStep;
            setCharacterCoord(nextStep);

            if (queue.length > 0) {
              const upcoming = queue[0];
              const { angle, dir } = getCardinalAngle(nextStep, upcoming);
              targetFacingAngleRef.current = angle;
              setFacingDir(dir);
              targetWorldPosRef.current = getTileWorldPosRef.current(upcoming.col, upcoming.row);
            } else {
              targetWorldPosRef.current = null;
              setAnimState('IDLE');
              updateMovementAnimationRef.current(false);
              checkDoorArrival();
            }
          } else {
            targetWorldPosRef.current = null;
            setAnimState('IDLE');
            updateMovementAnimationRef.current(false);
            checkDoorArrival();
          }
        } else {
          const dirVec = new THREE.Vector3().subVectors(targetPos, currentPos).normalize();
          currentPos.addScaledVector(dirVec, step);
          charRoot.position.copy(currentPos);
        }

        currentFacingAngleRef.current = THREE.MathUtils.damp(
          currentFacingAngleRef.current,
          targetFacingAngleRef.current,
          20,
          delta
        );
        charRoot.rotation.y = currentFacingAngleRef.current;
      }

      const moving = targetWorldPosRef.current !== null || moveQueueRef.current.length > 0;
      updateCharacterPoseRef.current(delta, elapsed, moving);

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      renderer.dispose();
      scene.clear();
    };
  }, [createAnimeKnightDummy, playTactileSfx]);

  // Drag & Drop handlers on viewport
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.glb') || file.name.endsWith('.gltf'))) {
      const lower = file.name.toLowerCase();
      if (lower.includes('floor') || lower.includes('boden') || lower.includes('chunk')) {
        setActiveTab('floor');
        processFloorGLBFile(file);
      } else if (lower.includes('door') || lower.includes('tuer') || lower.includes('tür') || lower.includes('gate') || lower.includes('portal')) {
        setActiveTab('door');
        processDoorGLBFile(file);
      } else if (lower.includes('wall') || lower.includes('wand') || lower.includes('mauer')) {
        setActiveTab('wall');
        processWallGLBFile(file);
      } else if (activeTab === 'floor') {
        processFloorGLBFile(file);
      } else if (activeTab === 'wall') {
        processWallGLBFile(file);
      } else if (activeTab === 'door') {
        processDoorGLBFile(file);
      } else {
        setActiveTab('character');
        processGLBFile(file);
      }
    } else {
      alert("Bitte ziehe eine 3D-Modelldatei im .glb- oder .gltf-Format auf die Bühne.");
    }
  };

  const handleCharFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processGLBFile(file);
    }
  };

  const handleFloorFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFloorGLBFile(file);
    }
  };

  const handleWallFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processWallGLBFile(file);
    }
  };

  const handleDoorFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processDoorGLBFile(file);
    }
  };

  // Chunk library lists per type (derived for the dock UI)
  const floorLibrary = chunkLibrary.filter(e => e.type === 'floor');
  const wallLibrary = chunkLibrary.filter(e => e.type === 'wall');
  const doorLibrary = chunkLibrary.filter(e => e.type === 'door');
  const floorPlacedCount = placedChunks.filter(p => p.type === 'floor').length;
  const wallPlacedCount = placedChunks.filter(p => p.type === 'wall').length;
  const doorPlacedCount = placedChunks.filter(p => p.type === 'door').length;

  return (
    <div 
      className="relative w-full h-screen bg-gray-950 select-none overflow-hidden font-sans"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden File Inputs for 4 Assets */}
      <input
        ref={charFileInputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={handleCharFileInputChange}
        className="hidden"
      />
      <input
        ref={floorFileInputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={handleFloorFileInputChange}
        className="hidden"
      />
      <input
        ref={wallFileInputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={handleWallFileInputChange}
        className="hidden"
      />
      <input
        ref={doorFileInputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={handleDoorFileInputChange}
        className="hidden"
      />
      <input
        ref={npcFileInputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) processNpcGLBFile(f, 'npc');
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        ref={enemyFileInputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) processNpcGLBFile(f, 'enemy');
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* 3D WebGL Canvas */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* DRAG & DROP OVERLAY WITH 4 TARGETS */}
      {isDraggingFile && (
        <div className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 border-4 border-dashed border-cyan-400">
          <Upload size={54} className="text-cyan-400 mb-4 animate-bounce" />
          <h2 className="text-2xl font-bold text-white tracking-wide mb-2">GLB-Datei hier ablegen</h2>
          <p className="text-gray-300 text-sm mb-6 text-center max-w-lg">
            Dateien mit &apos;floor&apos;/&apos;boden&apos;, &apos;wall&apos;/&apos;wand&apos; oder &apos;door&apos;/&apos;tür&apos; im Namen werden automatisch erkannt, oder entsprechend des aktiven Tabs geladen.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl">
            <div className={`p-4 rounded-xl border flex flex-col items-center text-center transition-all ${
              activeTab === 'character' ? 'bg-cyan-950/60 border-cyan-400 text-cyan-200' : 'bg-gray-900/60 border-gray-700 text-gray-300'
            }`}>
              <User size={28} className="text-cyan-400 mb-2" />
              <span className="font-bold text-sm">Charakter (.glb)</span>
              <span className="text-[11px] text-gray-400 mt-1">1:1 Originalmaßstab mit Animationen</span>
            </div>

            <div className={`p-4 rounded-xl border flex flex-col items-center text-center transition-all ${
              activeTab === 'floor' ? 'bg-emerald-950/60 border-emerald-400 text-emerald-200' : 'bg-gray-900/60 border-gray-700 text-gray-300'
            }`}>
              <Square size={28} className="text-emerald-400 mb-2" />
              <span className="font-bold text-sm">Bodenplatte (8x8m)</span>
              <span className="text-[11px] text-gray-400 mt-1">Basis-Chunk 8x8m, Kopien rastern aufs Grid</span>
            </div>

            <div className={`p-4 rounded-xl border flex flex-col items-center text-center transition-all ${
              activeTab === 'wall' ? 'bg-amber-950/60 border-amber-400 text-amber-200' : 'bg-gray-900/60 border-gray-700 text-gray-300'
            }`}>
              <Box size={28} className="text-amber-400 mb-2" />
              <span className="font-bold text-sm">Wand (8m)</span>
              <span className="text-[11px] text-gray-400 mt-1">Left_Wall &amp; Upper_Wall (4m Höhe)</span>
            </div>

            <div className={`p-4 rounded-xl border flex flex-col items-center text-center transition-all ${
              activeTab === 'door' ? 'bg-purple-950/60 border-purple-400 text-purple-200' : 'bg-gray-900/60 border-gray-700 text-gray-300'
            }`}>
              <DoorClosed size={28} className="text-purple-400 mb-2" />
              <span className="font-bold text-sm">Tür (.glb)</span>
              <span className="text-[11px] text-gray-400 mt-1">Mitte linke Wand / 90° obere Wand</span>
            </div>
          </div>
        </div>
      )}

      {/* LOADING OVERLAY */}
      {isLoadingModel && (
        <div className="absolute inset-0 z-50 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none">
          <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4" />
          <h3 className="text-lg font-bold text-white">{loadingMessage}</h3>
        </div>
      )}

      {/* TOP BAR */}
      <div className="absolute top-0 left-0 right-0 p-3 md:p-5 flex items-center justify-between pointer-events-none z-20">
        <button
          onClick={onExit}
          className="pointer-events-auto flex items-center gap-2 px-3.5 py-2 bg-gray-900/95 hover:bg-gray-800 text-gray-200 hover:text-white border border-gray-700/80 rounded-xl shadow-xl transition-all font-semibold text-xs group active:scale-95"
          title="Zurück zum Editor Hauptmenü"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform text-emerald-400" />
          <span>Zurück zum Editor</span>
        </button>

        {/* Central 3-Asset Badges (Click to switch tab in dock) */}
        <div className="pointer-events-auto hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-900/90 border border-gray-800 rounded-2xl text-xs shadow-xl backdrop-blur-md">
          <button
            onClick={() => { setActiveTab('character'); setIsDockCollapsed(false); playTactileSfx('click'); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'character'
                ? 'bg-cyan-900/70 text-cyan-200 border border-cyan-500/80 shadow'
                : 'text-gray-300 hover:text-white hover:bg-gray-800'
            }`}
          >
            <User size={13} className="text-cyan-400" />
            <span>Charakter:</span>
            <span className="font-mono text-[11px] text-cyan-300 font-bold max-w-[100px] truncate">
              {customModelLoaded ? customModelName : 'Dummy'}
            </span>
          </button>

          <span className="text-gray-700">|</span>

          <button
            onClick={() => { setActiveTab('floor'); setIsDockCollapsed(false); playTactileSfx('click'); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'floor'
                ? 'bg-emerald-900/70 text-emerald-200 border border-emerald-500/80 shadow'
                : 'text-gray-300 hover:text-white hover:bg-gray-800'
            }`}
          >
            <Square size={13} className="text-emerald-400" />
            <span>Boden (8x8m):</span>
            <span className="font-mono text-[11px] text-emerald-300 font-bold max-w-[100px] truncate">
              {customFloorLoaded ? customFloorName : 'Basis: leer'}
            </span>
          </button>

          <span className="text-gray-700">|</span>

          <button
            onClick={() => { setActiveTab('wall'); setIsDockCollapsed(false); playTactileSfx('click'); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'wall'
                ? 'bg-amber-900/70 text-amber-200 border border-amber-500/80 shadow'
                : 'text-gray-300 hover:text-white hover:bg-gray-800'
            }`}
          >
            <Box size={13} className="text-amber-400" />
            <span>Wand (8m):</span>
            <span className="font-mono text-[11px] text-amber-300 font-bold max-w-[90px] truncate">
              {customWallLoaded ? customWallName : 'Basis: leer'}
            </span>
          </button>

          <span className="text-gray-700">|</span>

          <button
            onClick={() => { setActiveTab('door'); setIsDockCollapsed(false); playTactileSfx('click'); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'door'
                ? 'bg-purple-900/70 text-purple-200 border border-purple-500/80 shadow'
                : 'text-gray-300 hover:text-white hover:bg-gray-800'
            }`}
          >
            <DoorClosed size={13} className="text-purple-400" />
            <span>Tür:</span>
            <span className="font-mono text-[11px] text-purple-300 font-bold max-w-[90px] truncate">
              {customDoorLoaded ? customDoorName : 'Keine'}
            </span>
          </button>
        </div>

        {/* Right Status Pill */}
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="flex items-center gap-2.5 px-3 py-1.5 bg-gray-900/90 border border-gray-800 rounded-xl text-xs shadow-xl">
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400">Kachel:</span>
              <span className="font-mono font-bold text-cyan-300 bg-gray-800 px-1.5 py-0.5 rounded">
                [{characterCoord.col}, {characterCoord.row}]
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400">Blick:</span>
              <span className="font-mono font-semibold text-amber-400">
                {facingDir}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                animState === 'RUN' ? 'bg-emerald-950 text-emerald-400 border border-emerald-700' : 'bg-gray-800 text-gray-300'
              }`}>
                {animState}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* TILE HOVER FLOATER */}
      {hoveredCoord && !placementMode && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-none z-10 transition-all duration-150">
          <div className="bg-gray-900/90 border border-cyan-500/40 px-3.5 py-1 rounded-full text-xs text-cyan-300 font-mono shadow-2xl flex items-center gap-2">
            <Footprints size={14} className="text-cyan-400" />
            <span>Klick: Schritt nach Kachel <strong>[{hoveredCoord.col}, {hoveredCoord.row}]</strong></span>
          </div>
        </div>
      )}

      {/* PLACEMENT MODE HUD */}
      {placementMode && (
        <div className="absolute inset-x-0 top-16 flex justify-center px-4 pointer-events-none z-30">
          <div className="pointer-events-auto bg-gray-900/95 backdrop-blur-md border border-cyan-500/60 rounded-2xl px-4 py-2.5 shadow-2xl flex flex-wrap items-center gap-3 max-w-full">
            <div className={`flex items-center gap-2 ${placementMode.moveInstanceId ? 'text-amber-300' : 'text-cyan-300'}`}>
              <Move size={18} />
              <span className="font-bold text-sm tracking-wide">
                {placementMode.moveInstanceId ? 'Chunk verschieben — Zielfeld wählen'
                  : placementMode.moveNpcId ? 'Figur verschieben — Zielfeld wählen'
                  : placementMode.type === 'npc' || placementMode.type === 'enemy' ? 'Charakter platzieren'
                  : 'Platzierungsmodus'}
              </span>
            </div>
            <span className="text-xs text-gray-200 font-mono bg-gray-800 px-2 py-1 rounded-lg max-w-[180px] truncate" title={placementMode.fileName}>
              {placementMode.fileName}
            </span>
            <span className="text-xs text-amber-300 font-mono font-bold bg-amber-950/60 border border-amber-700/60 px-2 py-1 rounded-lg">
              Drehung: {placementMode.rotationY}°
            </span>
            <div className="hidden md:flex items-center gap-1.5 text-[11px] text-gray-400">
              <span className="text-cyan-400 font-semibold">Linksklick</span> = {placementMode.moveInstanceId ? 'ablegen' : 'platzieren'}
              <span className="text-gray-600">•</span>
              <span className="text-cyan-400 font-semibold">Mausrad</span> = 90° drehen
              <span className="text-gray-600">•</span>
              <span className="text-rose-400 font-semibold">ESC / Rechtsklick</span> = {placementMode.moveInstanceId ? 'alte Position' : 'fertig'}
            </div>
            <button
              onClick={cancelPlacement}
              className="ml-auto px-2.5 py-1 bg-red-950/50 hover:bg-red-900/70 text-red-300 hover:text-white border border-red-800/60 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <X size={13} />
              <span>{placementMode.moveInstanceId ? 'Abbrechen' : 'Fertig'}</span>
            </button>
          </div>
        </div>
      )}

      {/* CHUNK EDIT TOOLBAR: sections, door links, move / delete placed copies */}
      {!placementMode && (
        <div className="absolute inset-x-0 top-16 flex justify-center px-4 pointer-events-none z-20">
          <div className="pointer-events-auto bg-gray-900/95 backdrop-blur-md border border-gray-700/80 rounded-2xl px-3 py-2 shadow-2xl flex flex-wrap items-center gap-2 max-w-full">
            {editMode === 'link' ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold px-2 py-1 rounded-lg border text-purple-200 bg-purple-950/60 border-purple-700/60">
                  Türen verbinden
                </span>
                <span className="text-[11px] text-gray-400 hidden md:inline">
                  {linkPickName
                    ? `Tür "${linkPickName}" gewählt — jetzt den Abschnitt oben wechseln und die Partner-Tür anklicken`
                    : 'Tür anklicken (wird gelb markiert) → Abschnitt wechseln → Partner-Tür anklicken. Verbundene Tür anklicken = trennen (mit Rückfrage)'}
                </span>
              </div>
            ) : editMode ? (
              <>
                <span className={`text-xs font-bold px-2 py-1 rounded-lg border ${
                  editMode === 'move'
                    ? 'text-amber-200 bg-amber-950/60 border-amber-700/60'
                    : 'text-rose-200 bg-rose-950/60 border-rose-700/60'
                }`}>
                  {editMode === 'move' ? 'Verschieben-Modus' : 'Entfernen-Modus'}
                </span>
                <span className="text-[11px] text-gray-400 hidden md:inline">
                  {editMode === 'move'
                    ? 'Chunk anklicken zum Aufnehmen — Klick legt ihn ab, Mausrad dreht'
                    : 'Chunk anklicken, um die Kopie zu löschen'}
                </span>
              </>
            ) : (
              <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider hidden md:inline">
                Abschnitt & Kopien:
              </span>
            )}

            <select
              value={activeSection}
              onChange={(e) => selectSection(e.target.value)}
              className="px-2 py-1 text-xs font-semibold rounded-lg border bg-gray-800 text-gray-200 border-gray-700"
              title="Welcher Abschnitt sichtbar ist und wo neue Chunks platziert werden"
            >
              {sections.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              onClick={createSection}
              className="px-2 py-1 text-xs font-semibold rounded-lg border flex items-center gap-1.5 bg-gray-800 text-emerald-300 border-gray-700 hover:text-white hover:bg-gray-700 transition-colors"
              title="Einen neuen, leeren Abschnitt anlegen und aktiv schalten"
            >
              + Abschnitt
            </button>
            <button
              onClick={() => { toggleEditMode('link'); playTactileSfx('click'); }}
              className={`px-2 py-1 text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition-colors ${
                editMode === 'link'
                  ? 'bg-purple-600 text-white border-purple-400'
                  : 'bg-gray-800 text-gray-300 border-gray-700 hover:text-white hover:bg-gray-700'
              }`}
            >
              Türen verbinden
            </button>
            <button
              onClick={() => { toggleEditMode('move'); playTactileSfx('click'); }}
              disabled={placedChunks.length === 0 && placedNpcs.length === 0}
              className={`px-2 py-1 text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition-colors disabled:opacity-40 ${
                editMode === 'move'
                  ? 'bg-amber-600 text-white border-amber-400'
                  : 'bg-gray-800 text-gray-300 border-gray-700 hover:text-white hover:bg-gray-700'
              }`}
            >
              <Move size={13} /> Verschieben
            </button>
            <button
              onClick={() => { toggleEditMode('delete'); playTactileSfx('click'); }}
              disabled={placedChunks.length === 0 && placedNpcs.length === 0}
              className={`px-2 py-1 text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition-colors disabled:opacity-40 ${
                editMode === 'delete'
                  ? 'bg-rose-600 text-white border-rose-400'
                  : 'bg-gray-800 text-gray-300 border-gray-700 hover:text-white hover:bg-gray-700'
              }`}
            >
              <Trash2 size={13} /> Entfernen
            </button>
          </div>
        </div>
      )}

      {/* TRANSIENT HINT PILL (e.g. door leads nowhere) */}
      {portalHint && (
        <div className="absolute inset-x-0 top-28 flex justify-center px-4 pointer-events-none z-30">
          <div className="bg-purple-950/90 border border-purple-600/60 text-purple-200 text-xs font-semibold px-3.5 py-2 rounded-xl shadow-xl backdrop-blur-md max-w-[520px] text-center">
            {portalHint}
          </div>
        </div>
      )}

      {/* UNLINK CONFIRM DIALOG */}
      {unlinkAsk && (
        <div className="absolute inset-x-0 top-28 flex justify-center px-4 pointer-events-none z-40">
          <div className="pointer-events-auto bg-gray-900/95 border border-purple-500/60 rounded-xl px-4 py-3 shadow-2xl backdrop-blur-md flex items-center gap-3">
            <span className="text-xs text-gray-200">
              Verbindung von <strong className="text-purple-300">{unlinkAsk.label}</strong> trennen?
            </span>
            <button
              onClick={() => resolveUnlink(true)}
              className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Ja, trennen
            </button>
            <button
              onClick={() => resolveUnlink(false)}
              className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold rounded-lg border border-gray-700 transition-colors"
            >
              Nein
            </button>
          </div>
        </div>
      )}

      {/* UNIFIED COLLAPSIBLE BOTTOM DOCK */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 transition-all duration-300 ease-out flex flex-col items-center"
        style={{ width: 'min(980px, 95vw)' }}
      >
        <button
          onClick={() => setIsDockCollapsed(!isDockCollapsed)}
          className="mb-1 px-4 py-1.5 bg-gray-900 text-gray-300 hover:text-white rounded-t-xl border-t border-x border-gray-700/80 text-xs font-semibold flex items-center gap-1.5 shadow-lg transition-colors"
        >
          {isDockCollapsed ? (
            <>
              <ChevronUp size={14} className="text-cyan-400" /> Assets & Dungeon-Steuerung öffnen
            </>
          ) : (
            <>
              <ChevronDown size={14} /> Steuerung minimieren
            </>
          )}
        </button>

        {!isDockCollapsed && (
          <div className="w-full bg-gray-900/95 border border-gray-800 rounded-2xl p-4 shadow-2xl space-y-3.5 backdrop-blur-md">
            {/* Top row: Tab Navigation for Character, Floor, Wall, Door */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setActiveTab('character'); playTactileSfx('click'); }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === 'character'
                      ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-950/50 border border-cyan-400'
                      : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700/80'
                  }`}
                >
                  <User size={14} className={activeTab === 'character' ? 'text-white' : 'text-cyan-400'} />
                  <span>1. Charakter</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    customModelLoaded ? 'bg-cyan-950 text-cyan-300 border border-cyan-700' : 'bg-gray-900 text-gray-500'
                  }`}>
                    {customModelLoaded ? 'GLB' : 'Dummy'}
                  </span>
                </button>

                <button
                  onClick={() => { setActiveTab('floor'); playTactileSfx('click'); }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === 'floor'
                      ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50 border border-emerald-400'
                      : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700/80'
                  }`}
                >
                  <Square size={14} className={activeTab === 'floor' ? 'text-white' : 'text-emerald-400'} />
                  <span>2. Boden</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    customFloorLoaded ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-gray-900 text-gray-500'
                  }`}>
                    {customFloorLoaded ? '8x8m' : 'leer'}
                  </span>
                </button>

                <button
                  onClick={() => { setActiveTab('wall'); playTactileSfx('click'); }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === 'wall'
                      ? 'bg-amber-600 text-white shadow-lg shadow-amber-950/50 border border-amber-400'
                      : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700/80'
                  }`}
                >
                  <Box size={14} className={activeTab === 'wall' ? 'text-white' : 'text-amber-400'} />
                  <span>3. Wand</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    customWallLoaded ? 'bg-amber-950 text-amber-300 border border-amber-700' : 'bg-gray-900 text-gray-500'
                  }`}>
                    {customWallLoaded ? '8m' : 'leer'}
                  </span>
                </button>

                <button
                  onClick={() => { setActiveTab('door'); playTactileSfx('click'); }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === 'door'
                      ? 'bg-purple-600 text-white shadow-lg shadow-purple-950/50 border border-purple-400'
                      : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700/80'
                  }`}
                >
                  <DoorClosed size={14} className={activeTab === 'door' ? 'text-white' : 'text-purple-400'} />
                  <span>4. Tür</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    customDoorLoaded ? 'bg-purple-950 text-purple-300 border border-purple-700' : 'bg-gray-900 text-gray-500'
                  }`}>
                    {customDoorLoaded ? 'GLB' : 'Keine'}
                  </span>
                </button>
              </div>

              {/* Quick Action in Tab Header */}
              <div className="flex items-center gap-2">
                {activeTab === 'character' && (
                  <button
                    onClick={() => charFileInputRef.current?.click()}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white border border-cyan-400/40 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors shadow"
                  >
                    <Upload size={13} />
                    <span>{customModelLoaded ? 'Anderen Charakter wählen' : 'Charakter GLB laden'}</span>
                  </button>
                )}

                {activeTab === 'floor' && (
                  <button
                    onClick={() => floorFileInputRef.current?.click()}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/40 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors shadow"
                  >
                    <Upload size={13} />
                    <span>{customFloorLoaded ? 'Andere Bodenplatte wählen' : 'Bodenplatte GLB (8x8m) laden'}</span>
                  </button>
                )}

                {activeTab === 'wall' && (
                  <button
                    onClick={() => wallFileInputRef.current?.click()}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white border border-amber-400/40 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors shadow"
                  >
                    <Upload size={13} />
                    <span>{customWallLoaded ? 'Andere Wand wählen' : 'Wand GLB (8m) laden'}</span>
                  </button>
                )}

                {activeTab === 'door' && (
                  <button
                    onClick={() => doorFileInputRef.current?.click()}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white border border-purple-400/40 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors shadow"
                  >
                    <Upload size={13} />
                    <span>{customDoorLoaded ? 'Andere Tür wählen' : 'Tür GLB laden'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* TAB 1: CHARACTER CONTROLS */}
            {activeTab === 'character' && (
              <div className="space-y-3">
                {/* Character Status Row */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <User size={14} className="text-cyan-400" /> Charakter:
                    </span>
                    {customModelLoaded ? (
                      <div className="flex items-center gap-2 bg-cyan-950/50 border border-cyan-600/50 px-2.5 py-1 rounded-lg text-xs text-cyan-200">
                        <Check size={14} className="text-cyan-400" />
                        <span className="font-semibold truncate max-w-[220px]" title={customModelName}>
                          {customModelName}
                        </span>
                        {customModelSize > 0 && (
                          <span className="text-[10px] text-gray-400">
                            ({(customModelSize / (1024 * 1024)).toFixed(2)} MB)
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300 bg-gray-800 px-2 py-0.5 rounded-lg border border-gray-700">
                        Standard Anime-Kriegerin (Dummy)
                      </span>
                    )}

                    <span className="hidden lg:inline text-[11px] text-emerald-400 font-mono bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded-lg">
                      1:1 Originalmaßstab aktiv (Körper: 1.36m, Kopf: 0.538m)
                    </span>
                  </div>

                  {customModelLoaded && (
                    <button
                      onClick={handleResetToDummy}
                      className="px-2.5 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-300 hover:text-white border border-red-800/50 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                      title="GLB entfernen und Dummy wiederherstellen"
                    >
                      <Trash2 size={13} />
                      <span>Dummy wiederherstellen</span>
                    </button>
                  )}
                </div>

                {/* Project Characters Bar */}
                {characters && characters.length > 0 && (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
                    <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider flex-shrink-0 flex items-center gap-1">
                      <Layers size={13} /> Aus Projekt:
                    </span>
                    <button
                      onClick={handleResetToDummy}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all flex-shrink-0 ${
                        !customModelLoaded
                          ? 'bg-purple-900/60 text-purple-200 border-purple-500 shadow'
                          : 'bg-gray-800/80 text-gray-400 border-gray-700 hover:text-gray-200'
                      }`}
                    >
                      Standard-Dummy
                    </button>
                    {characters.map(char => (
                      <button
                        key={char.id}
                        onClick={() => {
                          if (char.model3dSrc) {
                            loadCharacterFromProject(char);
                          } else {
                            charFileInputRef.current?.click();
                          }
                        }}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all flex-shrink-0 ${
                          customModelName.startsWith(char.name)
                            ? 'bg-cyan-900/60 text-cyan-200 border-cyan-500 shadow'
                            : 'bg-gray-800/80 text-gray-300 border-gray-700 hover:bg-gray-700'
                        }`}
                        title={char.model3dSrc ? `3D-Modell von ${char.name} laden` : `Eigenen GLB für ${char.name} hochladen`}
                      >
                        <span style={{ color: char.rpgColor || '#38bdf8' }}>●</span>
                        <span>{char.name}</span>
                        {char.model3dSrc ? (
                          <span className="text-[9px] bg-cyan-950 text-cyan-400 border border-cyan-700/60 px-1 rounded font-mono font-bold">
                            3D
                          </span>
                        ) : (
                          <span className="text-[9px] text-gray-500">
                            (+GLB)
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* NPC & Enemy figure library: upload once, place many */}
                {(['npc', 'enemy'] as const).map(kind => {
                  const kindEntries = npcLibrary.filter(e => e.kind === kind);
                  return (
                    <div key={kind} className="flex flex-wrap items-center gap-2 pb-1 text-xs">
                      <span className={`text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1 flex-shrink-0 ${
                        kind === 'enemy' ? 'text-rose-400' : 'text-cyan-400'
                      }`}>
                        {kind === 'enemy' ? <Swords size={13} /> : <Users size={13} />}
                        <span>{kind === 'enemy' ? 'Gegner' : 'Neutral'} ({kindEntries.length}):</span>
                      </span>
                      <button
                        onClick={() => (kind === 'enemy' ? enemyFileInputRef : npcFileInputRef).current?.click()}
                        className={`px-2 py-1 text-white text-[11px] font-semibold rounded-lg flex items-center gap-1 transition-colors shadow flex-shrink-0 ${
                          kind === 'enemy' ? 'bg-rose-600 hover:bg-rose-500' : 'bg-cyan-600 hover:bg-cyan-500'
                        }`}
                        title={`Charakter-GLB als ${kind === 'enemy' ? 'Gegner' : 'neutralen Charakter'} hochladen`}
                      >
                        <Upload size={11} />
                        <span>GLB</span>
                      </button>
                      {kindEntries.length === 0 && (
                        <span className="text-[11px] text-gray-500">
                          Noch keine Datei — einmal hochgeladen, erscheint sie hier zum Platzieren
                        </span>
                      )}
                      {kindEntries.map(entry => {
                        const isActive = placementMode?.type === kind && placementMode.libId === entry.id;
                        return (
                          <div
                            key={entry.id}
                            className={`flex items-center rounded-lg border overflow-hidden flex-shrink-0 shadow-sm ${
                              isActive
                                ? kind === 'enemy' ? 'bg-rose-600 border-rose-400 text-white' : 'bg-cyan-600 border-cyan-400 text-white'
                                : 'bg-gray-800/80 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            <button
                              onClick={() => (isActive ? cancelPlacement() : startPlacement(kind, entry))}
                              className="pl-2 py-1 flex items-center gap-1.5 text-xs font-semibold"
                              title={isActive ? 'Platzierungsmodus aktiv — klicken zum Beenden' : 'Figur auf ein freies begehbares Feld platzieren'}
                            >
                              {isActive && <Move size={11} className="text-white" />}
                              {isActive && <span className="text-[10px] font-mono">{placementMode?.rotationY}°</span>}
                              <span className="max-w-[140px] truncate" title={entry.fileName}>{entry.fileName}</span>
                            </button>
                            <button
                              onClick={() => removeNpcLibraryEntry(entry.id)}
                              className="px-1.5 py-1 text-rose-300 hover:text-rose-200 transition-colors"
                              title="Datei aus Bibliothek entfernen (entfernt auch alle platzierten Kopien)"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {/* Character Adjustments (Scale, Offset Y, Rotation, Animations) */}
                {customModelLoaded && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-gray-950/70 p-3 rounded-xl border border-gray-800/80 text-xs">
                    {/* Scale & Offset */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-gray-400">
                        <span className="flex items-center gap-1 font-semibold">
                          <Sliders size={13} className="text-amber-400" /> Skalierung: {modelScale.toFixed(2)}x
                        </span>
                        <button 
                          onClick={() => setModelScale(1.0)} 
                          className="text-[10px] text-cyan-400 hover:underline"
                        >
                          1:1 Original
                        </button>
                      </div>
                      <input
                        type="range"
                        min="0.3"
                        max="2.5"
                        step="0.05"
                        value={modelScale}
                        onChange={(e) => setModelScale(parseFloat(e.target.value))}
                        className="w-full accent-cyan-500 cursor-pointer"
                      />

                      <div className="flex justify-between items-center text-gray-400 pt-1">
                        <span className="font-semibold">Höhe (Y): {modelOffsetY.toFixed(2)}m</span>
                        <button 
                          onClick={() => setModelOffsetY(0.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          Reset (0m)
                        </button>
                      </div>
                      <input
                        type="range"
                        min="-0.6"
                        max="0.6"
                        step="0.02"
                        value={modelOffsetY}
                        onChange={(e) => setModelOffsetY(parseFloat(e.target.value))}
                        className="w-full accent-cyan-500 cursor-pointer"
                      />
                    </div>

                    {/* 4-Way Model Direction Offset (Rotation Y) */}
                    <div className="space-y-2">
                      <div className="text-gray-400 font-semibold flex items-center gap-1">
                        <RotateCcw size={13} className="text-blue-400" /> Ausrichtung (Blender-Offset):
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {[0, 90, 180, 270].map(deg => (
                          <button
                            key={deg}
                            onClick={() => setModelRotationY(deg)}
                            className={`py-1.5 rounded-lg border text-xs font-mono font-bold transition-all ${
                              modelRotationY === deg
                                ? 'bg-cyan-600 text-white border-cyan-400'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            {deg}°
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-500 leading-tight">
                        Wähle 180°, falls das Modell in Blender mit dem Rücken nach vorne exportiert wurde.
                      </p>
                    </div>

                    {/* Animation Clip Selectors */}
                    <div className="space-y-2">
                      <div className="text-gray-400 font-semibold flex items-center gap-1">
                        <Film size={13} className="text-purple-400" /> Animationen ({availableClips.length} gefunden):
                      </div>

                      {availableClips.length > 0 ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 w-10">Idle:</span>
                            <select
                              value={selectedIdleClip}
                              onChange={(e) => {
                                const newIdle = e.target.value;
                                setSelectedIdleClip(newIdle);
                                selectedIdleClipRef.current = newIdle;
                                if (animState === 'IDLE') {
                                  playAnimationClip(newIdle);
                                }
                              }}
                              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-cyan-500 font-mono"
                            >
                              {availableClips.map(clip => (
                                <option key={clip} value={clip}>{clip}</option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 w-10">Lauf:</span>
                            <select
                              value={selectedRunClip}
                              onChange={(e) => {
                                const newRun = e.target.value;
                                setSelectedRunClip(newRun);
                                selectedRunClipRef.current = newRun;
                                if (animState === 'RUN') {
                                  playAnimationClip(newRun);
                                }
                              }}
                              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-cyan-500 font-mono"
                            >
                              {availableClips.map(clip => (
                                <option key={clip} value={clip}>{clip}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ) : (
                        <div className="p-2 bg-gray-900 border border-gray-800 rounded-lg text-[11px] text-gray-400">
                          Keine Skelettanimationen in der Datei. Das Modell wird beim Laufen prozedural bewegt.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: FLOOR CONTROLS (8x8m CHUNK) */}
            {activeTab === 'floor' && (
              <div className="space-y-3">
                {/* Floor Status Row */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Square size={14} className="text-emerald-400" /> Boden-Grafik:
                    </span>
                    {customFloorLoaded ? (
                      <div className="flex items-center gap-2 bg-emerald-950/50 border border-emerald-600/50 px-2.5 py-1 rounded-lg text-xs text-emerald-200">
                        <Check size={14} className="text-emerald-400" />
                        <span className="font-semibold truncate max-w-[220px]" title={customFloorName}>
                          {customFloorName}
                        </span>
                        <span className="text-[10px] bg-emerald-900/60 text-emerald-300 px-1.5 py-0.5 rounded font-mono font-bold">
                          8x8m Chunk aktiv
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300 bg-gray-800 px-2 py-0.5 rounded-lg border border-gray-700">
                        Kein Boden-Chunk geladen (Dungeon startet leer)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => floorFileInputRef.current?.click()}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow"
                    >
                      <Upload size={13} />
                      <span>{customFloorLoaded ? 'Anderen Boden laden' : 'Bodenplatte (.glb) laden'}</span>
                    </button>

                    {customFloorLoaded && (
                      <button
                        onClick={handleResetFloor}
                        className="px-2.5 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-300 hover:text-white border border-red-800/50 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                        title="Basis-Boden-Chunk entfernen (Kopien in der Bibliothek bleiben erhalten)"
                      >
                        <Trash2 size={13} />
                        <span>Basis-Chunk entfernen</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Chunk Library: previously uploaded files, grid-snapping copies */}
                <div className="flex flex-wrap items-center gap-2 pb-1 text-xs">
                  <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider flex items-center gap-1 flex-shrink-0">
                    <Layers size={13} /> Chunk-Bibliothek ({floorLibrary.length}):
                  </span>
                  {floorLibrary.length === 0 && (
                    <span className="text-[11px] text-gray-500">
                      Noch keine Datei geladen  - einmal hochgeladen, kann sie immer wieder für neue Kopien gewählt werden.
                    </span>
                  )}
                  {floorLibrary.map(entry => {
                    const isActive = placementMode?.type === 'floor' && placementMode.libId === entry.id;
                    return (
                      <div key={entry.id} className={`flex items-center rounded-lg border overflow-hidden flex-shrink-0 shadow-sm ${isActive ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-gray-800/80 text-gray-300 border-gray-700 hover:bg-gray-700'}`}>
                        <button
                          onClick={() => (isActive ? cancelPlacement() : startPlacement('floor', entry))}
                          className="pl-2 py-1 flex items-center gap-1.5 text-xs font-semibold"
                          title={isActive ? 'Platzierungsmodus aktiv  - klicken zum Beenden' : 'Neue 8x8m Kopie auf dem Borderraster platzieren'}
                        >
                          {isActive && <Move size={11} className="text-white" />}
                          {isActive && <span className="text-[10px] font-mono">{placementMode?.rotationY}°</span>}
                          <span className="max-w-[150px] truncate" title={entry.fileName}>{entry.fileName}</span>
                        </button>
                        <button
                          onClick={() => removeChunkLibraryEntry(entry.id)}
                          className="px-1.5 py-1 text-rose-300 hover:text-rose-200 transition-colors"
                          title="Datei aus Bibliothek entfernen (entfernt auch alle platzierten Kopien dieser Datei)"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })}
                  {floorLibrary.length > 0 && floorPlacedCount > 0 && (
                    <button
                      onClick={() => clearPlacementsOfType('floor')}
                      className="text-[10px] text-gray-400 hover:text-rose-300 bg-gray-900 border border-gray-800 px-2 py-0.5 rounded-full font-mono flex-shrink-0 transition-colors"
                      title="Alle platzierten Boden-Chunks entfernen (unverändert bleiben Basis-Boden und Bibliothek)"
                    >
                      {floorPlacedCount} Kopien • leeren
                    </button>
                  )}
                </div>

                {/* Blender Blueprint Specification Box */}
                <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-3 text-xs text-emerald-200 flex flex-col md:flex-row md:items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-bold flex items-center gap-1.5 text-emerald-300">
                      <span>📐 Blender Floor_chunk Maße:</span>
                      <span className="font-mono bg-emerald-900/60 px-2 py-0.5 rounded text-white font-semibold">
                        X = 8m | Y = 8m | Z = 0.5m
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-300 leading-relaxed">
                      Der Pivot-Punkt liegt genau in der Mitte. Die Begehfläche schmiegt sich bei <strong>Y = +0.25m</strong> bündig an. Das 3x3 Kachel-Raster passt sich automatisch nahtlos an (je 2.67m pro Schritt).
                    </p>
                  </div>
                </div>

                {/* Fine-Tuning Controls for Floor Chunk */}
                {customFloorLoaded && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-gray-950/70 p-3 rounded-xl border border-gray-800/80 text-xs">
                    {/* Height Offset Y & Scale */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-gray-400">
                        <span className="font-semibold text-emerald-300">Höhe (Y): {floorOffsetY.toFixed(2)}m</span>
                        <button 
                          onClick={() => setFloorOffsetY(0.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          Reset (0m)
                        </button>
                      </div>
                      <input
                        type="range"
                        min="-0.5"
                        max="0.5"
                        step="0.02"
                        value={floorOffsetY}
                        onChange={(e) => setFloorOffsetY(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 cursor-pointer"
                      />

                      <div className="flex justify-between items-center text-gray-400 pt-1">
                        <span className="font-semibold">Skalierung: {floorScale.toFixed(2)}x</span>
                        <button 
                          onClick={() => setFloorScale(1.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          1.0x (8m)
                        </button>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.05"
                        value={floorScale}
                        onChange={(e) => setFloorScale(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 cursor-pointer"
                      />
                    </div>

                    {/* Position X & Z Offsets */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-gray-400">
                        <span className="font-semibold">Verschiebung X: {floorOffsetX.toFixed(2)}m</span>
                        <button 
                          onClick={() => setFloorOffsetX(0.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          0m
                        </button>
                      </div>
                      <input
                        type="range"
                        min="-1.5"
                        max="1.5"
                        step="0.05"
                        value={floorOffsetX}
                        onChange={(e) => setFloorOffsetX(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 cursor-pointer"
                      />

                      <div className="flex justify-between items-center text-gray-400 pt-1">
                        <span className="font-semibold">Verschiebung Z: {floorOffsetZ.toFixed(2)}m</span>
                        <button 
                          onClick={() => setFloorOffsetZ(0.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          0m
                        </button>
                      </div>
                      <input
                        type="range"
                        min="-1.5"
                        max="1.5"
                        step="0.05"
                        value={floorOffsetZ}
                        onChange={(e) => setFloorOffsetZ(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 cursor-pointer"
                      />
                    </div>

                    {/* Floor Rotation Y */}
                    <div className="space-y-2">
                      <div className="text-gray-400 font-semibold flex items-center gap-1">
                        <RotateCcw size={13} className="text-emerald-400" /> Bodenplatten-Drehung (Y):
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {[0, 90, 180, 270].map(deg => (
                          <button
                            key={deg}
                            onClick={() => setFloorRotationY(deg)}
                            className={`py-1.5 rounded-lg border text-xs font-mono font-bold transition-all ${
                              floorRotationY === deg
                                ? 'bg-emerald-600 text-white border-emerald-400'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            {deg}°
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-500 leading-tight">
                        Dreht die Textur bzw. Ausrichtung der 8x8m Bodenplatte um das Zentrum.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: WALL CONTROLS (8m WALL) */}
            {activeTab === 'wall' && (
              <div className="space-y-3">
                {/* Wall Status Row */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Box size={14} className="text-amber-400" /> Wand-Grafik:
                    </span>
                    {customWallLoaded ? (
                      <div className="flex items-center gap-2 bg-amber-950/50 border border-amber-600/50 px-2.5 py-1 rounded-lg text-xs text-amber-200">
                        <Check size={14} className="text-amber-400" />
                        <span className="font-semibold truncate max-w-[220px]" title={customWallName}>
                          {customWallName}
                        </span>
                        <span className="text-[10px] bg-amber-900/60 text-amber-300 px-1.5 py-0.5 rounded font-mono font-bold">
                          8m Wand aktiv
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300 bg-gray-800 px-2 py-0.5 rounded-lg border border-gray-700">
                        Kein Wand-Chunk geladen
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => wallFileInputRef.current?.click()}
                      className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow"
                    >
                      <Upload size={13} />
                      <span>{customWallLoaded ? 'Andere Wand laden' : 'Wand (.glb) laden'}</span>
                    </button>

                    {customWallLoaded && (
                      <button
                        onClick={handleResetWall}
                        className="px-2.5 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-300 hover:text-white border border-red-800/50 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                        title="Basis-Wand-Chunk entfernen (Kopien in der Bibliothek bleiben erhalten)"
                      >
                        <Trash2 size={13} />
                        <span>Basis-Chunk entfernen</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Chunk Library: previously uploaded walls, grid-snapping copies */}
                <div className="flex flex-wrap items-center gap-2 pb-1 text-xs">
                  <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider flex items-center gap-1 flex-shrink-0">
                    <Layers size={13} /> Chunk-Bibliothek ({wallLibrary.length}):
                  </span>
                  {wallLibrary.length === 0 && (
                    <span className="text-[11px] text-gray-500">
                      Noch keine Wand geladen  - einmal hochgeladen, für beliebig viele Kopien verfügbar.
                    </span>
                  )}
                  {wallLibrary.map(entry => {
                    const isActive = placementMode?.type === 'wall' && placementMode.libId === entry.id;
                    return (
                      <div key={entry.id} className={`flex items-center rounded-lg border overflow-hidden flex-shrink-0 shadow-sm ${isActive ? 'bg-amber-600 border-amber-400 text-white' : 'bg-gray-800/80 text-gray-300 border-gray-700 hover:bg-gray-700'}`}>
                        <button
                          onClick={() => (isActive ? cancelPlacement() : startPlacement('wall', entry))}
                          className="pl-2 py-1 flex items-center gap-1.5 text-xs font-semibold"
                          title={isActive ? 'Platzierungsmodus aktiv  - klicken zum Beenden' : 'Neue Wand-Kopie auf dem Borderraster platzieren'}
                        >
                          {isActive && <Move size={11} className="text-white" />}
                          {isActive && <span className="text-[10px] font-mono">{placementMode?.rotationY}°</span>}
                          <span className="max-w-[150px] truncate" title={entry.fileName}>{entry.fileName}</span>
                        </button>
                        <button
                          onClick={() => removeChunkLibraryEntry(entry.id)}
                          className="px-1.5 py-1 text-rose-300 hover:text-rose-200 transition-colors"
                          title="Datei aus Bibliothek entfernen (entfernt auch alle platzierten Kopien dieser Datei)"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })}
                  {wallLibrary.length > 0 && wallPlacedCount > 0 && (
                    <button
                      onClick={() => clearPlacementsOfType('wall')}
                      className="text-[10px] text-gray-400 hover:text-rose-300 bg-gray-900 border border-gray-800 px-2 py-0.5 rounded-full font-mono flex-shrink-0 transition-colors"
                      title="Alle platzierten Wand-Chunks entfernen"
                    >
                      {wallPlacedCount} Kopien • leeren
                    </button>
                  )}
                </div>

                {/* Blender Blueprint Specification Box */}
                <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 text-xs text-amber-200 flex flex-col md:flex-row md:items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-bold flex items-center gap-1.5 text-amber-300">
                      <span>📐 Blender Wand Maße:</span>
                      <span className="font-mono bg-amber-900/60 px-2 py-0.5 rounded text-white font-semibold">
                        X = 8m | Y = 0.5m | Z = 4m
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-300 leading-relaxed">
                      Wände werden <strong>ausschließlich links (Left_Wall)</strong> und <strong>oben (Upper_Wall)</strong> aufgestellt. Die vordere und rechte Seite bleiben immer frei, damit Charaktere niemals von einer Wand verdeckt werden.
                      <br /><br />
                      <strong>Eckregel:</strong> Pro Feld sind <strong>bis zu zwei Wände möglich</strong>, wenn sie um 90° versetzt stehen (z.B. 0° + 90° = Ecke). Nur Wände in derselben Orientrichtung kollidieren miteinander und blockieren die Zelle.
                    </p>
                  </div>
                </div>

                {/* Left_Wall & Upper_Wall Controls */}
                {customWallLoaded && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Left_Wall Card */}
                      <div className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                        showLeftWall
                          ? 'bg-amber-950/40 border-amber-500/80 text-white shadow-md'
                          : 'bg-gray-900/60 border-gray-800 text-gray-400'
                      }`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-3 h-3 rounded-full ${showLeftWall ? 'bg-amber-400 shadow-sm shadow-amber-400' : 'bg-gray-700'}`} />
                          <div>
                            <div className="font-bold text-xs text-white">Left_Wall (Linke Wand)</div>
                            <div className="text-[10px] text-gray-400">Steht links am Rand (0° Standard)</div>
                          </div>
                        </div>
                        <button
                          onClick={toggleLeftWall}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            showLeftWall
                              ? 'bg-amber-600 hover:bg-amber-500 text-white shadow'
                              : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
                          }`}
                        >
                          {showLeftWall ? 'Aktiv (An)' : 'Aus'}
                        </button>
                      </div>

                      {/* Upper_Wall Card */}
                      <div className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                        showUpperWall
                          ? 'bg-amber-950/40 border-amber-500/80 text-white shadow-md'
                          : 'bg-gray-900/60 border-gray-800 text-gray-400'
                      }`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-3 h-3 rounded-full ${showUpperWall ? 'bg-amber-400 shadow-sm shadow-amber-400' : 'bg-gray-700'}`} />
                          <div>
                            <div className="font-bold text-xs text-white">Upper_Wall (Obere Wand)</div>
                            <div className="text-[10px] text-gray-400">Um -90° gedreht oben am Rand</div>
                          </div>
                        </div>
                        <button
                          onClick={toggleUpperWall}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            showUpperWall
                              ? 'bg-amber-600 hover:bg-amber-500 text-white shadow'
                              : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
                          }`}
                        >
                          {showUpperWall ? 'Aktiv (An)' : 'Aus'}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-gray-950/70 p-3 rounded-xl border border-gray-800/80 text-xs">
                      {/* Presets */}
                      <div className="space-y-2">
                        <div className="text-gray-400 font-semibold flex items-center gap-1">
                          <Layers size={13} className="text-amber-400" /> Schnellauswahl:
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            onClick={() => {
                              setShowLeftWall(true);
                              setShowUpperWall(true);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              showLeftWall && showUpperWall
                                ? 'bg-amber-600 text-white border-amber-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Beide Wände
                          </button>
                          <button
                            onClick={() => {
                              setShowLeftWall(true);
                              setShowUpperWall(false);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              showLeftWall && !showUpperWall
                                ? 'bg-amber-600 text-white border-amber-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Nur Left_Wall
                          </button>
                          <button
                            onClick={() => {
                              setShowLeftWall(false);
                              setShowUpperWall(true);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              !showLeftWall && showUpperWall
                                ? 'bg-amber-600 text-white border-amber-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Nur Upper_Wall
                          </button>
                          <button
                            onClick={() => {
                              setShowLeftWall(false);
                              setShowUpperWall(false);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              !showLeftWall && !showUpperWall
                                ? 'bg-amber-600 text-white border-amber-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Keine Wände
                          </button>
                        </div>
                      </div>

                    {/* Height & Scale */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-gray-400">
                        <span className="font-semibold text-amber-300">Höhe (Y): {wallOffsetY.toFixed(2)}m</span>
                        <button 
                          onClick={() => setWallOffsetY(0.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          Reset (0m)
                        </button>
                      </div>
                      <input
                        type="range"
                        min="-0.5"
                        max="0.5"
                        step="0.02"
                        value={wallOffsetY}
                        onChange={(e) => setWallOffsetY(parseFloat(e.target.value))}
                        className="w-full accent-amber-500 cursor-pointer"
                      />

                      <div className="flex justify-between items-center text-gray-400 pt-1">
                        <span className="font-semibold">Skalierung: {wallScale.toFixed(2)}x</span>
                        <button 
                          onClick={() => setWallScale(1.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          1.0x (8m)
                        </button>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.05"
                        value={wallScale}
                        onChange={(e) => setWallScale(parseFloat(e.target.value))}
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                    </div>

                    {/* Position X & Z Offsets */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-gray-400">
                        <span className="font-semibold">Verschiebung X: {wallOffsetX.toFixed(2)}m</span>
                        <button 
                          onClick={() => setWallOffsetX(0.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          0m
                        </button>
                      </div>
                      <input
                        type="range"
                        min="-1.5"
                        max="1.5"
                        step="0.05"
                        value={wallOffsetX}
                        onChange={(e) => setWallOffsetX(parseFloat(e.target.value))}
                        className="w-full accent-amber-500 cursor-pointer"
                      />

                      <div className="flex justify-between items-center text-gray-400 pt-1">
                        <span className="font-semibold">Verschiebung Z: {wallOffsetZ.toFixed(2)}m</span>
                        <button 
                          onClick={() => setWallOffsetZ(0.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          0m
                        </button>
                      </div>
                      <input
                        type="range"
                        min="-1.5"
                        max="1.5"
                        step="0.05"
                        value={wallOffsetZ}
                        onChange={(e) => setWallOffsetZ(parseFloat(e.target.value))}
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              )}
              </div>
            )}

            {/* TAB 4: DOOR CONTROLS (BLENDER DOOR GLB) */}
            {activeTab === 'door' && (
              <div className="space-y-3">
                {/* Door Status Row */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <DoorClosed size={14} className="text-purple-400" /> Tür-Grafik:
                    </span>
                    {customDoorLoaded ? (
                      <div className="flex items-center gap-2 bg-purple-950/50 border border-purple-600/50 px-2.5 py-1 rounded-lg text-xs text-purple-200">
                        <Check size={14} className="text-purple-400" />
                        <span className="font-semibold truncate max-w-[220px]" title={customDoorName}>
                          {customDoorName}
                        </span>
                        <span className="text-[10px] bg-purple-900/60 text-purple-300 px-1.5 py-0.5 rounded font-mono font-bold">
                          Tür aktiv
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 bg-gray-800/80 px-2.5 py-1 rounded-lg border border-gray-700">
                        Noch keine eigene Tür geladen
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => doorFileInputRef.current?.click()}
                      className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow"
                    >
                      <Upload size={13} />
                      <span>{customDoorLoaded ? 'Andere Tür (.glb) laden' : 'Tür (.glb) laden'}</span>
                    </button>

                    {customDoorLoaded && (
                      <button
                        onClick={handleResetDoor}
                        className="px-2.5 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-300 hover:text-white border border-red-800/50 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                        title="Eigene Tür entfernen"
                      >
                        <Trash2 size={13} />
                        <span>Tür entfernen</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Chunk Library: previously uploaded doors, grid-snapping copies */}
                <div className="flex flex-wrap items-center gap-2 pb-1 text-xs">
                  <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider flex items-center gap-1 flex-shrink-0">
                    <Layers size={13} /> Chunk-Bibliothek ({doorLibrary.length}):
                  </span>
                  {doorLibrary.length === 0 && (
                    <span className="text-[11px] text-gray-500">
                      Noch keine Tür geladen  - einmal hochgeladen, für beliebig viele Kopien verfügbar.
                    </span>
                  )}
                  {doorLibrary.map(entry => {
                    const isActive = placementMode?.type === 'door' && placementMode.libId === entry.id;
                    return (
                      <div key={entry.id} className={`flex items-center rounded-lg border overflow-hidden flex-shrink-0 shadow-sm ${isActive ? 'bg-purple-600 border-purple-400 text-white' : 'bg-gray-800/80 text-gray-300 border-gray-700 hover:bg-gray-700'}`}>
                        <button
                          onClick={() => (isActive ? cancelPlacement() : startPlacement('door', entry))}
                          className="pl-2 py-1 flex items-center gap-1.5 text-xs font-semibold"
                          title={isActive ? 'Platzierungsmodus aktiv  - klicken zum Beenden' : 'Neue Tür-Kopie auf dem Borderraster platzieren'}
                        >
                          {isActive && <Move size={11} className="text-white" />}
                          {isActive && <span className="text-[10px] font-mono">{placementMode?.rotationY}°</span>}
                          <span className="max-w-[150px] truncate" title={entry.fileName}>{entry.fileName}</span>
                        </button>
                        <button
                          onClick={() => removeChunkLibraryEntry(entry.id)}
                          className="px-1.5 py-1 text-rose-300 hover:text-rose-200 transition-colors"
                          title="Datei aus Bibliothek entfernen (entfernt auch alle platzierten Kopien dieser Datei)"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })}
                  {doorLibrary.length > 0 && doorPlacedCount > 0 && (
                    <button
                      onClick={() => clearPlacementsOfType('door')}
                      className="text-[10px] text-gray-400 hover:text-rose-300 bg-gray-900 border border-gray-800 px-2 py-0.5 rounded-full font-mono flex-shrink-0 transition-colors"
                      title="Alle platzierten Tür-Chunks entfernen"
                    >
                      {doorPlacedCount} Kopien • leeren
                    </button>
                  )}
                </div>

                {/* Blender Blueprint Specification Box */}
                <div className="bg-purple-950/30 border border-purple-800/40 rounded-xl p-3 text-xs text-purple-200 flex flex-col md:flex-row md:items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-bold flex items-center gap-1.5 text-purple-300">
                      <span>📐 Blender Tür Spezifikation:</span>
                      <span className="font-mono bg-purple-900/60 px-2 py-0.5 rounded text-white font-semibold">
                        Drehpunkt: Mitte des Bodens | 0°: Linke Wand | -90°: Obere Wand
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-300 leading-relaxed">
                      Die Tür nutzt denselben Drehpunkt wie Boden und Wand. Bei <strong>0°</strong> sitzt sie exakt mittig in der <strong>Left_Wall</strong>. Bei <strong>-90°</strong> Drehung liegt sie passgenau mittig in der <strong>Upper_Wall</strong>.
                      <br /><br />
                      <strong>Überlappungsregel:</strong> Eine Tür darf immer über bestehenden Wänden sitzen — auch wenn auf dem Feld bereits Wand-Chunks stehen. Nur <strong>Tür auf Tür mit gleicher Orientierung</strong> ist verboten; mit unterschiedlicher Orientierung (z.B. 0° + 90°) sind mehrere Türen pro Feld erlaubt.
                    </p>
                  </div>
                </div>

                {/* Left_Door & Upper_Door Controls */}
                {customDoorLoaded ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Left_Door Card */}
                      <div className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                        showLeftDoor
                          ? 'bg-purple-950/40 border-purple-500/80 text-white shadow-md'
                          : 'bg-gray-900/60 border-gray-800 text-gray-400'
                      }`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-3 h-3 rounded-full ${showLeftDoor ? 'bg-purple-400 shadow-sm shadow-purple-400' : 'bg-gray-700'}`} />
                          <div>
                            <div className="font-bold text-xs text-white">Left_Door (Linke Wand-Tür)</div>
                            <div className="text-[10px] text-gray-400">Sitzt in der Mitte der linken Wand (0°)</div>
                          </div>
                        </div>
                        <button
                          onClick={toggleLeftDoor}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            showLeftDoor
                              ? 'bg-purple-600 hover:bg-purple-500 text-white shadow'
                              : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
                          }`}
                        >
                          {showLeftDoor ? 'Aktiv (An)' : 'Aus'}
                        </button>
                      </div>

                      {/* Upper_Door Card */}
                      <div className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                        showUpperDoor
                          ? 'bg-purple-950/40 border-purple-500/80 text-white shadow-md'
                          : 'bg-gray-900/60 border-gray-800 text-gray-400'
                      }`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-3 h-3 rounded-full ${showUpperDoor ? 'bg-purple-400 shadow-sm shadow-purple-400' : 'bg-gray-700'}`} />
                          <div>
                            <div className="font-bold text-xs text-white">Upper_Door (Obere Wand-Tür)</div>
                            <div className="text-[10px] text-gray-400">Um -90° gedreht in der oberen Wand</div>
                          </div>
                        </div>
                        <button
                          onClick={toggleUpperDoor}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            showUpperDoor
                              ? 'bg-purple-600 hover:bg-purple-500 text-white shadow'
                              : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
                          }`}
                        >
                          {showUpperDoor ? 'Aktiv (An)' : 'Aus'}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-gray-950/70 p-3 rounded-xl border border-gray-800/80 text-xs">
                      {/* Presets */}
                      <div className="space-y-2">
                        <div className="text-gray-400 font-semibold flex items-center gap-1">
                          <Layers size={13} className="text-purple-400" /> Schnellauswahl:
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            onClick={() => {
                              setShowLeftDoor(true);
                              setShowUpperDoor(false);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              showLeftDoor && !showUpperDoor
                                ? 'bg-purple-600 text-white border-purple-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Nur Left_Door
                          </button>
                          <button
                            onClick={() => {
                              setShowLeftDoor(false);
                              setShowUpperDoor(true);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              !showLeftDoor && showUpperDoor
                                ? 'bg-purple-600 text-white border-purple-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Nur Upper_Door
                          </button>
                          <button
                            onClick={() => {
                              setShowLeftDoor(true);
                              setShowUpperDoor(true);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              showLeftDoor && showUpperDoor
                                ? 'bg-purple-600 text-white border-purple-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Beide Türen
                          </button>
                          <button
                            onClick={() => {
                              setShowLeftDoor(false);
                              setShowUpperDoor(false);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              !showLeftDoor && !showUpperDoor
                                ? 'bg-purple-600 text-white border-purple-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Keine Tür
                          </button>
                        </div>
                      </div>

                      {/* Height & Scale */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-gray-400">
                          <span className="font-semibold text-purple-300">Höhe (Y): {doorOffsetY.toFixed(2)}m</span>
                          <button 
                            onClick={() => setDoorOffsetY(0.0)} 
                            className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                          >
                            Reset (0m)
                          </button>
                        </div>
                        <input
                          type="range"
                          min="-0.5"
                          max="0.5"
                          step="0.02"
                          value={doorOffsetY}
                          onChange={(e) => setDoorOffsetY(parseFloat(e.target.value))}
                          className="w-full accent-purple-500 cursor-pointer"
                        />

                        <div className="flex justify-between items-center text-gray-400 pt-1">
                          <span className="font-semibold">Skalierung: {doorScale.toFixed(2)}x</span>
                          <button 
                            onClick={() => setDoorScale(1.0)} 
                            className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                          >
                            1.0x
                          </button>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="2.0"
                          step="0.05"
                          value={doorScale}
                          onChange={(e) => setDoorScale(parseFloat(e.target.value))}
                          className="w-full accent-purple-500 cursor-pointer"
                        />
                      </div>

                      {/* Position X & Z Offsets */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-gray-400">
                          <span className="font-semibold">Verschiebung X: {doorOffsetX.toFixed(2)}m</span>
                          <button 
                            onClick={() => setDoorOffsetX(0.0)} 
                            className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                          >
                            0m
                          </button>
                        </div>
                        <input
                          type="range"
                          min="-1.5"
                          max="1.5"
                          step="0.05"
                          value={doorOffsetX}
                          onChange={(e) => setDoorOffsetX(parseFloat(e.target.value))}
                          className="w-full accent-purple-500 cursor-pointer"
                        />

                        <div className="flex justify-between items-center text-gray-400 pt-1">
                          <span className="font-semibold">Verschiebung Z: {doorOffsetZ.toFixed(2)}m</span>
                          <button 
                            onClick={() => setDoorOffsetZ(0.0)} 
                            className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                          >
                            0m
                          </button>
                        </div>
                        <input
                          type="range"
                          min="-1.5"
                          max="1.5"
                          step="0.05"
                          value={doorOffsetZ}
                          onChange={(e) => setDoorOffsetZ(parseFloat(e.target.value))}
                          className="w-full accent-purple-500 cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-6 text-center">
                    <DoorClosed size={36} className="text-purple-400/80 mx-auto mb-2" />
                    <h4 className="text-sm font-bold text-gray-200 mb-1">Keine eigene Tür importiert</h4>
                    <p className="text-xs text-gray-400 max-w-md mx-auto mb-4">
                      Lade deine Blender Tür-Datei (.glb) hoch. Sie wird automatisch zentriert in der linken Wand platziert (0°) und kann zusätzlich oder alternativ für die obere Wand (-90°) aktiviert werden.
                    </p>
                    <button
                      onClick={() => doorFileInputRef.current?.click()}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-2 transition-colors shadow"
                    >
                      <Upload size={14} />
                      <span>Tür (.glb) jetzt importieren</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Bottom Row Actions & Quick Help */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-gray-800/80">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMoveSpeed(prev => (prev === 3.6 ? 5.4 : 3.6))}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium rounded-xl border border-gray-700 transition-colors"
                  title="Geschwindigkeit umschalten"
                >
                  Tempo: <span className="text-emerald-400 font-bold">{moveSpeed === 3.6 ? 'Normal' : 'Sprint'}</span>
                </button>

                <button
                  onClick={resetToCenter}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium rounded-xl border border-gray-700 flex items-center gap-1.5 transition-colors active:scale-95"
                  title="Charakter auf Mittelkachel [1,1] zurücksetzen"
                >
                  <RotateCcw size={13} className="text-amber-400" />
                  <span>Mitte [1,1]</span>
                </button>

                <button
                  onClick={() => setAudioEnabled(!audioEnabled)}
                  className={`px-2.5 py-1.5 text-xs rounded-xl border transition-colors ${
                    audioEnabled
                      ? 'bg-gray-800 text-gray-300 border-gray-700'
                      : 'bg-gray-900 text-gray-500 border-gray-800'
                  }`}
                  title="Audio SFX Ein/Aus"
                >
                  {audioEnabled ? 'SFX An' : 'SFX Aus'}
                </button>
              </div>

              <div className="text-[11px] text-gray-400 flex items-center gap-2">
                <span className="text-gray-500">Navigation:</span>
                <span>Klick auf eine Kachel bewegt den Charakter schrittweise</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DungeonTestView;
